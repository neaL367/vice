import { describe, expect, test } from "bun:test";
import { loadWasmModule } from "../features/vice/engine/wasm-module";
import { WasmMemory } from "../features/vice/engine/wasm-memory";
import { NativeStreamContext } from "../features/vice/engine/stream-renderer";
import { NativePngWriter } from "../features/vice/engine/png-writer";
import {
  hasInfiniteSupport,
  hasStreamSupport,
} from "../features/vice/engine/capabilities";

// One engine: every render below drives the streaming strip API — the same
// path the app ships. "Full image" is just a stream render with one band as
// tall as the image (see the tall-vs-banded test).

interface StreamHarness {
  mem: WasmMemory;
  threaded: boolean;
}

async function loadHarness(): Promise<StreamHarness> {
  const loaded = await loadWasmModule("../public/");
  expect(loaded).toBeTruthy();
  if (!loaded) throw new Error("no wasm core");
  expect(hasStreamSupport(loaded.instance)).toBe(true);
  return { mem: new WasmMemory(loaded.instance), threaded: loaded.threaded };
}

function gradInput(w: number, h: number, c: number, salt = 0): Float32Array {
  const y = new Float32Array(w * h * c);
  for (let i = 0; i < y.length; i++) y[i] = ((i + salt) % 23) / 23;
  return y;
}

/** Push all input rows (16-row chunks) and pull every band; returns bytes + residual. */
function renderAll(
  mem: WasmMemory,
  sctx: NativeStreamContext,
  input: Float32Array,
  w: number,
  h: number,
  scale: number,
  c: number,
  bandH: number,
): { bytes: Uint8Array; residual: number } {
  const outW = w * scale;
  const outH = h * scale;
  const bandAlloc = Math.ceil(bandH / scale) * scale;
  const bandPtr = mem.malloc(bandAlloc * outW * c);
  const out = new Uint8Array(outW * outH * c);
  let pushed = 0;
  let emitted = 0;
  try {
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
  } finally {
    mem.free(bandPtr);
  }
  if (emitted !== outH) throw new Error(`short render ${emitted}/${outH}`);
  return { bytes: out, residual: sctx.lastResidual() };
}

