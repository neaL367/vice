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

// Tiling: inputs whose whole-image peak exceeds TILE_PEAK_BYTES are split
// into overlapping tiles (halo covers kernel/descriptor neighborhoods; unit
// test proves bit-exact agreement with whole-image runs). Each tile runs
// through the ranged export with the GLOBAL channel clamp range, so tile
// results stitch exactly; only valid regions are kept. Also yields real
// per-tile progress. Tiled scales are 2/3/4 (8× inputs are capped small).
const TILE = 512;
const HALO = 16;
const TILE_PEAK_BYTES = 256 * 1024 * 1024;

export function needsTiling(w: number, h: number, scale: number): boolean {
  return scale !== 8 && estimatePeakBytes(w, h, scale) > TILE_PEAK_BYTES;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Core = any;

async function upscaleTiled(
  c: Core,
  input: Uint8ClampedArray,
  w: number,
  h: number,
  scale: Exclude<Scale, 8>,
  onProgress?: (done: number, total: number) => void,
): Promise<UpscaleResult> {
  const t0 = performance.now();
  const ow = w * scale;
  const oh = h * scale;
  const out = new Uint8ClampedArray(ow * oh * 4);
  // Global per-channel clamp range (RGBA) keeps tiles consistent with whole.
  const ranges = new Float64Array(8);
  for (let ch = 0; ch < 4; ch++) {
    let lo = 255;
    let hi = 0;
    for (let i = ch; i < input.length; i += 4) {
      const v = input[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    ranges[ch * 2] = lo;
    ranges[ch * 2 + 1] = hi;
  }
  // Valid cells partition the image (last cell takes the remainder, however
  // short); padded regions add halo on all sides, clipped to the image.
  const xBounds: number[] = [];
  for (let x = 0; x < w; x += TILE) xBounds.push(x);
  xBounds.push(w);
  const yBounds: number[] = [];
  for (let y = 0; y < h; y += TILE) yBounds.push(y);
  yBounds.push(h);
  const total = (xBounds.length - 1) * (yBounds.length - 1);
  let done = 0;
  let residual = 0;
  for (let cy = 0; cy < yBounds.length - 1; cy++)
    for (let cx = 0; cx < xBounds.length - 1; cx++) {
      const vx0 = xBounds[cx];
      const vy0 = yBounds[cy];
      const vx1 = xBounds[cx + 1];
      const vy1 = yBounds[cy + 1];
      const px0 = Math.max(0, vx0 - HALO);
      const py0 = Math.max(0, vy0 - HALO);
      const px1 = Math.min(w, vx1 + HALO);
      const py1 = Math.min(h, vy1 + HALO);
      const pw = px1 - px0;
      const ph = py1 - py0;
      const tile = new Uint8ClampedArray(pw * ph * 4);
      for (let y = 0; y < ph; y++)
        tile.set(input.subarray(((py0 + y) * w + px0) * 4, ((py0 + y) * w + px1) * 4), y * pw * 4);
      const pin = c._malloc(tile.length);
      c.HEAPU8.set(tile, pin);
      const pout = c._malloc(pw * scale * ph * scale * 4);
      const prange = c._malloc(64);
      const view = new DataView(c.HEAPU8.buffer, prange, 64);
      for (let i = 0; i < 8; i++) view.setFloat64(i * 8, ranges[i], true);
      const rc: number = c._vice_upscale_ranged(pin, pw, ph, 4, scale, pout, prange);
      c._free(pin);
      c._free(prange);
      if (rc !== 0) {
        c._free(pout);
        throw new Error(`vice_upscale_ranged failed: ${rc}`);
      }
      const tbytes = c.HEAPU8.slice(pout, pout + pw * scale * ph * scale * 4);
      c._free(pout);
      residual = Math.max(residual, c._vice_last_residual());
      // Keep only the valid region (halo discarded). Each input row fans
      // out to S output rows.
      const sx = (vx0 - px0) * scale;
      for (let y = vy0; y < vy1; y++)
        for (let dy = 0; dy < scale; dy++) {
          const sy = (y - py0) * scale + dy;
          const len = (vx1 - vx0) * scale * 4;
          out.set(
            tbytes.subarray((sy * pw * scale + sx) * 4, (sy * pw * scale + sx) * 4 + len),
            ((y * scale + dy) * ow + vx0 * scale) * 4,
          );
        }
      done++;
      onProgress?.(done, total);
      // Yield so progress paints (WASM calls are synchronous).
      await new Promise((r) => setTimeout(r, 0));
    }
  return { data: out, w: ow, h: oh, residual, ms: performance.now() - t0 };
}
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
  if (abi !== 4) throw new Error(`WASM ABI mismatch: got ${abi}, want 4`);
  core = c;
  return c;
}

export async function upscaleImage(
  input: Uint8ClampedArray,
  w: number,
  h: number,
  scale: Scale,
  onProgress?: (done: number, total: number) => void,
): Promise<UpscaleResult> {
  const c = await load();
  if (scale === 8 && !fitsEightX(w, h))
    throw new Error(
      `8× needs an input ≤512px on the long side (this one is ${Math.max(w, h)}px). Use a smaller image or 4×.`,
    );
  if (scale !== 8 && needsTiling(w, h, scale))
    return upscaleTiled(c, input, w, h, scale, onProgress);
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
