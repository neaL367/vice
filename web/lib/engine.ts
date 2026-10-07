// vice engine wrapper: loads the WASM core once, exposes upscale with ABI check.
// Runs inside a Web Worker (never the main thread).
import type { Scale } from "../features/studio/model";

export interface UpscaleResult {
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  residual: number;
  ms: number;
}

// Memory ceiling: peak transient is dominated by float64 HR planes
// (W²·s²·8B per channel plus upsample/descriptor temps ≈ ×3) plus I/O.
// Refuse with guidance instead of OOMing the worker tab. Calibrated
// conservatively: 768MB cap. Note for the 8× ship: 2048² input at 8×
// needs ~6.4GB — 8× will require its own lower input cap (~512px).
const PEAK_CAP_BYTES = 768 * 1024 * 1024;

// 8× needs ~6.4GB at the 2048px input cap, so it carries its own input cap:
// 512px longest side peaks ≈500MB, inside the generic ceiling with margin.
export const EIGHT_X_MAX_SIDE = 512;

export function fitsEightX(w: number, h: number): boolean {
  return Math.max(w, h) <= EIGHT_X_MAX_SIDE;
}

export function estimatePeakBytes(w: number, h: number, scale: number): number {
  const hr = w * scale * (h * scale);
  return hr * 8 * 3 + hr * 4 * 2 + w * h * 4 * 2;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Core = any;
let core: Core | null = null;

async function load(): Promise<Core> {
  if (core) return core;
  // Served from public/wasm (committed build output). webpackIgnore keeps
  // Next from trying to bundle the Emscripten glue; it loads at runtime.
  const mod = (await import(/* webpackIgnore: true */ "/wasm/core.js")) as {
    default: () => Promise<Core>;
  };
  const c = await mod.default();
  const abi: number = c._vice_abi_version();
  if (abi !== 2) throw new Error(`WASM ABI mismatch: got ${abi}, want 2`);
  core = c;
  return c;
}

export async function upscaleImage(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  scale: Scale,
): Promise<UpscaleResult> {
  const c = await load();
  if (scale === 8 && !fitsEightX(w, h))
    throw new Error(
      `8× needs an input ≤512px on the long side (this one is ${Math.max(w, h)}px). Use a smaller image or 4×.`,
    );
  const peak = estimatePeakBytes(w, h, scale);
  if (peak > PEAK_CAP_BYTES)
    throw new Error(
      `Too large for this device at ${scale}× (≈${Math.round(peak / 1048576)}MB working set). Try ${scale > 2 ? "2×" : "a smaller image"}.`,
    );
  const t0 = performance.now();
  const pin = c._malloc(input.length);
  c.HEAPU8.set(input, pin);
  const ow = w * scale;
  const oh = h * scale;
  const pout = c._malloc(ow * oh * 4);
  // Scale 8 runs the hierarchical progressive export (staged 2→4→8 in-core);
  // 2/3/4 use the direct entry (4 is staged 2→4 since the Stage-4 adoption).
  const rc: number =
    scale === 8
      ? c._vice_upscale_progressive(pin, w, h, 4, scale, pout)
      : c._vice_upscale(pin, w, h, 4, scale, pout);
  if (rc !== 0) {
    c._free(pin);
    c._free(pout);
    throw new Error(`vice_upscale failed: ${rc}`);
  }
  const bytes = new Uint8ClampedArray(
    c.HEAPU8.slice(pout, pout + ow * oh * 4).buffer as ArrayBuffer,
  );
  const residual: number = c._vice_last_residual();
  c._free(pin);
  c._free(pout);
  return { data: bytes, w: ow, h: oh, residual, ms: performance.now() - t0 };
}