describe("stream engine", () => {
  test.each([2, 3, 4] as const)("stream %dx satisfies box consistency", async (scale) => {
    const { mem } = await loadHarness();
    const w = 8;
    const h = 6;
    const c = 4;
    const sctx = NativeStreamContext.create(mem, w, h, scale, c, 64);
    try {
      const { bytes, residual } = renderAll(mem, sctx, gradInput(w, h, c), w, h, scale, c, 64);
      expect(bytes.length).toBe(w * scale * h * scale * c);
      expect(residual).toBeLessThan(1e-4);
    } finally {
      sctx.destroy();
    }
  });

  test.each([2, 3, 4] as const)(
    "tall band equals banded render within 1 LSB (band size is irrelevant)",
    async (scale) => {
      const { mem } = await loadHarness();
      const w = 24;
      const h = 20;
      const c = 4;
      const input = gradInput(w, h, c, scale);
      const outH = h * scale;
      const render = (bandH: number): Uint8Array => {
        const sctx = NativeStreamContext.create(mem, w, h, scale, c, bandH);
        try {
          return renderAll(mem, sctx, input, w, h, scale, c, bandH).bytes;
        } finally {
          sctx.destroy();
        }
      };
      const tall = render(outH);
      for (const bandH of [16, 64, 128]) {
        const banded = render(bandH);
        expect(banded.length).toBe(tall.length);
        let worst = 0;
        for (let i = 0; i < tall.length; i++)
          worst = Math.max(worst, Math.abs(tall[i] - banded[i]));
        expect(worst).toBeLessThanOrEqual(1);
      }
    },
  );

  test("stream preserves alpha: translucent stays RGBA, opaque prunes to RGB", async () => {
    const { mem } = await loadHarness();
    const w = 4;
    const h = 4;
    // White at 50% alpha in linear premultiplied floats.
    const y = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      y[i * 4 + 0] = 0.5;
      y[i * 4 + 1] = 0.5;
      y[i * 4 + 2] = 0.5;
      y[i * 4 + 3] = 0.5;
    }
    const sctx = NativeStreamContext.create(mem, w, h, 2, 4, 16);
    try {
      const { bytes } = renderAll(mem, sctx, y, w, h, 2, 4, 16);
      expect(bytes[0]).toBeGreaterThanOrEqual(254);
      expect(bytes[3]).toBeGreaterThanOrEqual(127);
      expect(bytes[3]).toBeLessThanOrEqual(128);
    } finally {
      sctx.destroy();
    }

    // Opaque input prunes to RGB (color type 2) through the PNG writer.
    const opaque = new Uint8Array(8 * 8 * 4).fill(200);
    for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
    const pst = NativePngWriter.open(mem, 8, 8, 4, 3);
    const chunks: Uint8Array[] = [];
    try {
      for (let r = 0; r < 8; r++) {
        const p = mem.writeBytes(opaque.slice(r * 8 * 4, (r + 1) * 8 * 4));
        try {
          pst.writeRows(p, 1);
        } finally {
          mem.free(p);
        }
        for (;;) {
          const c = pst.drain(997);
          if (c.length === 0) break;
          chunks.push(c);
        }
      }
      pst.close();
      for (;;) {
        const c = pst.drain(997);
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
    expect(png[0]).toBe(137);
    expect(png[25]).toBe(2); // RGB, alpha pruned
  });

  test("stream ICC profile embeds iCCP chunk", async () => {
    const { mem } = await loadHarness();
    const w = 8;
    const h = 8;
    const icc = new Uint8Array([0, 1, 2, 3, 0x49, 0x43, 0x43, 0x50]);
    const pst = NativePngWriter.open(mem, w, h, 3, 3, icc);
    const row = new Uint8Array(w * 3).fill(200);
    const chunks: Uint8Array[] = [];
    try {
      for (let y = 0; y < h; y++) {
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
    let found = false;
    for (let i = 0; i + 4 <= png.length; i++) {
      if (png[i] === 0x69 && png[i + 1] === 0x43 && png[i + 2] === 0x43 && png[i + 3] === 0x50) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test.each([1, 2] as const)("fused 4x mode %d is exact", async (mode) => {
    const { mem } = await loadHarness();
    expect(hasInfiniteSupport(mem.instance)).toBe(true);
    const w = 12;
    const h = 10;
    const c = 4;
    const sctx = NativeStreamContext.create(mem, w, h, 4, c, 32);
    try {
      sctx.setFusedMode(mode === 1 ? "clean" : "detail");
      const y = new Float32Array(w * h * c).fill(0.42);
      const { bytes, residual } = renderAll(mem, sctx, y, w, h, 4, c, 32);
      expect(bytes.length).toBe(w * 4 * h * 4 * c);
      expect(residual).toBeLessThan(1e-4);
    } finally {
      sctx.destroy();
    }
  });

  test("fused clean and detail differ by construction", async () => {
    const { mem } = await loadHarness();
    const w = 24;
    const h = 24;
    const c = 4;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 251) / 251;
    const outs: Uint8Array[] = [];
    for (const mode of ["clean", "detail"] as const) {
      const sctx = NativeStreamContext.create(mem, w, h, 4, c, 32);
      try {
        sctx.setFusedMode(mode);
        outs.push(renderAll(mem, sctx, y, w, h, 4, c, 32).bytes);
      } finally {
        sctx.destroy();
      }
    }
    expect(outs[0].length).toBe(outs[1].length);
    let same = true;
    for (let i = 0; i < outs[0].length; i++) {
      if (outs[0][i] !== outs[1][i]) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });

  test("incremental PNG writer round-trips fixed-budget chunks", async () => {
    const { inflateSync } = await import("node:zlib");
    const { mem } = await loadHarness();
    expect(hasInfiniteSupport(mem.instance)).toBe(true);
    const W = 12;
    const H = 9;
    const rows = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        rows[i] = (x * 37 + y * 91) & 255;
        rows[i + 1] = (x * 11 + 40) & 255;
        rows[i + 2] = (y * 131 + 90) & 255;
        rows[i + 3] = 255;
      }
    const st = NativePngWriter.open(mem, W, H, 4, 3);
    const chunks: Uint8Array[] = [];
    try {
      for (const [off, n] of [[0, 4], [4, 5]] as const) {
        const ptr = mem.writeBytes(rows.slice(off * W * 4, (off + n) * W * 4));
        try {
          st.writeRows(ptr, n);
        } finally {
          mem.free(ptr);
        }
        for (;;) {
          const c = st.drain(997);
          if (c.length === 0) break;
          chunks.push(c);
        }
      }
      st.close();
      for (;;) {
        const c = st.drain(997);
        if (c.length === 0) break;
        chunks.push(c);
      }
    } finally {
      st.destroy();
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const png = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      png.set(c, p);
      p += c.length;
    }
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(0x50);
    const rd32 = (o: number) =>
      (png[o] * 2 ** 24 + png[o + 1] * 2 ** 16 + png[o + 2] * 2 ** 8 + png[o + 3]) >>> 0;
    expect(rd32(16)).toBe(W);
    expect(rd32(20)).toBe(H);
    let pos = 8;
    let idatLen = 0;
    const idat = new Uint8Array(total);
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      crcTable[n] = v >>> 0;
    }
    const crc = (buf: Uint8Array, o: number, n: number): number => {
      let v = 0xffffffff;
      for (let i = 0; i < n; i++) v = crcTable[(v ^ buf[o + i]) & 255] ^ (v >>> 8);
      return (v ^ 0xffffffff) >>> 0;
    };
    let seenIend = false;
    while (pos + 8 <= png.length) {
      const n = rd32(pos);
      const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
      expect(crc(png, pos + 4, 4 + n)).toBe(rd32(pos + 8 + n));
      if (type === "IDAT") {
        idat.set(png.slice(pos + 8, pos + 8 + n), idatLen);
        idatLen += n;
      }
      if (type === "IEND") seenIend = true;
      pos += 12 + n;
    }
    expect(seenIend).toBe(true);
    expect(pos).toBe(png.length);
    const raw = inflateSync(idat.slice(0, idatLen));
    expect(raw.length).toBe((W * 3 + 1) * H);
    expect(raw[0]).toBeLessThanOrEqual(4);
  });
});
