// Color-correct reference ops (ticket 06). Constants mirror core/src/color.cpp
// exactly (sRGB EOTF piecewise). Energy ops (residual, projection, downsample)
// belong in linear light; storage/scores stay sRGB. Alpha has no colorimetry:
// its sums are always exact via the same Π.

import { boxDownsample, projectBox } from "./forward.ts";
import { upsample, type GrayImage } from "./kernels.ts";

export function srgbToLinear(v: number): number {
  if (!(v > 0)) return 0;
  if (v <= 0.04045) return v / 12.92;
  return ((v + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 1) return 1;
  if (v <= 0.0031308) return v * 12.92;
  return 1.055 * v ** (1 / 2.4) - 0.055;
}

export interface RgbImage {
  w: number;
  h: number;
  r: GrayImage;
  g: GrayImage;
  b: GrayImage;
  a?: GrayImage; // straight (non-premultiplied) alpha, 0..255
}

const LUMA = [0.2126, 0.7152, 0.0722];

/** sRGB bytes → linear-light channels in 0..1. */
export function toLinear(rgb: RgbImage): { w: number; h: number; r: Float64Array; g: Float64Array; b: Float64Array } {
  const n = rgb.w * rgb.h;
  const r = new Float64Array(n);
  const g = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = srgbToLinear(rgb.r.data[i] / 255);
    g[i] = srgbToLinear(rgb.g.data[i] / 255);
    b[i] = srgbToLinear(rgb.b.data[i] / 255);
  }
  return { w: rgb.w, h: rgb.h, r, g, b };
}

/** Linear-light luma field (BT.709 weights). */
export function linearLuma(lin: { r: Float64Array; g: Float64Array; b: Float64Array }): Float64Array {
  const n = lin.r.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = LUMA[0] * lin.r[i] + LUMA[1] * lin.g[i] + LUMA[2] * lin.b[i];
  return out;
}

/**
 * Chroma probe (ticket 06 acceptance): reconstruct luma with IBP-grade effort
 * and chroma with bilinear+project, vs full effort on all channels.
 * Returns per-pixel chroma reconstruction error proxy: mean |Cb,Cr residual|.
 * Callers compare the two policies; chroma-cheap must not regress luma.
 */
export function chromaDownsample422(rgb: RgbImage): { w: number; h: number; cb: Float64Array; cr: Float64Array } {
  // Naïve YCbCr (JFIF-style, sRGB domain — probe only, not a colorimetry claim).
  const w = Math.floor(rgb.w / 2);
  const h = rgb.h;
  const cb = new Float64Array(w * h);
  const cr = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let cB = 0;
      let cR = 0;
      for (let dx = 0; dx < 2; dx++) {
        const i = y * rgb.w + Math.min(rgb.w - 1, x * 2 + dx);
        const r = rgb.r.data[i];
        const g = rgb.g.data[i];
        const b = rgb.b.data[i];
        cB += -0.168736 * r - 0.331264 * g + 0.5 * b;
        cR += 0.5 * r - 0.418688 * g - 0.081312 * b;
      }
      cb[y * w + x] = cB / 2 + 128;
      cr[y * w + x] = cR / 2 + 128;
    }
  return { w, h, cb, cr };
}

/** Alpha-exact path: bilinear up + Π so downsampled alpha == source exactly. */
export function reconstructAlpha(lr: GrayImage, scale: number): GrayImage {
  return projectBox(upsample(lr, scale, "bilinear"), lr, scale);
}

/** Linear-light box downsample of one channel given in 0..1 linear. */
export function linearBoxDown(lin: Float64Array, w: number, h: number, s: number): Float64Array {
  const img: GrayImage = { w, h, data: lin };
  return boxDownsample(img, s).data;
}
