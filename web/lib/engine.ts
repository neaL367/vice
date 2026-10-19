// vice engine wrapper: loads the WASM core once, exposes upscale with ABI check.
// Runs inside a Web Worker (never the main thread).
import type { Scale } from "../features/studio/model";
import type { ViceCore } from "../types/wasm";

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

// Burst inputs are fused jointly; five 1024px frames peak ≈170MB —
// comfortably inside the generic ceiling. Larger bursts refuse with guidance.
export const BURST_MAX_SIDE = 1024;
export const BURST_MAX_FRAMES = 8;

export function estimatePeakBytes(w: number, h: number, scale: number): number {
  const hr = w * scale * (h * scale);
  return hr * 8 * 3 + hr * 4 * 2 + w * h * 4 * 2;
}

// Tiling: inputs whose whole-image peak exceeds TILE_PEAK_BYTES are split
// into overlapping tiles (halo covers kernel/descriptor neighborhoods; unit
// test proves bit-exact agreement with whole-image runs). Each tile runs
// through the ranged export with the GLOBAL channel clamp range, so tile
// results stitch exactly; only valid regions are kept. Also yields real
// per-tile progress. Tiled scales are 2/3/4 (8× inputs are capped small).
export const TILE = 512;
export const HALO = 16;
const TILE_PEAK_BYTES = 256 * 1024 * 1024;

export function needsTiling(w: number, h: number, scale: number): boolean {
  return scale !== 8 && (w > TILE || h > TILE || estimatePeakBytes(w, h, scale) > TILE_PEAK_BYTES);
}

// Burst core layers ~6 float64 HR planes (x, shifted, up, back, corr, nd)
// plus n LR frame copies. hr = w·s·h·s, so hr·8·6 dominates; JS copies the
// frames (n·w·h·4) plus the RGBA result (hr·4).
// Five 1024px frames at 2× peak ≈260MB (inside the generic ceiling);
// the same input at 4× ≈850MB (refused with guidance — exceeds 768MB).
export function estimateBurstPeakBytes(w: number, h: number, scale: number, frames: number): number {
  const hr = w * scale * (h * scale);
  return hr * 8 * 6 + frames * w * h * 8 + hr * 4;
}

// One core instance per worker (single-threaded WASM; ABI checked at load).
let core: ViceCore | null = null;

async function load(): Promise<ViceCore> {
  if (core) return core;
  // Served from public/wasm (committed build output). The non-literal
  // specifier is deliberate: webpack/turbopackIgnore comments keep the
  // bundlers from rewriting it, and the non-static argument keeps TS from
  // trying to resolve files that only exist at runtime.
  const coreUrl = "/wasm/core.js";
  const mod = (await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ coreUrl
  )) as {
    default: () => Promise<ViceCore>;
  };
  const c = await mod.default();
  const abi: number = c._vice_abi_version();
  if (abi !== 5) throw new Error(`WASM ABI mismatch: got ${abi}, want 5`);
  core = c;
  return c;
}

