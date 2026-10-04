// Loader for the prebuilt C++ core (public/wasm/core.js / core.threaded.js).
// Handles load, version, and capability detection only.

export interface ViceCoreInstance {
  _vice_create(inW: number, inH: number, scale: number, channels: number): number;
  _vice_set_input(ctx: number, yPtr: number, n: number): number;
  _vice_submit_raw_tile(
    ctx: number,
    tx: number,
    ty: number,
    tilePtr: number,
    tw: number,
    th: number,
    n: number,
  ): number;
  _vice_upscale?(ctx: number): number;
  _vice_project(ctx: number): number;
  _vice_download_raw(ctx: number, outPtr: number, n: number): number;
  _vice_process_band(ctx: number, band: number, outPtr: number, countPtr: number): number;
  _vice_finish_png(ctx: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_set_icc_profile?(ctx: number, dataPtr: number, size: number): number;
  _vice_stream_create?(inW: number, inH: number, scale: number, channels: number, bandH: number): number;
  _vice_stream_set_icc_profile?(sctx: number, dataPtr: number, size: number): number;
  _vice_stream_push_input_rows?(sctx: number, rowsPtr: number, rowCount: number): number;
  _vice_stream_has_next_band?(sctx: number): number;
  _vice_stream_pull_band?(sctx: number, outPtr: number, countPtr: number): number;
  _vice_stream_finish_png?(sctx: number, rgbaPtr: number, n: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_stream_last_residual?(sctx: number): number;
  _vice_stream_set_fused?(sctx: number, mode: number): number;
  _vice_stream_destroy?(sctx: number): void;
  _vice_png_open?(w: number, h: number, inCh: number, outCh: number, iccPtr: number, iccSize: number): number;
  _vice_png_write_rows?(st: number, rowsPtr: number, rowCount: number): number;
  _vice_png_drain?(st: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_png_close?(st: number): number;
  _vice_png_destroy?(st: number): void;
  _vice_png_peak_pending?(st: number): number;
  _vice_thread_workers?(): number;
  _vice_last_residual(ctx: number): number;
  _vice_destroy(ctx: number): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
}

export type CoreFactory = () => Promise<ViceCoreInstance>;

export interface LoadedModule {
  instance: ViceCoreInstance;
  threaded: boolean;
}

async function importCore(base: string, file: string): Promise<ViceCoreInstance | null> {
  const directPath = `${base}wasm/${file}`;
  try {
    const mod = (await import(/* turbopackIgnore: true */ directPath)) as { default: CoreFactory };
    return await mod.default();
  } catch {
    // If running in Bun/Node tests with a relative path (e.g. "../public/"),
    // resolve relative to process.cwd() or import.meta.url
    if (typeof process !== "undefined" && typeof process.cwd === "function") {
      try {
        const fallback = new URL(`../../../public/wasm/${file}`, import.meta.url).href;
        const mod = (await import(/* turbopackIgnore: true */ fallback)) as { default: CoreFactory };
        return await mod.default();
      } catch {
        // failed fallback
      }
    }
    return null;
  }
}

export async function loadWasmModule(base: string): Promise<LoadedModule | null> {
  // Threaded core first when page is cross-origin isolated
  if (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) {
    const core = await importCore(base, "core.threaded.js");
    if (core && typeof core._vice_create === "function") {
      return { instance: core, threaded: true };
    }
  }

  const core = await importCore(base, "core.js");
  if (core && typeof core._vice_create === "function") {
    return { instance: core, threaded: false };
  }
  return null;
}

