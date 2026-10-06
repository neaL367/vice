// Total-variation denoising, Chambolle dual projection (iter-9).
// Solves min_x ‖x−y‖²/2 + λ·TV(x) (isotropic TV, forward-difference gradient).
// p^{n+1} = (p^n + τ·∇(div p^n − y/λ)) / (1 + τ·|∇(div p^n − y/λ)|), τ ≤ 1/8.
// Deterministic: fixed τ, fixed iteration count, replicate edges.

import type { GrayImage } from "./kernels.ts";

/**
 * ROF denoise. λ in signal levels (0..255 domain): λ≈1 touches only
 * sub-level ripple; λ≈4–16 smooths texture progressively; λ≫16 staircases.
 * iters=50 converges the dual adequately on our fixtures (tested below).
 */
export function tvDenoise(src: GrayImage, lambda: number, iters = 50): GrayImage {
  const { w, h, data: y } = src;
  const n = w * h;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const v = new Float64Array(n);
  const tau = 0.125;
  for (let t = 0; t < iters; t++) {
    // v = div p − y/λ (backward-difference divergence, replicate edges).
    for (let yy = 0; yy < h; yy++)
      for (let x = 0; x < w; x++) {
        const i = yy * w + x;
        const dxm = x > 0 ? px[i] - px[i - 1] : px[i];
        const dym = yy > 0 ? py[i] - py[i - w] : py[i];
        v[i] = dxm + dym - y[i] / lambda;
      }
    // Dual ascent with projection: p += τ·∇v, normalized by (1+τ|∇v|).
    for (let yy = 0; yy < h; yy++)
      for (let x = 0; x < w; x++) {
        const i = yy * w + x;
        const xr = x < w - 1 ? v[i + 1] : v[i];
        const yd = yy < h - 1 ? v[i + w] : v[i];
        const dx = xr - v[i];
        const dy = yd - v[i];
        const ux = px[i] + tau * dx;
        const uy = py[i] + tau * dy;
        const s = 1 + tau * Math.hypot(ux, uy);
        px[i] = ux / s;
        py[i] = uy / s;
      }
  }
  // Primal recovery: x = y − λ·div p.
  const out = new Float64Array(n);
  for (let yy = 0; yy < h; yy++)
    for (let x = 0; x < w; x++) {
      const i = yy * w + x;
      const dxm = x > 0 ? px[i] - px[i - 1] : px[i];
      const dym = yy > 0 ? py[i] - py[i - w] : py[i];
      out[i] = y[i] - lambda * (dxm + dym);
    }
  return { w, h, data: out };
}

/**
 * Spatially-varying ROF: min_x ‖x−y‖²/2 + Σ_i λ_i·|∇x|_i.
 * Chambolle with per-pixel fidelity scale: v = div p − y/λ_i, x = y − λ_i·div p.
 * λ_i = 0 pixels are untouched (exact). Used for oscillation-gated TV:
 * texture zones denoised, isolated edges bypassed.
 */
export function tvDenoiseMap(src: GrayImage, lambda: Float64Array, iters = 50): GrayImage {
  const { w, h, data: y } = src;
  if (lambda.length !== w * h) throw new Error("lambda map size mismatch");
  const n = w * h;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const v = new Float64Array(n);
  const tau = 0.125;
  for (let t = 0; t < iters; t++) {
    for (let yy = 0; yy < h; yy++)
      for (let x = 0; x < w; x++) {
        const i = yy * w + x;
        const dxm = x > 0 ? px[i] - px[i - 1] : px[i];
        const dym = yy > 0 ? py[i] - py[i - w] : py[i];
        const li = lambda[i] > 1e-12 ? lambda[i] : 1e-12;
        v[i] = dxm + dym - y[i] / li;
      }
    for (let yy = 0; yy < h; yy++)
      for (let x = 0; x < w; x++) {
        const i = yy * w + x;
        const xr = x < w - 1 ? v[i + 1] : v[i];
        const yd = yy < h - 1 ? v[i + w] : v[i];
        const dx = xr - v[i];
        const dy = yd - v[i];
        const ux = px[i] + tau * dx;
        const uy = py[i] + tau * dy;
        const s = 1 + tau * Math.hypot(ux, uy);
        px[i] = ux / s;
        py[i] = uy / s;
      }
  }
  const out = new Float64Array(n);
  for (let yy = 0; yy < h; yy++)
    for (let x = 0; x < w; x++) {
      const i = yy * w + x;
      const dxm = x > 0 ? px[i] - px[i - 1] : px[i];
      const dym = yy > 0 ? py[i] - py[i - w] : py[i];
      out[i] = y[i] - lambda[i] * (dxm + dym);
    }
  return { w, h, data: out };
}
