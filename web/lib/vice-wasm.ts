// Compatibility facade for existing callers.
// Delegates internally to web/features/vice/engine/ focused modules.

import { loadWasmModule, type ViceCoreInstance } from "../features/vice/engine/wasm-module";
import { WasmMemory } from "../features/vice/engine/wasm-memory";
import {
  hasFullSupport,
  hasNativeUpscale,
  hasStreamSupport,
  hasInfiniteSupport,
  getThreadWorkers,
} from "../features/vice/engine/capabilities";

export class ViceCore {
  private readonly mem: WasmMemory;

  private constructor(
    private readonly core: ViceCoreInstance,
    readonly outW: number,
    readonly outH: number,
    readonly channels: number,
    readonly threaded: boolean = false,
  ) {
    this.mem = new WasmMemory(core);
  }

  static async load(base: string): Promise<ViceCore | null> {
    const loaded = await loadWasmModule(base);
    if (!loaded) return null;
    return new ViceCore(loaded.instance, 0, 0, 0, loaded.threaded);
  }

  get instance(): ViceCoreInstance {
    return this.core;
  }

  get memory(): WasmMemory {
    return this.mem;
  }

  threadWorkers(): number {
    return getThreadWorkers(this.core);
  }

  hasNativeUpscale(): boolean {
    return hasNativeUpscale(this.core);
  }

  hasFull(): boolean {
    return hasFullSupport(this.core);
  }

  hasStream(): boolean {
    return hasStreamSupport(this.core);
  }

  hasInfinite(): boolean {
    return hasInfiniteSupport(this.core);
  }

  create(inW: number, inH: number, scale: number, channels: number): number {
    const ctx = this.core._vice_create(inW, inH, scale, channels);
    if (!ctx) throw new Error("vice_create failed (bad dims or OOM)");
    return ctx;
  }

  setInput(ctx: number, y: Float32Array): void {
    const ptr = this.mem.writeFloats(y);
    try {
      if (this.core._vice_set_input(ctx, ptr, y.length) !== 0) {
        throw new Error("vice_set_input failed");
      }
    } finally {
      this.mem.free(ptr);
    }
  }

  submitFullRaw(ctx: number, raw: Float32Array, outW: number, outH: number): void {
    const ptr = this.mem.writeFloats(raw);
    try {
      if (this.core._vice_submit_raw_tile(ctx, 0, 0, ptr, outW, outH, raw.length) !== 0) {
        throw new Error("vice_submit_raw_tile failed");
      }
    } finally {
      this.mem.free(ptr);
    }
  }

  upscale(ctx: number): void {
    if (this.core._vice_upscale && this.core._vice_upscale(ctx) !== 0) {
      throw new Error("vice_upscale failed");
    }
  }

  project(ctx: number): void {
    if (this.core._vice_project(ctx) !== 0) throw new Error("vice_project failed");
  }

  downloadRaw(ctx: number, cells: number): Float32Array {
    const ptr = this.mem.malloc(cells * 4);
    try {
      if (this.core._vice_download_raw(ctx, ptr, cells) !== 0) {
        throw new Error("vice_download_raw failed");
      }
      return this.mem.readFloats(ptr, cells);
    } finally {
      this.mem.free(ptr);
    }
  }

  lastResidual(ctx: number): number {
    return this.core._vice_last_residual(ctx);
  }

  setIccProfile(ctx: number, data: Uint8Array): void {
    if (!this.core._vice_set_icc_profile || data.length === 0) return;
    const ptr = this.mem.writeBytes(data);
    try {
      this.core._vice_set_icc_profile(ctx, ptr, data.length);
    } finally {
      this.mem.free(ptr);
    }
  }

  processBand(ctx: number, band: number, outW: number, _maxRows: number, channels: number): Uint8Array {
    const bytes = 64 * outW * channels;
    const outPtr = this.mem.malloc(bytes);
    const countPtr = this.mem.malloc(4);
    try {
      if (this.core._vice_process_band(ctx, band, outPtr, countPtr) !== 0) {
        throw new Error("vice_process_band failed");
      }
      const actualRows = this.mem.readInt32(countPtr);
      const writtenBytes = actualRows * outW * channels;
      return this.mem.readBytes(outPtr, writtenBytes);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(countPtr);
    }
  }

  finishPng(ctx: number, outW: number, outH: number, channels: number): Uint8Array {
    const cap = outW * outH * channels + 1024 * 1024;
    const outPtr = this.mem.malloc(cap);
    const writtenPtr = this.mem.malloc(8);
    try {
      const rc = this.core._vice_finish_png(ctx, outPtr, cap, writtenPtr);
      if (rc !== 0) throw new Error(`vice_finish_png failed (${rc})`);
      const written = this.mem.readUint32(writtenPtr);
      return this.mem.readBytes(outPtr, written);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(writtenPtr);
    }
  }

  destroy(ctx: number): void {
    this.core._vice_destroy(ctx);
  }

  // --- Streaming strip pipeline ----------------------------------------

