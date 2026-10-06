// Deterministic degradation probes (ticket 06): noise level + JPEG-grid score.
// No learning, no thresholds fit on natural images — constants documented.

import type { GrayImage } from "./kernels.ts";

/**
 * Global noise σ̂ via MAD of discrete Laplacian, in levels.
 * Calibration: Laplacian of iid Gaussian σ has MAD ≈ 3.01σ (sums |taps|=8,
 * var 20σ², MAD 0.6745·√20·σ). Reports signal-HF as "noise" on texture —
 * fundamental MAD limit, documented: consumers must gate by structure
 * (adaptive.ts does via strength), never trust σ̂ absolutely.
 */
export function estimateNoiseSigma(lr: GrayImage): number {
  const { w, h, data: d } = lr;
  const res: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      res.push(Math.abs(4 * d[i] - d[i - 1] - d[i + 1] - d[i - w] - d[i + w]));
    }
  res.sort((a, b) => a - b);
  const mad = res.length % 2 === 0 ? (res[res.length / 2 - 1] + res[res.length / 2]) / 2 : res[(res.length - 1) / 2];
  return mad / 3.01;
}

/**
 * JPEG-grid score: mean |horizontal diff| on columns x≡0 (mod period) divided
 * by global mean |horizontal diff|, likewise vertical, averaged. ≈1 for
 * natural/smooth content, >1 when a block grid imprints boundary troughs.
 * `period` is in pixels of the passed image (8 for full-res JPEG simulation).
 */
export function jpegGridScore(img: GrayImage, period = 8): number {
  const { w, h, data: d } = img;
  let on = 0;
  let onN = 0;
  let all = 0;
  let allN = 0;
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) {
      const v = Math.abs(d[y * w + x] - d[y * w + x - 1]);
      all += v;
      allN++;
      if (x % period === 0) {
        on += v;
        onN++;
      }
    }
  let onV = 0;
  let onVN = 0;
  let allV = 0;
  let allVN = 0;
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.abs(d[y * w + x] - d[(y - 1) * w + x]);
      allV += v;
      allVN++;
      if (y % period === 0) {
        onV += v;
        onVN++;
      }
    }
  if (all === 0 || allV === 0) return 1;
  return (on / onN / (all / allN) + onV / onVN / (allV / allVN)) / 2;
}
