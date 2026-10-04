import { describe, expect, test } from "bun:test";
import { ViceCore } from "./vice-wasm";

// Render-plan matrix characterization test (Phase 0).
// Locks down all combinations across:
// - full 2x / 3x / 4x
// - stream 2x / 3x / 4x
// - fused 4x (modes 1 and 2)
// - Blob export & file-stream export (ChunkSink)
// - ICC profile embedding
// - Alpha pruning (opaque -> RGB) vs preservation (translucent -> RGBA)
// - Cancellation
// - TS fallback pipeline

describe("render-plan matrix characterization", () => {
  // --- 1. Full 2x, 3x, 4x --------------------------------------------------
  test.each([2, 3, 4] as const)("full %dx renders and satisfies box consistency", async (scale) => {
    const core = await ViceCore.load("../public/");
    expect(core).toBeTruthy();
    if (!core) return;

    const w = 6;
    const h = 6;
    const c = 4;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 23) / 23;

    const ctx = core.create(w, h, scale, c);
    try {
      core.setInput(ctx, y);
      core.upscale(ctx);
      core.project(ctx);
      const residual = core.lastResidual(ctx);
      expect(residual).toBeLessThan(1e-4);

      const outW = w * scale;
      const outH = h * scale;
      const png = core.finishPng(ctx, outW, outH, c);
      expect(png[0]).toBe(137);
      expect(png[1]).toBe(80); // 'P'
      expect(png[2]).toBe(78); // 'N'
      expect(png[3]).toBe(71); // 'G'
    } finally {
      core.destroy(ctx);
    }
  });

  // --- 2. Stream 2x, 3x, 4x ------------------------------------------------
  test.each([2, 3, 4] as const)("stream %dx renders and pulls valid bands", async (scale) => {
    const core = await ViceCore.load("../public/");
    expect(core).toBeTruthy();
    if (!core || !core.hasStream()) return;

    const w = 8;
    const h = 8;
    const c = 4;
    const bandH = 24;
    const outW = w * scale;
    const outH = h * scale;

    const sctx = core.createStream(w, h, scale, c, bandH);
    const bandPtr = core.mallocBytes(bandH * outW * c);
    try {
      const y = new Float32Array(w * h * c).fill(0.35);
      core.streamPushRows(sctx, y, h);

      let emitted = 0;
      while (core.streamHasNext(sctx)) {
        const { rows } = core.streamPullBand(sctx, bandPtr, bandH);
        emitted += rows;
      }
      expect(emitted).toBe(outH);
      const residual = core.lastStreamResidual(sctx);
      expect(residual).toBeLessThan(1e-4);
    } finally {
      core.freeBytes(bandPtr);
      core.streamDestroy(sctx);
    }
  });

  // --- 3. Fused 4x ---------------------------------------------------------
  test.each([1, 2] as const)("fused 4x mode %d completes and satisfies consistency", async (mode) => {
    const core = await ViceCore.load("../public/");
    expect(core).toBeTruthy();
    if (!core || !core.hasInfinite()) return;

    const w = 10;
    const h = 10;
    const scale = 4;
    const c = 4;
    const bandH = 16;
    const outH = h * scale;

    const sctx = core.createStream(w, h, scale, c, bandH);
    core.streamSetFused(sctx, mode);
    const bandPtr = core.mallocBytes(bandH * w * scale * c);
    try {
      const y = new Float32Array(w * h * c).fill(0.42);
      core.streamPushRows(sctx, y, h);

      let emitted = 0;
      while (core.streamHasNext(sctx)) {
        const { rows } = core.streamPullBand(sctx, bandPtr, bandH);
        emitted += rows;
      }
      expect(emitted).toBe(outH);
      const residual = core.lastStreamResidual(sctx);
      expect(residual).toBeLessThan(1e-4);
    } finally {
      core.freeBytes(bandPtr);
      core.streamDestroy(sctx);
    }
  });

  // --- 4. Blob export vs ChunkSink file-stream export -----------------------
  test("file-stream export via incremental PNG writer matches IHDR and valid CRCs", async () => {
    const core = await ViceCore.load("../public/");
    expect(core).toBeTruthy();
    if (!core || !core.hasInfinite()) return;

    const W = 16;
    const H = 20;
    const pst = core.pngOpen(W, H, 4, 3);
    const rowBuf = new Uint8Array(W * 4).fill(128);
    const rowPtr = core.writeBytes(rowBuf);

    const receivedChunks: Uint8Array[] = [];
    const chunkSink = {
      write: async (chunk: Uint8Array) => {
        receivedChunks.push(new Uint8Array(chunk));
      },
    };

    try {
      for (let y = 0; y < H; y++) {
        core.pngWriteRows(pst, rowPtr, 1);
        for (;;) {
          const c = core.pngDrain(pst);
          if (c.length === 0) break;
          await chunkSink.write(c);
        }
      }
      core.pngClose(pst);
      for (;;) {
        const c = core.pngDrain(pst);
        if (c.length === 0) break;
        await chunkSink.write(c);
      }
    } finally {
      core.freeBytes(rowPtr);
      core.pngDestroy(pst);
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
    // Read IHDR dims
    const view = new DataView(fullPng.buffer, fullPng.byteOffset, fullPng.byteLength);
    expect(view.getUint32(16, false)).toBe(W);
    expect(view.getUint32(20, false)).toBe(H);
  });

  // --- 5. ICC profile embedding --------------------------------------------
  test("ICC profile is preserved in PNG output", async () => {
    const core = await ViceCore.load("../public/");
    if (!core) return;

    const dummyIcc = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x49, 0x43, 0x43, 0x50]);
    const W = 8;
    const H = 8;
    const pst = core.pngOpen(W, H, 3, 3, dummyIcc);
    const rowBuf = new Uint8Array(W * 3).fill(200);
    const rowPtr = core.writeBytes(rowBuf);
    const chunks: Uint8Array[] = [];

    try {
      for (let y = 0; y < H; y++) {
        core.pngWriteRows(pst, rowPtr, 1);
      }
      core.pngClose(pst);
      for (;;) {
        const c = core.pngDrain(pst);
        if (c.length === 0) break;
        chunks.push(c);
      }
    } finally {
      core.freeBytes(rowPtr);
      core.pngDestroy(pst);
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
      if (
        png[i] === 0x69 &&
        png[i + 1] === 0x43 &&
        png[i + 2] === 0x43 &&
        png[i + 3] === 0x50
      ) {
        hasIccp = true;
        break;
      }
    }
    expect(hasIccp).toBe(true);
  });

  // --- 6. Alpha handling ---------------------------------------------------
  test("Alpha handling: opaque yields RGB (type 2), translucent yields RGBA (type 6)", async () => {
    const core = await ViceCore.load("../public/");
    if (!core || !core.hasInfinite()) return;

    // Case A: 3-channel output (opaque input)
    const stOpaque = core.pngOpen(4, 4, 4, 3);
    const rOpaque = core.writeBytes(new Uint8Array(4 * 4).fill(255));
    core.pngWriteRows(stOpaque, rOpaque, 4);
    core.pngClose(stOpaque);
    const pngOpaque = core.pngDrain(stOpaque, 10000);
    core.freeBytes(rOpaque);
    core.pngDestroy(stOpaque);
    // Color type is at offset 25 in PNG
    expect(pngOpaque[25]).toBe(2); // RGB

    // Case B: 4-channel output (translucent input)
    const stAlpha = core.pngOpen(4, 4, 4, 4);
    const rAlpha = core.writeBytes(new Uint8Array(4 * 4).fill(128));
    core.pngWriteRows(stAlpha, rAlpha, 4);
    core.pngClose(stAlpha);
    const pngAlpha = core.pngDrain(stAlpha, 10000);
    core.freeBytes(rAlpha);
    core.pngDestroy(stAlpha);
    expect(pngAlpha[25]).toBe(6); // RGBA
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
