// Structured regularization for the reconstruction objective (iter-12).
//
// Objective:  x* = argmin_x ‖DHx − y‖² + R_freq(x) + R_edge(x)
//   R_freq(x) = Σ_i w_i · (Lx)_i²          (unsupported-HF energy)
//   R_edge(x) = Σ_i v_i · over_i(x)²       (edge overshoot / ringing)
//
// Solved by projected gradient inside the IBP loop (same solver family as the
// rest of the program — no new machinery):
//   x ← Π_clamp(x + P·r − η₁·∇R_freq − η₂·∇R_edge)
//
// Source analysis (all three measured in prior iterations, not assumed):
//   S1 nullspace injection — bilinear P spreads LR residual into HR frequencies
//      D cannot observe; data term never checks them. Signature: residual →
//      ~0 while HR error rises (gradient-ramp 49.2→44.9 dB, iter-1 report).
//      R_freq attenuates exactly this: w_i is high only where HF is
//      directionless (likely alias/noise), ~0 on coherent structure.
//   S2 truncation ringing — finite-support lanczos init overshoots steps
//      (Gibbs ~5–9%); clamp+Π redistribute rather than remove. R_edge
//      penalizes exceedance beyond the LOCAL LR range, so true steps
//      (interior never exceeds its neighborhood range) pass untouched.
//   S3 aliased/noise HF treated as signal — box-D folds above-Nyquist content;
//      unit-gain correction re-injects it. w_i gates on alias risk, so
//      legitimate HF (coherent edges/texture) keeps full correction.
//
// Legitimate-HF preservation is structural, not tuned:
//   flat/ramp → hf≈0 → w≈0, no overshoot → v-term idle;
//   clean step → coh≈1 → w≈0; interior in-range → v-term idle; only ringing
//      pixels (out-of-local-range) feel R_edge;
//   noise/checker → alias≈1 → R_freq damps; residual still exact via Π.
//
// Conventions: float64, replicate edges, 0..255 levels. L is the 5-point
// discrete Laplacian; Lᵀ≈L (exact except boundary rows — documented, and the
// bench scores interior). η₁, η₂ are fixed stability-bounded steps, not tuned:
// worst-case single-pass move η·2·1·|lap| stays to a few levels.

import { computeDescriptors, sampleField } from "./descriptors.ts";
import type { GrayImage } from "./kernels.ts";

export interface RegMaps {
  hw: number;
  hh: number;
  /** alias-risk weight per HR pixel (R_freq): directionless-HF likelihood */
  wFreq: Float64Array;
  /** edge-confidence weight per HR pixel (R_edge): overshoot penalty scale */
  vEdge: Float64Array;
  /** local LR range sampled to HR: overshoot reference bounds */
  loHR: Float64Array;
  hiHR: Float64Array;
}

/** 5-point discrete Laplacian, replicate edges. */
export function laplacian(img: GrayImage): Float64Array {
  const { w, h, data: d } = img;
  const out = new Float64Array(d.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x;
      const xp = x < w - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y;
      const yp = y < h - 1 ? y + 1 : y;
      out[y * w + x] = 4 * d[y * w + x] - d[y * w + xm] - d[y * w + xp] - d[ym * w + x] - d[yp * w + x];
    }
  return out;
}

/** Per-LR-pixel local range over 3×3 (overshoot reference). */
function localRange(lr: GrayImage): { lo: Float64Array; hi: Float64Array } {
  const { w, h, data: d } = lr;
  const lo = new Float64Array(d.length);
  const hi = new Float64Array(d.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const v = d[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      lo[y * w + x] = mn;
      hi[y * w + x] = mx;
    }
  return { lo, hi };
}

/**
 * Static penalty maps from the LR observation (geometry is fixed, like the
 * adaptive weights): wFreq = alias (directionless HF), vEdge = edge
 * confidence, [loHR, hiHR] = bilinear-sampled local LR range.
 */
export function regularizationMaps(lr: GrayImage, scale: number): RegMaps {
  const desc = computeDescriptors(lr);
  const { lo, hi } = localRange(lr);
  const hw = lr.w * scale;
  const hh = lr.h * scale;
  const wFreq = new Float64Array(hw * hh);
  const vEdge = new Float64Array(hw * hh);
  const loHR = new Float64Array(hw * hh);
  const hiHR = new Float64Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const i = y * hw + x;
      wFreq[i] = sampleField(desc.alias, desc.w, desc.h, x, y, scale);
      vEdge[i] = sampleField(desc.edge, desc.w, desc.h, x, y, scale);
      loHR[i] = sampleField(lo, desc.w, desc.h, x, y, scale);
      hiHR[i] = sampleField(hi, desc.w, desc.h, x, y, scale);
    }
  return { hw, hh, wFreq, vEdge, loHR, hiHR };
}

/**
 * Explicit gradient step on R_freq + R_edge, returned as a correction to
 * SUBTRACT: out = η₁·∇R_freq + η₂·∇R_edge with
 *   ∇R_freq ≈ 2·L(wFreq ⊙ Lx)   (Lᵀ≈L, boundary rows approximate)
 *   ∇R_edge = 2·vEdge ⊙ over(x) (over = exceedance beyond [loHR, hiHR])
 */
export function regularizationStep(x: GrayImage, maps: RegMaps, eta1: number, eta2: number): Float64Array {
  if (x.w !== maps.hw || x.h !== maps.hh) throw new Error("reg map size mismatch");
  const lap = laplacian(x);
  const weighted = new Float64Array(lap.length);
  for (let i = 0; i < weighted.length; i++) weighted[i] = maps.wFreq[i] * lap[i];
  const lap2 = laplacian({ w: x.w, h: x.h, data: weighted });
  const out = new Float64Array(x.data.length);
  for (let i = 0; i < out.length; i++) {
    const over = x.data[i] > maps.hiHR[i] ? x.data[i] - maps.hiHR[i] : x.data[i] < maps.loHR[i] ? x.data[i] - maps.loHR[i] : 0;
    out[i] = eta1 * 2 * lap2[i] + eta2 * 2 * maps.vEdge[i] * over;
  }
  return out;
}
