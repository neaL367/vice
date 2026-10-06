// Reference metrics (float64, grayscale).
// PSNR + single-window SSIM-lite + gradient-magnitude RMS error +
// range overshoot (ringing proxy) + forward residual re-export.

import type { GrayImage } from "./kernels.ts";

function requireSameSize(a: GrayImage, b: GrayImage): void {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
}

export function mse(a: GrayImage, b: GrayImage): number {
  requireSameSize(a, b);
  let se = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = a.data[i] - b.data[i];
    se += d * d;
  }
  return se / a.data.length;
}

export function psnr(a: GrayImage, b: GrayImage, peak = 255): number {
  const m = mse(a, b);
  if (m === 0) return Infinity;
  return 10 * Math.log10((peak * peak) / m);
}

/** Single-window SSIM over whole image (reference-lite; not a sliding map). */
export function ssimLite(a: GrayImage, b: GrayImage, peak = 255): number {
  requireSameSize(a, b);
  const n = a.data.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a.data[i];
    mb += b.data[i];
  }
  ma /= n;
  mb /= n;
  let va = 0;
  let vb = 0;
  let cab = 0;
  for (let i = 0; i < n; i++) {
    const da = a.data[i] - ma;
    const db = b.data[i] - mb;
    va += da * da;
    vb += db * db;
    cab += da * db;
  }
  va /= n;
  vb /= n;
  cab /= n;
  const L = peak;
  const c1 = (0.01 * L) ** 2;
  const c2 = (0.03 * L) ** 2;
  return ((2 * ma * mb + c1) * (2 * cab + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
}

function gradientMag(img: GrayImage, x: number, y: number): number {
  const { w, h, data } = img;
  const xm = x > 0 ? x - 1 : x;
  const xp = x < w - 1 ? x + 1 : x;
  const ym = y > 0 ? y - 1 : y;
  const yp = y < h - 1 ? y + 1 : y;
  const gx = (data[y * w + xp] - data[y * w + xm]) / (xp - xm);
  const gy = (data[yp * w + x] - data[ym * w + x]) / (yp - ym);
  return Math.hypot(gx, gy);
}

/** RMS error of gradient magnitude fields — edge-geometry fidelity. */
export function gradientError(a: GrayImage, b: GrayImage): number {
  requireSameSize(a, b);
  let se = 0;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const d = gradientMag(a, x, y) - gradientMag(b, x, y);
      se += d * d;
    }
  return Math.sqrt(se / (a.w * a.h));
}

/**
 * Range overshoot: energy outside [0,255] plus halo beyond a step's levels.
 * Ringing proxy for open-loop kernels. Returns {range, maxPos, maxNeg}.
 */
export function ringing(img: GrayImage): { range: number; maxPos: number; maxNeg: number } {
  let se = 0;
  let maxPos = 0;
  let maxNeg = 0;
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i];
    if (v > 255) {
      const d = v - 255;
      se += d * d;
      if (d > maxPos) maxPos = d;
    } else if (v < 0) {
      const d = -v;
      se += d * d;
      if (d > maxNeg) maxNeg = d;
    }
  }
  return { range: Math.sqrt(se / img.data.length), maxPos, maxNeg };
}

/** Step-edge overshoot: max exceedance beyond [lo,hi] within `halo` px of edge column. */
export function stepOvershoot(img: GrayImage, edgeX: number, lo: number, hi: number, halo = 3): number {
  let worst = 0;
  for (let y = 0; y < img.h; y++)
    for (let x = Math.max(0, edgeX - halo); x < Math.min(img.w, edgeX + halo); x++) {
      const v = img.data[y * img.w + x];
      // Left side must stay near lo, right side near hi:
      const dev = x < edgeX ? Math.abs(v - lo) : Math.abs(v - hi);
      if (dev > worst) worst = dev;
    }
  return worst;
}
