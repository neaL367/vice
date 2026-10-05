// Loader for the prebuilt C++ core (public/wasm/core.js).
// Handles load, version, and capability detection only.

export interface ViceCoreInstance {
  _vice_abi_version?(): number;
  _vice_stream_create?(inW: number, inH: number, scale: number, channels: number, bandH: number): number;
  _vice_stream_set_icc_profile?(sctx: number, dataPtr: number, size: number): number;
  _vice_stream_push_input_rows?(sctx: number, rowsPtr: number, rowCount: number): number;
  _vice_stream_has_next_band?(sctx: number): number;
  _vice_stream_pull_band?(sctx: number, outPtr: number, countPtr: number): number;
  _vice_stream_finish_png?(sctx: number, rgbaPtr: number, n: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_stream_last_residual?(sctx: number): number;
  _vice_stream_set_fused?(sctx: number, mode: number): number;
  _vice_stream_destroy?(sctx: number): void;
  _vice_stream_halo_rows?(scale: number, fused: number, topPtr: number, bottomPtr: number): void;
  _vice_stream_begin_slab?(sctx: number, inY0: number, outY0: number): number;
  _vice_stream_memory_bytes?(inW: number, inH: number, scale: number, ch: number, bandH: number, fused: number): number;
  _vice_png_open?(w: number, h: number, inCh: number, outCh: number, iccPtr: number, iccSize: number): number;
  _vice_png_write_rows?(st: number, rowsPtr: number, rowCount: number): number;
  _vice_png_drain?(st: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_png_close?(st: number): number;
  _vice_png_destroy?(st: number): void;
  _vice_png_peak_pending?(st: number): number;
  _vice_png_segment_open?(w: number, rows: number, inCh: number, outCh: number): number;
  _vice_png_segment_write_rows?(seg: number, rowsPtr: number, rowCount: number): number;
  _vice_png_segment_finish?(seg: number, isLast: number, adlerPtr: number, lenPtr: number): number;
  _vice_png_segment_drain?(seg: number, outPtr: number, cap: number, writtenPtr: number): number;
  _vice_png_segment_destroy?(seg: number): void;
  _vice_adler32_combine?(ad1: number, ad2: number, len2: number): number;
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

// Must match VICE_ABI_VERSION in core/include/vice.h. Bump together;
// mismatch is a hard error, never a silent fallback.
export const EXPECTED_ABI_VERSION = 1;

/** Version handshake: replaces per-function typeof probing for the core. */
export function assertAbiVersion(instance: ViceCoreInstance): void {
  const v = instance._vice_abi_version?.();
  if (v !== EXPECTED_ABI_VERSION) {
    throw new Error(
      `Vice ABI mismatch: core reports ${v}, expected ${EXPECTED_ABI_VERSION}. Rebuild web/public/wasm.`,
    );
  }
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
  // Single-thread core only: slab workers each load their own instance.
  const core = await importCore(base, "core.js");
  if (core && typeof core._vice_stream_create === "function") {
    assertAbiVersion(core);
    return { instance: core, threaded: false };
  }
  return null;
}