  createStream(inW: number, inH: number, scale: number, channels: number, bandH: number): number {
    const sctx = this.core._vice_stream_create!(inW, inH, scale, channels, bandH);
    if (!sctx) throw new Error("vice_stream_create failed (bad dims)");
    return sctx;
  }

  streamSetIcc(sctx: number, data: Uint8Array): void {
    if (!this.core._vice_stream_set_icc_profile || data.length === 0) return;
    const ptr = this.mem.writeBytes(data);
    try {
      this.core._vice_stream_set_icc_profile(sctx, ptr, data.length);
    } finally {
      this.mem.free(ptr);
    }
  }

  streamPushRows(sctx: number, rows: Float32Array, rowCount: number): void {
    if (rowCount <= 0 || !Number.isInteger(rowCount)) throw new Error("bad row count");
    const ptr = this.mem.writeFloats(rows);
    try {
      if (this.core._vice_stream_push_input_rows!(sctx, ptr, rowCount) !== 0) {
        throw new Error("vice_stream_push_input_rows failed");
      }
    } finally {
      this.mem.free(ptr);
    }
  }

  streamHasNext(sctx: number): boolean {
    return this.core._vice_stream_has_next_band!(sctx) === 1;
  }

  streamPullBand(sctx: number, outPtr: number, maxRows: number): { rc: number; rows: number } {
    const countPtr = this.mem.malloc(4);
    try {
      const rc = this.core._vice_stream_pull_band!(sctx, outPtr, countPtr);
      const rows = this.mem.readInt32(countPtr);
      if (rc < 0 || rows < 0 || rows > maxRows) {
        throw new Error(`vice_stream_pull_band failed (rc=${rc})`);
      }
      return { rc, rows };
    } finally {
      this.mem.free(countPtr);
    }
  }

  streamFinishPng(sctx: number, rgbaPtr: number, cells: number): Uint8Array {
    const cap = cells + 1024 * 1024;
    const outPtr = this.mem.malloc(cap);
    const writtenPtr = this.mem.malloc(8);
    try {
      const rc = this.core._vice_stream_finish_png!(sctx, rgbaPtr, cells, outPtr, cap, writtenPtr);
      if (rc !== 0) throw new Error(`vice_stream_finish_png failed (${rc})`);
      const written = this.mem.readUint32(writtenPtr);
      return this.mem.readBytes(outPtr, written);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(writtenPtr);
    }
  }

  streamDestroy(sctx: number): void {
    this.core._vice_stream_destroy!(sctx);
  }

  streamSetFused(sctx: number, mode: 0 | 1 | 2): void {
    if (!this.core._vice_stream_set_fused) throw new Error("stale core.js: no fused 4x");
    if (this.core._vice_stream_set_fused(sctx, mode) !== 0) {
      throw new Error(`vice_stream_set_fused failed (mode=${mode})`);
    }
  }

  // --- Incremental PNG writer -------------------------------------------

  pngOpen(w: number, h: number, inCh: number, outCh: number, icc?: Uint8Array): number {
    let iccPtr = 0;
    try {
      if (icc && icc.length > 0) {
        iccPtr = this.mem.writeBytes(icc);
      }
      const st = this.core._vice_png_open!(w, h, inCh, outCh, iccPtr, icc?.length ?? 0);
      if (!st) throw new Error("vice_png_open failed (bad dims)");
      return st;
    } finally {
      if (iccPtr) this.mem.free(iccPtr);
    }
  }

  pngWriteRows(st: number, rowsPtr: number, rowCount: number): void {
    if (this.core._vice_png_write_rows!(st, rowsPtr, rowCount) !== 0) {
      throw new Error("vice_png_write_rows failed");
    }
  }

  pngDrain(st: number, cap = 1 << 20): Uint8Array {
    const outPtr = this.mem.malloc(cap);
    const writtenPtr = this.mem.malloc(8);
    try {
      if (this.core._vice_png_drain!(st, outPtr, cap, writtenPtr) !== 0) {
        throw new Error("vice_png_drain failed");
      }
      const written = this.mem.readUint32(writtenPtr);
      return this.mem.readBytes(outPtr, written);
    } finally {
      this.mem.free(outPtr);
      this.mem.free(writtenPtr);
    }
  }

  pngClose(st: number): void {
    if (this.core._vice_png_close!(st) !== 0) throw new Error("vice_png_close failed");
  }

  pngDestroy(st: number): void {
    this.core._vice_png_destroy!(st);
  }

  lastStreamResidual(sctx: number): number {
    if (!this.core._vice_stream_last_residual) return NaN;
    return this.core._vice_stream_last_residual(sctx);
  }

  mallocBytes(n: number): number {
    return this.mem.malloc(n);
  }

  freeBytes(ptr: number): void {
    this.mem.free(ptr);
  }

  copyBytes(srcPtr: number, dstPtr: number, n: number): void {
    this.mem.copyBytes(srcPtr, dstPtr, n);
  }

  readBytes(ptr: number, n: number): Uint8Array {
    return this.mem.readBytes(ptr, n);
  }

  writeBytes(data: Uint8Array): number {
    return this.mem.writeBytes(data);
  }
}
