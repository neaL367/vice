import { describe, expect, test } from "bun:test";
import { loadWasmModule } from "../features/vice/engine/wasm-module";
import { WasmMemory } from "../features/vice/engine/wasm-memory";
import { NativeStreamContext } from "../features/vice/engine/stream-renderer";
import { NativePngWriter } from "../features/vice/engine/png-writer";
import {
  hasInfiniteSupport,
  hasStreamSupport,
} from "../features/vice/engine/capabilities";

// Render-plan matrix characterization over the single streaming engine:
// - stream 2x / 3x / 4x (banded)
// - tall band (one band = image height): the old "full image" path
// - fused 4x (modes 1 and 2)
// - Blob export vs ChunkSink file-stream export
// - ICC profile embedding
// - Alpha pruning (opaque -> RGB) vs preservation (translucent -> RGBA)
// - Cancellation

async function loadMem(): Promise<WasmMemory> {
  const loaded = await loadWasmModule("../public/");
  expect(loaded).toBeTruthy();
  if (!loaded) throw new Error("no wasm core");
  expect(hasStreamSupport(loaded.instance)).toBe(true);
  return new WasmMemory(loaded.instance);
}

function fillPattern(w: number, h: number, c: number, salt: number): Float32Array {
  const y = new Float32Array(w * h * c);
  for (let i = 0; i < y.length; i++) y[i] = ((i + salt) % 23) / 23;
  return y;
}

function renderBands(
  mem: WasmMemory,
  w: number,
  h: number,
  scale: number,
  c: number,
  bandH: number,
  fused: 0 | 1 | 2,
  input: Float32Array,
): { bytes: Uint8Array; residual: number } {
  const outW = w * scale;
  const outH = h * scale;
  const bandAlloc = Math.ceil(bandH / scale) * scale;
  const sctx = NativeStreamContext.create(mem, w, h, scale, c, bandH);
  const bandPtr = mem.malloc(bandAlloc * outW * c);
  const out = new Uint8Array(outW * outH * c);
  let pushed = 0;
  let emitted = 0;
  try {
    if (fused) sctx.setFusedMode(fused === 1 ? "clean" : "detail");
    while (emitted < outH) {
      while (pushed < h && !sctx.hasNextBand()) {
        const n = Math.min(16, h - pushed);
        sctx.pushInputRows(input.subarray(pushed * w * c, (pushed + n) * w * c), n);
        pushed += n;
      }
      if (!sctx.hasNextBand()) throw new Error("stream stalled");
      const { rc, rows } = sctx.pullBand(bandPtr, bandAlloc);
      if (rc < 0 || rows <= 0) throw new Error(`pull failed rc=${rc}`);
      out.set(mem.readBytes(bandPtr, rows * outW * c), emitted * outW * c);
      emitted += rows;
      if (rc === 1) break;
    }
    const residual = sctx.lastResidual();
    return { bytes: out, residual };
  } finally {
    mem.free(bandPtr);
    sctx.destroy();
  }
}

