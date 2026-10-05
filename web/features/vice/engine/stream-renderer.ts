// Native streaming strip renderer: manages vice_stream_ctx lifecycle and execution.
// Strictly isolated to vice_stream_ctx native lifecycle.

import type { WasmMemory } from "./wasm-memory";

export type FusedMode = "off" | "clean" | "detail";

export class NativeStreamContext {
  private destroyed = false;

  private constructor(
    private readonly mem: WasmMemory,
    private readonly sctx: number,
    readonly inW: number,
    readonly inH: number,
    readonly scale: number,
    readonly channels: number,
    readonly bandH: number,
  ) {}

  static create(
    mem: WasmMemory,
    inW: number,
    inH: number,
    scale: number,
    channels: number,
    bandH: number,
  ): NativeStreamContext {
    const fn = mem.instance._vice_stream_create;
    if (!fn) throw new Error("stale WASM core: vice_stream_create missing");
    const sctx = fn(inW, inH, scale, channels, bandH);
    if (!sctx) throw new Error("vice_stream_create failed (bad dimensions)");
    return new NativeStreamContext(mem, sctx, inW, inH, scale, channels, bandH);
  }

  get outW(): number {
    return this.inW * this.scale;
  }

  get outH(): number {
    return this.inH * this.scale;
  }

  setIccProfile(data: Uint8Array): void {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_set_icc_profile;
    if (!fn || data.length === 0) return;
    const ptr = this.mem.writeBytes(data);
    try {
      fn(this.sctx, ptr, data.length);
    } finally {
      this.mem.free(ptr);
    }
  }

  setFusedMode(mode: FusedMode): void {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_set_fused;
    if (!fn) throw new Error("stale WASM core: vice_stream_set_fused missing");
    const modeInt = mode === "off" ? 0 : mode === "clean" ? 1 : 2;
    if (fn(this.sctx, modeInt) !== 0) {
      throw new Error(`vice_stream_set_fused failed (mode=${mode})`);
    }
  }

  /** Slab origin for share-nothing renders (fresh ctx only). See vice.h. */
  beginSlab(inY0: number, outY0: number): void {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_begin_slab;
    if (!fn) throw new Error("stale WASM core: vice_stream_begin_slab missing");
    const rc = fn(this.sctx, inY0, outY0);
    if (rc !== 0) throw new Error(`vice_stream_begin_slab failed (${inY0}, ${outY0} rc=${rc})`);
  }

  pushInputRows(rows: Float32Array, rowCount: number): void {    this.assertAlive();
    if (rowCount <= 0 || !Number.isInteger(rowCount)) {
      throw new Error(`invalid row count: ${rowCount}`);
    }
    const fn = this.mem.instance._vice_stream_push_input_rows;
    if (!fn) throw new Error("stale WASM core: vice_stream_push_input_rows missing");
    const ptr = this.mem.writeFloats(rows);
    try {
      if (fn(this.sctx, ptr, rowCount) !== 0) {
        throw new Error("vice_stream_push_input_rows failed");
      }
    } finally {
      this.mem.free(ptr);
    }
  }

  hasNextBand(): boolean {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_has_next_band;
    if (!fn) throw new Error("stale WASM core: vice_stream_has_next_band missing");
    return fn(this.sctx) === 1;
  }

  pullBand(outPtr: number, maxRows: number): { rc: number; rows: number } {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_pull_band;
    if (!fn) throw new Error("stale WASM core: vice_stream_pull_band missing");
    const countPtr = this.mem.malloc(4);
    try {
      const rc = fn(this.sctx, outPtr, countPtr);
      const rows = this.mem.readInt32(countPtr);
      if (rc < 0 || rows < 0 || rows > maxRows) {
        throw new Error(`vice_stream_pull_band failed (rc=${rc}, rows=${rows})`);
      }
      return { rc, rows };
    } finally {
      this.mem.free(countPtr);
    }
  }

  finishPng(rgbaPtr: number, cells: number): Uint8Array {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_finish_png;
    if (!fn) throw new Error("stale WASM core: vice_stream_finish_png missing");
    const cap = cells + 1024 * 1024;
    const outPtr = this.mem.malloc(cap);
    const writtenPtr = this.mem.malloc(8);
    try {
      const rc = fn(this.sctx, rgbaPtr, cells, outPtr, cap, writtenPtr);
      if (rc !== 0) throw new Error(`vice_stream_finish_png failed (${rc})`);
      const written = this.mem.readUint32(writtenPtr);
      return this.mem.readBytes(outPtr, written);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(writtenPtr);
    }
  }

  lastResidual(): number {
    this.assertAlive();
    const fn = this.mem.instance._vice_stream_last_residual;
    if (!fn) return NaN;
    return fn(this.sctx);
  }

  destroy(): void {
    if (!this.destroyed) {
      this.destroyed = true;
      this.mem.instance._vice_stream_destroy?.(this.sctx);
    }
  }

  [Symbol.dispose](): void {
    this.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("NativeStreamContext has been destroyed");
  }
}

/** Input halo rows beyond an owned window (mirrors the C strip-req math). */
export function haloRows(mem: WasmMemory, scale: number, fused: 0 | 1 | 2): { top: number; bottom: number } {
  const fn = mem.instance._vice_stream_halo_rows;
  if (!fn) throw new Error("stale WASM core: vice_stream_halo_rows missing");
  const topPtr = mem.malloc(4);
  const bottomPtr = mem.malloc(4);
  try {
    fn(scale, fused, topPtr, bottomPtr);
    return { top: mem.readInt32(topPtr), bottom: mem.readInt32(bottomPtr) };
  } finally {
    mem.free(topPtr);
    mem.free(bottomPtr);
  }
}
