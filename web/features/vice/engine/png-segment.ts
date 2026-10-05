// Native independent DEFLATE segment: manages vice_png_segment lifecycle.
// One segment = one slab's filtered rows. First row restricted to None/Sub,
// ends with FULL_FLUSH (FINISH for the last slab); the coordinator frames
// ordered segments behind one header/trailer. Per-worker instances only.

import type { WasmMemory } from "../engine/wasm-memory";

export class NativePngSegment {
  private destroyed = false;

  private constructor(
    private readonly mem: WasmMemory,
    private readonly seg: number,
    readonly w: number,
    readonly rows: number,
  ) {}

  static open(mem: WasmMemory, w: number, rows: number, inChannels: number, outChannels: number): NativePngSegment {
    const fn = mem.instance._vice_png_segment_open;
    if (!fn) throw new Error("stale WASM core: vice_png_segment_open missing");
    const seg = fn(w, rows, inChannels, outChannels);
    if (!seg) throw new Error("vice_png_segment_open failed (bad dimensions)");
    return new NativePngSegment(mem, seg, w, rows);
  }

  writeRows(rowsPtr: number, rowCount: number): void {
    this.assertAlive();
    const fn = this.mem.instance._vice_png_segment_write_rows;
    if (!fn) throw new Error("stale WASM core: vice_png_segment_write_rows missing");
    if (fn(this.seg, rowsPtr, rowCount) !== 0) {
      throw new Error("vice_png_segment_write_rows failed");
    }
  }

  /** Finish the segment; reports running adler + filtered length for framing. */
  finish(isLast: boolean): { adler: number; rawLen: number } {
    this.assertAlive();
    const fn = this.mem.instance._vice_png_segment_finish;
    if (!fn) throw new Error("stale WASM core: vice_png_segment_finish missing");
    const adlerPtr = this.mem.malloc(4);
    const lenPtr = this.mem.malloc(8);
    try {
      if (fn(this.seg, isLast ? 1 : 0, adlerPtr, lenPtr) !== 0) {
        throw new Error("vice_png_segment_finish failed (row count or deflate error)");
      }
      return {
        // wasm32 size_t is 4 bytes; the second word is uninitialized.
        adler: this.mem.readUint32(adlerPtr) >>> 0,
        rawLen: this.mem.readUint32(lenPtr) >>> 0,
      };
    } finally {
      this.mem.free(adlerPtr);
      this.mem.free(lenPtr);
    }
  }

  drain(cap = 1 << 20): Uint8Array {
    this.assertAlive();
    const fn = this.mem.instance._vice_png_segment_drain;
    if (!fn) throw new Error("stale WASM core: vice_png_segment_drain missing");
    const outPtr = this.mem.malloc(cap);
    const writtenPtr = this.mem.malloc(8);
    try {
      if (fn(this.seg, outPtr, cap, writtenPtr) !== 0) {
        throw new Error("vice_png_segment_drain failed");
      }
      const written = this.mem.readUint32(writtenPtr);
      return this.mem.readBytes(outPtr, written);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(writtenPtr);
    }
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.mem.instance._vice_png_segment_destroy?.(this.seg);
    }
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("NativePngSegment has been destroyed");
  }
}