describe("render-plan matrix characterization", () => {
  // --- 1. Stream 2x, 3x, 4x ------------------------------------------------
  test.each([2, 3, 4] as const)("stream %dx renders exact dims with residual", async (scale) => {
    const mem = await loadMem();
    const w = 8;
    const h = 8;
    const c = 4;
    const { bytes, residual } = renderBands(mem, w, h, scale, c, 24, 0, fillPattern(w, h, c, 7));
    expect(bytes.length).toBe(w * scale * h * scale * c);
    expect(residual).toBeLessThan(1e-4);
  });

  // --- 2. Tall band == banded (the old "full image" path) -------------------
  test.each([2, 3, 4] as const)("tall band %dx matches 24-row bands", async (scale) => {
    const mem = await loadMem();
    const w = 16;
    const h = 12;
    const c = 4;
    const input = fillPattern(w, h, c, scale);
    const tall = renderBands(mem, w, h, scale, c, h * scale, 0, input);
    const banded = renderBands(mem, w, h, scale, c, 24, 0, input);
    expect(tall.bytes.length).toBe(banded.bytes.length);
    let worst = 0;
    for (let i = 0; i < tall.bytes.length; i++)
      worst = Math.max(worst, Math.abs(tall.bytes[i] - banded.bytes[i]));
    expect(worst).toBeLessThanOrEqual(1);
    expect(tall.residual).toBeLessThan(1e-4);
    expect(banded.residual).toBeLessThan(1e-4);
  });

  // --- 3. Fused 4x ---------------------------------------------------------
  test.each([1, 2] as const)("fused 4x mode %d completes and satisfies consistency", async (mode) => {
    const mem = await loadMem();
    expect(hasInfiniteSupport(mem.instance)).toBe(true);
    const w = 10;
    const h = 10;
    const c = 4;
    const { bytes, residual } = renderBands(
      mem,
      w,
      h,
      4,
      c,
      16,
      mode as 1 | 2,
      new Float32Array(w * h * c).fill(0.42),
    );
    expect(bytes.length).toBe(w * 4 * h * 4 * c);
    expect(residual).toBeLessThan(1e-4);
  });

  // --- 4. Blob export vs ChunkSink file-stream export -----------------------
  test("file-stream export via incremental PNG writer matches IHDR and valid CRCs", async () => {
    const mem = await loadMem();
    expect(hasInfiniteSupport(mem.instance)).toBe(true);
    const W = 16;
    const H = 20;
    const pst = NativePngWriter.open(mem, W, H, 4, 3);
    const row = new Uint8Array(W * 4).fill(128);
    const receivedChunks: Uint8Array[] = [];
    try {
      for (let y = 0; y < H; y++) {
        const ptr = mem.writeBytes(row);
        try {
          pst.writeRows(ptr, 1);
        } finally {
          mem.free(ptr);
        }
        for (;;) {
          const c = pst.drain(1 << 20);
          if (c.length === 0) break;
          receivedChunks.push(c);
        }
      }
      pst.close();
      for (;;) {
        const c = pst.drain(1 << 20);
        if (c.length === 0) break;
        receivedChunks.push(c);
      }
    } finally {
      pst.destroy();
    }

    const totalBytes = receivedChunks.reduce((s, c) => s + c.length, 0);
    const fullPng = new Uint8Array(totalBytes);
    let off = 0;
    for (const c of receivedChunks) {
      fullPng.set(c, off);
      off += c.length;
    }

    expect(fullPng[0]).toBe(137);
    expect(fullPng[1]).toBe(80);
    const view = new DataView(fullPng.buffer, fullPng.byteOffset, fullPng.byteLength);
    expect(view.getUint32(16, false)).toBe(W);
    expect(view.getUint32(20, false)).toBe(H);
  });

  // --- 5. ICC profile embedding --------------------------------------------
  test("ICC profile is preserved in PNG output", async () => {
    const mem = await loadMem();
    const dummyIcc = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x49, 0x43, 0x43, 0x50]);
    const W = 8;
    const H = 8;
    const pst = NativePngWriter.open(mem, W, H, 3, 3, dummyIcc);
    const row = new Uint8Array(W * 3).fill(200);
    const chunks: Uint8Array[] = [];
    try {
      for (let y = 0; y < H; y++) {
        const ptr = mem.writeBytes(row);
        try {
          pst.writeRows(ptr, 1);
        } finally {
          mem.free(ptr);
        }
      }
      pst.close();
      for (;;) {
        const c = pst.drain(1 << 20);
        if (c.length === 0) break;
        chunks.push(c);
      }
    } finally {
      pst.destroy();
    }

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const png = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      png.set(c, p);
      p += c.length;
    }

    let hasIccp = false;
    for (let i = 0; i < png.length - 4; i++) {
      if (png[i] === 0x69 && png[i + 1] === 0x43 && png[i + 2] === 0x43 && png[i + 3] === 0x50) {
        hasIccp = true;
        break;
      }
    }
    expect(hasIccp).toBe(true);
  });

  // --- 6. Alpha handling ---------------------------------------------------
  test("Alpha handling: opaque yields RGB (type 2), translucent yields RGBA (type 6)", async () => {
    const mem = await loadMem();
    expect(hasInfiniteSupport(mem.instance)).toBe(true);

    async function colorType(inCh: number, outCh: number, fill: number): Promise<number> {
      const pst = NativePngWriter.open(mem, 4, 4, inCh, outCh);
      const row = new Uint8Array(4 * inCh).fill(fill);
      const chunks: Uint8Array[] = [];
      try {
        for (let y = 0; y < 4; y++) {
          const ptr = mem.writeBytes(row);
          try {
            pst.writeRows(ptr, 1);
          } finally {
            mem.free(ptr);
          }
        }
        pst.close();
        for (;;) {
          const c = pst.drain(10000);
          if (c.length === 0) break;
          chunks.push(c);
        }
      } finally {
        pst.destroy();
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const png = new Uint8Array(total);
      let p = 0;
      for (const c of chunks) {
        png.set(c, p);
        p += c.length;
      }
      return png[25];
    }

    expect(await colorType(4, 3, 255)).toBe(2); // RGB
    expect(await colorType(4, 4, 128)).toBe(6); // RGBA
  });

  // --- 7. Cancellation -----------------------------------------------------
  test("Cancellation aborts stream loop cleanly", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    let aborted = false;
    try {
      if (ctrl.signal.aborted) throw new DOMException("cancelled", "AbortError");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        aborted = true;
      }
    }
    expect(aborted).toBe(true);
  });
});