export async function upscaleTile(
  pixels: Uint8ClampedArray,
  pw: number,
  ph: number,
  scale: Exclude<Scale, 8>,
  ranges: Float64Array,
  vx0: number,
  vy0: number,
  vx1: number,
  vy1: number,
  px0: number,
  py0: number,
): Promise<{ data: Uint8ClampedArray<ArrayBuffer>; validW: number; validH: number; residual: number }> {
  const c = await load();
  const pin = c._malloc(pixels.length);
  const outW = pw * scale;
  const outH = ph * scale;
  const pout = c._malloc(outW * outH * 4);
  const prange = c._malloc(64);
  if (!pin || !pout || !prange) {
    if (pin) c._free(pin);
    if (pout) c._free(pout);
    if (prange) c._free(prange);
    throw new Error("WASM out of memory while allocating tile buffers");
  }
  c.HEAPU8.set(pixels, pin);
  const view = new DataView(c.HEAPU8.buffer, prange, 64);
  for (let i = 0; i < 8; i++) view.setFloat64(i * 8, ranges[i], true);

  try {
    const rc: number = c._vice_upscale_ranged(pin, pw, ph, 4, scale, pout, prange);
    if (rc !== 0) throw new Error(`vice_upscale_ranged failed: ${rc}`);
    const residual: number = c._vice_last_residual();

    const validW = (vx1 - vx0) * scale;
    const validH = (vy1 - vy0) * scale;
    const validBytes = new Uint8ClampedArray(validW * validH * 4);
    const sx = (vx0 - px0) * scale;
    const len = validW * 4;

    for (let y = vy0; y < vy1; y++) {
      for (let dy = 0; dy < scale; dy++) {
        const sy = (y - py0) * scale + dy;
        const srcStart = pout + (sy * outW + sx) * 4;
        const dstStart = ((y - vy0) * scale + dy) * validW * 4;
        validBytes.set(c.HEAPU8.subarray(srcStart, srcStart + len), dstStart);
      }
    }

    return {
      data: validBytes as Uint8ClampedArray<ArrayBuffer>,
      validW,
      validH,
      residual,
    };
  } finally {
    c._free(pin);
    c._free(pout);
    c._free(prange);
  }
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
  // Tiling is owned by the main thread's worker pool (see use-studio-job);
  // a run message big enough to tile must never reach the worker.
  if (scale !== 8 && needsTiling(w, h, scale))
    throw new Error(
      `Internal dispatch error: ${w}×${h} at ${scale}× must run tiled, not whole-image.`,
    );
  const peak = estimatePeakBytes(w, h, scale);
  if (peak > PEAK_CAP_BYTES)
    throw new Error(
      `Too large for this device at ${scale}× (≈${Math.round(peak / 1048576)}MB working set). Try ${scale > 2 ? "2×" : "a smaller image"}.`,
    );
  const t0 = performance.now();
  const ow = w * scale;
  const oh = h * scale;
  const pin = c._malloc(input.length);
  const pout = c._malloc(ow * oh * 4);
  if (!pin || !pout) {
    if (pin) c._free(pin);
    if (pout) c._free(pout);
    throw new Error("WASM out of memory while allocating upscale buffers");
  }
  c.HEAPU8.set(input, pin);
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
  const bytes = new Uint8ClampedArray(ow * oh * 4);
  bytes.set(c.HEAPU8.subarray(pout, pout + ow * oh * 4));
  const residual: number = c._vice_last_residual();
  c._free(pin);
  c._free(pout);
  return { data: bytes, w: ow, h: oh, residual, ms: performance.now() - t0 };
}

/**
 * Burst fusion: n same-size RGBA frames through vice_upscale_burst with
 * NULL shifts (registration + gating in-core). Frame 0 is the reference.
 * Synchronous in-core — progress stays indeterminate (elapsed timer shows).
 */
export async function upscaleBurst(
  inputs: Uint8ClampedArray[],
  w: number,
  h: number,
  scale: Scale,
): Promise<UpscaleResult> {
  const c = await load();
  if (inputs.length < 2) throw new Error("Burst needs at least two frames.");
  if (inputs.length > BURST_MAX_FRAMES)
    throw new Error(`Burst takes at most ${BURST_MAX_FRAMES} frames (got ${inputs.length}).`);
  if (scale === 8) throw new Error("Burst stops at 4× — 8× fuses more than this device should attempt.");
  if (Math.max(w, h) > BURST_MAX_SIDE)
    throw new Error(
      `Burst frames larger than ${BURST_MAX_SIDE}px on the long side are refused (got ${Math.max(w, h)}px).`,
    );
  const peak = estimateBurstPeakBytes(w, h, scale, inputs.length);
  if (peak > PEAK_CAP_BYTES)
    throw new Error(
      `Burst working set too large for this device at ${scale}× with ${inputs.length} frames (≈${Math.round(peak / 1048576)}MB). Use fewer frames or 2×.`,
    );
  const t0 = performance.now();
  const pins: number[] = [];
  let ptab = 0;
  let pout = 0;
  try {
    for (const f of inputs) {
      if (f.length !== w * h * 4) throw new Error("Burst frames must share dimensions.");
      const p = c._malloc(f.length);
      if (!p) throw new Error("WASM out of memory while staging burst frames");
      c.HEAPU8.set(f, p);
      pins.push(p);
    }
    ptab = c._malloc(pins.length * 4);
    if (!ptab) throw new Error("WASM out of memory while building the burst frame table");
    const view = new DataView(c.HEAPU8.buffer, ptab, pins.length * 4);
    pins.forEach((p, i) => view.setUint32(i * 4, p, true));
    const ow = w * scale;
    const oh = h * scale;
    pout = c._malloc(ow * oh * 4);
    if (!pout) throw new Error("WASM out of memory while allocating the burst result");
    const rc: number = c._vice_upscale_burst(ptab, pins.length, w, h, 4, scale, pout, 0);
    if (rc !== 0) throw new Error(`vice_upscale_burst failed: ${rc}`);
    const bytes = new Uint8ClampedArray(ow * oh * 4);
    bytes.set(c.HEAPU8.subarray(pout, pout + ow * oh * 4));
    const residual: number = c._vice_last_residual();
    return { data: bytes, w: ow, h: oh, residual, ms: performance.now() - t0 };
  } finally {
    if (ptab) c._free(ptab);
    for (const p of pins) c._free(p);
    if (pout) c._free(pout);
  }
}
