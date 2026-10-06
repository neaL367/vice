// Deterministic local descriptors on the LR observation grid (ticket 05).
// All floats, all closed-form, no learning. Conventions:
// - gradients in levels/px (signal 0..255); normalized fields in [0,1].
// - windows are 3x3, clamped edges (same convention as kernels.ts).

import type { GrayImage } from "./kernels.ts";

export interface DescMap {
  w: number;
  h: number;
  /** normalized gradient magnitude min(1,|g|/32) */
  gnorm: Float64Array;
  /** unit gradient direction (valid where gnorm>0) */
  dirX: Float64Array;
  dirY: Float64Array;
  /** structure-tensor coherence (λ1−λ2)/(λ1+λ2): 1=oriented, 0=isotropic */
  coh: Float64Array;
  /** edge confidence = coh·gnorm */
  edge: Float64Array;
  /** normalized local variance min(1,var/1600) */
  vnorm: Float64Array;
  /** normalized |high-pass| min(1,|hp|/24) */
  hf: Float64Array;
  /** alias risk = hf·(1−coh)·vnorm (texture-like, directionless HF) */
  alias: Float64Array;
  /** normalized |Laplacian| min(1,|lap|/64): step/block edges ≈1, ramps ≈0 */
  curv: Float64Array;
  /**
   * Contour support: 3x3 mean of edge confidence. Step/block edges form
   * contiguous contours (support ≈ edge); noise speckles are isolated
   * (support ≪ edge). Second-order discriminator where amplitude fails.
   */
  edgeSup: Float64Array;
}

function gradAt(d: Float64Array, w: number, h: number, x: number, y: number): [number, number] {
  const xm = x > 0 ? x - 1 : x;
  const xp = x < w - 1 ? x + 1 : x;
  const ym = y > 0 ? y - 1 : y;
  const yp = y < h - 1 ? y + 1 : y;
  return [(d[y * w + xp] - d[y * w + xm]) / (xp - xm), (d[yp * w + x] - d[ym * w + x]) / (yp - ym)];
}

export function computeDescriptors(lr: GrayImage): DescMap {
  const { w, h, data: d } = lr;
  const n = w * h;
  const gnorm = new Float64Array(n);
  const dirX = new Float64Array(n);
  const dirY = new Float64Array(n);
  const coh = new Float64Array(n);
  const edge = new Float64Array(n);
  const vnorm = new Float64Array(n);
  const hf = new Float64Array(n);
  const alias = new Float64Array(n);
  const curv = new Float64Array(n);
  const edgeSup = new Float64Array(n);
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [a, b] = gradAt(d, w, h, x, y);
      gx[y * w + x] = a;
      gy[y * w + x] = b;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sxx = 0;
      let sxy = 0;
      let syy = 0;
      let mean = 0;
      let m2 = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ix = Math.min(w - 1, Math.max(0, x + dx));
          const iy = Math.min(h - 1, Math.max(0, y + dy));
          const i = iy * w + ix;
          sxx += gx[i] * gx[i];
          sxy += gx[i] * gy[i];
          syy += gy[i] * gy[i];
          mean += d[i];
          m2 += d[i] * d[i];
          cnt++;
        }
      const i = y * w + x;
      mean /= cnt;
      const variance = Math.max(0, m2 / cnt - mean * mean);
      // Closed-form eigen-decomposition of 2x2 symmetric [[sxx,sxy],[sxy,syy]].
      const tr = sxx + syy;
      const det = sxx * syy - sxy * sxy;
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det));
      const l1 = (tr + disc) / 2;
      const l2 = (tr - disc) / 2;
      const c = l1 + l2 > 1e-12 ? (l1 - l2) / (l1 + l2) : 0;
      const gm = Math.hypot(gx[i], gy[i]);
      const gn = Math.min(1, gm / 32);
      gnorm[i] = gn;
      dirX[i] = gm > 1e-12 ? gx[i] / gm : 1;
      dirY[i] = gm > 1e-12 ? gy[i] / gm : 0;
      coh[i] = c;
      edge[i] = c * gn;
      vnorm[i] = Math.min(1, variance / 1600);
      const hpv = Math.min(1, Math.abs(d[i] - mean) / 24);
      hf[i] = hpv;
      alias[i] = hpv * (1 - c) * Math.min(1, variance / 1600);
      // Discrete Laplacian (interior; replicate edges) — curvature probe.
      const xm = x > 0 ? x - 1 : x;
      const xp = x < w - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y;
      const yp = y < h - 1 ? y + 1 : y;
      const lap = 4 * d[i] - d[y * w + xm] - d[y * w + xp] - d[ym * w + x] - d[yp * w + x];
      curv[i] = Math.min(1, Math.abs(lap) / 64);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ix = Math.min(w - 1, Math.max(0, x + dx));
          const iy = Math.min(h - 1, Math.max(0, y + dy));
          s += edge[iy * w + ix];
        }
      edgeSup[y * w + x] = s / 9;
    }
  return { w, h, gnorm, dirX, dirY, coh, edge, vnorm, hf, alias, curv, edgeSup };
}

/** Bilinear sample of a scalar LR field at HR pixel (hx,hy), scale s. */
export function sampleField(f: Float64Array, lw: number, lh: number, hx: number, hy: number, s: number): number {
  const cx = (hx + 0.5) / s - 0.5;
  const cy = (hy + 0.5) / s - 0.5;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (x: number, y: number) => f[Math.min(lh - 1, Math.max(0, y)) * lw + Math.min(lw - 1, Math.max(0, x))];
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
}
