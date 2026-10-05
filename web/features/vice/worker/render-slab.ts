// Slab render (worker side, share-nothing): one fixed slab in, one PNG
// segment out. Runs in whatever thread owns a WASM instance today; moving it
// across real Workers is P6b (same function, postMessage transport).
// Deterministic: same slab + same input bytes, always.

import type { WasmMemory } from "../engine/wasm-memory";
import { NativeStreamContext, haloRows } from "../engine/stream-renderer";
import { NativePngSegment } from "../engine/png-segment";
import type { Slab } from "../slabs/geometry";

export interface SlabInput {
  width: number; // input dims (linear-float space)
  height: number;
  channels: 4; // slabs always carry RGBA; the segment prunes opaque alpha
  hasAlpha: boolean;
  icc: Uint8Array | null;
  getLinearStrip(y0: number, rows: number): Float32Array;
  /** Max input rows to push (transport windows); default input.height. */
  pushCap?: number;
}

export interface SlabSegment {
  outY0: number;
  outRows: number;
  bytes: Uint8Array; // owned sRGB rows (for preview/debug, not framing)
  segment: Uint8Array; // raw DEFLATE bytes for the coordinator
  adler: number;
  rawLen: number;
  residual: number;
}

/** One slab execution, however transported (inline or sub-worker). */
export type SlabRunner = (
  slab: Slab,
  isLast: boolean,
  signal?: AbortSignal,
) => Promise<SlabSegment>;

const PUSH = 16;

/**
 * Input window a slab render will request: halo above the owned blocks
 * through image end (pushes are cheap memcpys; the stream gates pulls).
 * Coordinator slices exactly this for transport; the renderer computes the
 * same window internally — single source, no drift.
 */
export function slabInputWindow(slab: Slab, scale: 2 | 3 | 4, haloTop: number): { inY0: number } {
  return { inY0: Math.max(0, slab.outY0 / scale - haloTop) };
}

export function renderSlab(
  mem: WasmMemory,
  input: SlabInput,
  slab: Slab,
  scale: 2 | 3 | 4,
  fused: 0 | 1 | 2,
  isLast: boolean,
  signal?: AbortSignal,
): SlabSegment {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
  };
  const outW = input.width * scale;
  const outY0 = slab.outY0;
  const outY1 = slab.outY0 + slab.outRows;
  const { top } = haloRows(mem, scale, fused);
  const { inY0 } = slabInputWindow(slab, scale, top);

  const sctx = NativeStreamContext.create(mem, input.width, input.height, scale, 4, 64);
  const bandAlloc = Math.ceil(64 / scale) * scale;
  const bandPtr = mem.malloc(bandAlloc * outW * 4);
  const owned = new Uint8Array(slab.outRows * outW * 4);
  try {
    if (fused) sctx.setFusedMode(fused === 1 ? "clean" : "detail");
    if (input.icc) sctx.setIccProfile(input.icc);
    sctx.beginSlab(inY0, outY0);
    let pushed = inY0;
    let emitted = outY0;
    const pushEnd = input.pushCap ?? input.height;
    while (emitted < outY1) {
      while (pushed < pushEnd && !sctx.hasNextBand()) {
        const n = Math.min(PUSH, input.height - pushed);
        const strip = input.getLinearStrip(pushed, n);
        sctx.pushInputRows(strip, n);
        pushed += n;
        throwIfAborted();
      }
      if (!sctx.hasNextBand()) throw new Error("slab stream stalled");
      const { rc, rows } = sctx.pullBand(bandPtr, bandAlloc);
      if (rc < 0 || rows <= 0) throw new Error(`slab pull failed rc=${rc}`);
      const take = Math.min(rows, outY1 - emitted);
      owned.set(mem.readBytes(bandPtr, take * outW * 4), (emitted - outY0) * outW * 4);
      emitted += rows;
      throwIfAborted();
      if (rc === 1) break;
    }
    if (emitted < outY1) throw new Error(`slab short: ${emitted - outY0}/${slab.outRows}`);
    const residual = sctx.lastResidual();

    // PNG segment over the owned rows (last slab of the image ends the stream).
    const outCh = input.hasAlpha ? 4 : 3;
    const seg = NativePngSegment.open(mem, outW, slab.outRows, 4, outCh);
    const chunks: Uint8Array[] = [];
    try {
      const rowPtr = mem.writeBytes(owned);
      try {
        seg.writeRows(rowPtr, slab.outRows);
      } finally {
        mem.free(rowPtr);
      }
      const { adler, rawLen } = seg.finish(isLast);
      for (;;) {
        const c = seg.drain(1 << 20);
        if (c.length === 0) break;
        chunks.push(c);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.length;
      }
      return { outY0, outRows: slab.outRows, bytes: owned, segment: bytes, adler, rawLen, residual };
    } finally {
      seg.destroy();
    }
  } finally {
    mem.free(bandPtr);
    sctx.destroy();
  }
}
