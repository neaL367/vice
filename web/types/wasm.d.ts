// Vice WASM core surface (ABI 4). The Emscripten glue is served from
// public/wasm at runtime (non-literal runtime-only dynamic import in
// lib/engine.ts), so it has no bundled types; this declares what the
// engine layer may call. Kept in sync with core/wasm-build.ps1
// EXPORTED_FUNCTIONS.
export interface ViceCore {
  readonly HEAPU8: Uint8Array<ArrayBuffer>;
  readonly _malloc: (n: number) => number;
  readonly _free: (p: number) => void;
  readonly _vice_abi_version: () => number;
  readonly _vice_last_residual: () => number;
  readonly _vice_upscale: (
    inPtr: number,
    w: number,
    h: number,
    ch: number,
    scale: number,
    outPtr: number,
  ) => number;
  readonly _vice_upscale_ranged: (
    inPtr: number,
    w: number,
    h: number,
    ch: number,
    scale: number,
    outPtr: number,
    clampLoHiPtr: number,
  ) => number;
  readonly _vice_upscale_progressive: (
    inPtr: number,
    w: number,
    h: number,
    ch: number,
    scale: number,
    outPtr: number,
  ) => number;
  readonly _vice_upscale_burst: (
    frameTablePtr: number,
    n: number,
    w: number,
    h: number,
    ch: number,
    scale: number,
    outPtr: number,
    shiftsPtr: number, // 0 = NULL (in-core registration + gating)
  ) => number;
}
