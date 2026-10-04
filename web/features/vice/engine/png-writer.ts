// Native incremental PNG writer: manages vice_png_stream lifecycle and execution.
// Strictly isolated to vice_png_stream native lifecycle.

import type { WasmMemory } from "./wasm-memory";

export class NativePngWriter {
  private destroyed = false;

  private constructor(
    private readonly mem: WasmMemory,
    private readonly st: number,
    readonly w: number,
    readonly h: number,
    readonly inChannels: number,
    readonly outChannels: number,
  ) {}

  static open(
    mem: WasmMemory,
    w: number,
    h: number,
    inChannels: number,
    outChannels: number,
    icc?: Uint8Array,
  ): NativePngWriter {
    const fn = mem.instance._vice_png_open;
    if (!fn) throw new Error("stale WASM core: vice_png_open missing");

    let iccPtr = 0;
    try {
      if (icc && icc.length > 0) {
        iccPtr = mem.writeBytes(icc);
      }
      const st = fn(w, h, inChannels, outChannels, iccPtr, icc?.length ?? 0);
      if (!st) throw new Error("vice_png_open failed (bad dimensions)");
      return new NativePngWriter(mem, st, w, h, inChannels, outChannels);
    } finally {
      if (iccPtr) mem.free(iccPtr);
    }
  }

  writeRows(rowsPtr: number, rowCount: number): void {
    this.assertAlive();
    const fn = this.mem.instance._vice_png_write_rows;
    if (!fn) throw new Error("stale WASM core: vice_png_write_rows missing");
    if (fn(this.st, rowsPtr, rowCount) !== 0) {
      throw new Error("vice_png_write_rows failed");
    }
  }

  drain(cap = 1 << 20): Uint8Array {
    this.assertAlive();
    const fn = this.mem.instance._vice_png_drain;
    if (!fn) throw new Error("stale WASM core: vice_png_drain missing");
    const outPtr = this.mem.malloc(cap);
    const writtenPtr = this.mem.malloc(8);
    try {
      if (fn(this.st, outPtr, cap, writtenPtr) !== 0) {
        throw new Error("vice_png_drain failed");
      }
      const written = this.mem.readUint32(writtenPtr);
      return this.mem.readBytes(outPtr, written);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(writtenPtr);
    }
  }

  close(): void {
    this.assertAlive();
    const fn = this.mem.instance._vice_png_close;
    if (!fn) throw new Error("stale WASM core: vice_png_close missing");
    if (fn(this.st) !== 0) {
      throw new Error("vice_png_close failed (incorrect row count or deflate error)");
    }
  }

  peakPending(): number {
    this.assertAlive();
    return this.mem.instance._vice_png_peak_pending?.(this.st) ?? 0;
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.mem.instance._vice_png_destroy?.(this.st);
    }
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("NativePngWriter has been destroyed");
  }
}
