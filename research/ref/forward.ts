// Forward model: y = DHx + n with box decimation D (+ optional gaussian H).
// Reference uses H = identity unless blurSigma > 0 (then separable gaussian prefilter).
// All float64. Box D averages each s×s block — the exact-sum guarantee domain.

import type { GrayImage } from "./kernels.ts";

function gaussianKernel1D(sigma: number): { taps: Float64Array; radius: number } {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const taps = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    taps[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < taps.length; i++) taps[i] /= sum;
  return { taps, radius };
}

export function gaussianBlur(src: GrayImage, sigma: number): GrayImage {
  if (sigma <= 0) return src;
  const { taps, radius } = gaussianKernel1D(sigma);
  const { w, h, data } = src;
  const tmp = new Float64Array(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const ix = Math.min(w - 1, Math.max(0, x + k));
        acc += data[y * w + ix] * taps[k + radius];
      }
      tmp[y * w + x] = acc;
    }
  const out = new Float64Array(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const iy = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[iy * w + x] * taps[k + radius];
      }
      out[y * w + x] = acc;
    }
  return { w, h, data: out };
}

/** Box decimation D: average each s×s block. Requires w,h divisible by s. */
export function boxDownsample(hr: GrayImage, s: number): GrayImage {
  if (hr.w % s !== 0 || hr.h % s !== 0) throw new Error(`image ${hr.w}x${hr.h} not divisible by ${s}`);
  const w = hr.w / s;
  const h = hr.h / s;
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) acc += hr.data[(y * s + dy) * hr.w + x * s + dx];
      data[y * w + x] = acc / (s * s);
    }
  return { w, h, data };
}

/** Full forward simulation: DHx (+ optional deterministic noise fn). */
export function simulateForward(
  hr: GrayImage,
  s: number,
  opts: { blurSigma?: number; noiseFn?: (x: number, y: number) => number } = {},
): GrayImage {
  const blurred = gaussianBlur(hr, opts.blurSigma ?? 0);
  const lr = boxDownsample(blurred, s);
  if (opts.noiseFn) {
    const out = new Float64Array(lr.data.length);
    for (let y = 0; y < lr.h; y++)
      for (let x = 0; x < lr.w; x++) out[y * lr.w + x] = lr.data[y * lr.w + x] + (opts.noiseFn(x, y) ?? 0);
    return { w: lr.w, h: lr.h, data: out };
  }
  return lr;
}

/** RMS forward residual ‖DHx − y‖ over LR pixels. Primary consistency metric. */
export function forwardResidual(hr: GrayImage, lr: GrayImage, s: number, blurSigma = 0): number {
  const pred = simulateForward(hr, s, { blurSigma });
  if (pred.w !== lr.w || pred.h !== lr.h) throw new Error("dimension mismatch in residual");
  let se = 0;
  for (let i = 0; i < pred.data.length; i++) {
    const d = pred.data[i] - lr.data[i];
    se += d * d;
  }
  return Math.sqrt(se / pred.data.length);
}

/**
 * Exact box projection Π: distribute each block's mean error evenly over its
 * s×s pixels so every block mean equals the LR sample exactly.
 * (Reference analog of shipped vice_project_box; unclamped — clamping lives in ibp.ts.)
 */
export function projectBox(hr: GrayImage, lr: GrayImage, s: number): GrayImage {
  if (hr.w !== lr.w * s || hr.h !== lr.h * s) throw new Error("dimension mismatch in projectBox");
  const out = new Float64Array(hr.data);
  for (let y = 0; y < lr.h; y++)
    for (let x = 0; x < lr.w; x++) {
      let acc = 0;
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) acc += out[(y * s + dy) * hr.w + x * s + dx];
      const corr = lr.data[y * lr.w + x] - acc / (s * s);
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) out[(y * s + dy) * hr.w + x * s + dx] += corr;
    }
  return { w: hr.w, h: hr.h, data: out };
}
