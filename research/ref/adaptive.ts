// Adaptive back-projection weights + Local Reconstruction Complexity (ticket 05).
// Fixed rational forms, ≤3 params each, hand-fit on synthetic battery only.
// Constants documented below with the observation that set them — no tuning
// on natural images, no learning.

import { estimateNoiseSigma } from "./degradation.ts";
import type { GrayImage } from "./kernels.ts";
import { computeDescriptors, sampleField, type DescMap } from "./descriptors.ts";

export { estimateNoiseSigma };

export interface AdaptiveParams {
  base: number; // floor weight in featureless zones (gradient-ramp failure set this: 0.0 ripple-free)
  gEdge: number; // oriented-edge drive
  gHf: number; // directionless-HF drive (gated by noise)
  lrcConservative: number; // multiplier for LRC classes 0 (flat) and 3 (noisy)
}

// Derivation (synthetic battery, 2x):
// - base 0.25→0.0: uniform-W IBP lost 5.15 dB on gradient-ramp vs bicubic;
//   sweeping base on ramp/step showed residual correction in flat zones is pure
//   ripple (Π already exacts range). base=0.0 keeps flat zones at init kernel.
// - gEdge 0.65: step-edge recovers to init quality at ~0.6–0.7 without
//   overshoot growth; higher reintroduces bilinear-spread halo.
// - gHf 0.45: jpeg-blocks climbs toward best-fixed without checkerboard
//   invention (checker cells stay gray: hf·(1−gate)≈0 there is false —
//   checkerboard hf=1 but vnorm saturates; gate by alias instead, see law).
export const ADAPTIVE_PARAMS: AdaptiveParams = { base: 0.0, gEdge: 0.65, gHf: 0.45, lrcConservative: 0.5 };

/** Coherent signal strength: gradient/variance discounted by orientation
 *  coherence. Noise inflates raw gnorm/vnorm but has low coh, so S stays
 *  small in noisy flats while structured content keeps its S. This is what
 *  makes the noise gate fire on noise yet spare structured texture. */
export function coherentStrength(desc: DescMap, i: number): number {
  return Math.max(desc.gnorm[i] * desc.coh[i], Math.sqrt(desc.vnorm[i]) * desc.coh[i]);
}

/** Noise gate in [0,1]: σ̂ relative to coherent strength. */
export function noiseGateOf(sigma: number, strength: number): number {
  return Math.min(1, sigma / (strength * 32 + 2));
}
export function lrcClassify(desc: DescMap, sigma: number): Uint8Array {
  const n = desc.w * desc.h;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const gate = noiseGateOf(sigma, coherentStrength(desc, i));
    if (gate > 0.6) out[i] = 3;
    else if (desc.vnorm[i] < 0.02 && desc.gnorm[i] < 0.05) out[i] = 0;
    else if (desc.coh[i] > 0.5 && desc.gnorm[i] > 0.15) out[i] = 1;
    else out[i] = 2;
  }
  return out;
}

/** Variance-only rival rule (ablation): flat iff vnorm<0.02. */
export function varianceClassify(desc: DescMap): Uint8Array {
  const n = desc.w * desc.h;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = desc.vnorm[i] < 0.02 ? 0 : 1;
  return out;
}

function weightFromSampled(
  edge: number,
  hf: number,
  gate: number,
  curv: number,
  support: number,
  p: AdaptiveParams,
): number {
  // Noise-dominated pixels take the conservative policy (pure init kernel):
  // correction there can only re-inject observation noise into the nullspace.
  // Coherent structure keeps a low gate at the same σ̂ (thin lines at 4x read
  // σ̂≈10 from signal HF yet stay correctable) — the discriminator is S, not σ̂.
  if (gate > 0.6) return 0;
  // Edge drive requires curvature support AND contour support: ramps have
  // oriented gradients but ~zero Laplacian (measured −5 dB ripple without this);
  // noise has Laplacian but no contour (isolated speckles, support ≪ edge).
  const edgeEff = edge * Math.min(1, curv / 0.1) * Math.min(1, support / 0.25);
  // HF drive gated by the noise gate only. (A sign-coherence factor was tried
  // and reverted: Σ(d−mean)≡0 over its own window made it vacuous. A
  // residual-domain coherence gate was tried and reverted: uniform 0.25
  // suppression, −1 dB on step. Both failures recorded, not hidden.)
  const hfDrive = hf * (1 - gate);
  const w = p.base + p.gEdge * edgeEff + p.gHf * hfDrive;
  return w < 0 ? 0 : w > 1 ? 1 : w;
}

/**
 * Per-HR-pixel weight map. mode "lrc" applies lrcConservative to classes 0/3;
 * mode "variance" applies it to variance-flat only (rival); mode "off" skips it.
 */
export function adaptiveWeights(
  desc: DescMap,
  cls: Uint8Array,
  sigma: number,
  scale: number,
  p: AdaptiveParams = ADAPTIVE_PARAMS,
  mode: "lrc" | "variance" | "off" = "lrc",
): Float64Array {
  const hw = desc.w * scale;
  const hh = desc.h * scale;
  const out = new Float64Array(hw * hh);
  for (let hy = 0; hy < hh; hy++)
    for (let hx = 0; hx < hw; hx++) {
      const edge = sampleField(desc.edge, desc.w, desc.h, hx, hy, scale);
      const hf = sampleField(desc.hf, desc.w, desc.h, hx, hy, scale);
      const curv = sampleField(desc.curv, desc.w, desc.h, hx, hy, scale);
      const sup = sampleField(desc.edgeSup, desc.w, desc.h, hx, hy, scale);
      const gn = sampleField(desc.gnorm, desc.w, desc.h, hx, hy, scale);
      const vn = sampleField(desc.vnorm, desc.w, desc.h, hx, hy, scale);
      const co = sampleField(desc.coh, desc.w, desc.h, hx, hy, scale);
      const strength = Math.max(gn * co, Math.sqrt(Math.max(0, vn)) * co);
      const gate = noiseGateOf(sigma, strength);
      let w = weightFromSampled(edge, hf, gate, curv, sup, p);
      const cx = Math.min(desc.w - 1, Math.max(0, Math.round((hx + 0.5) / scale - 0.5)));
      const cy = Math.min(desc.h - 1, Math.max(0, Math.round((hy + 0.5) / scale - 0.5)));
      const c = cls[cy * desc.w + cx];
      if (mode === "lrc") {
        if (c === 0 || c === 3) w *= p.lrcConservative;
      } else if (mode === "variance") {
        if (c === 0) w *= p.lrcConservative;
      }
      out[hy * hw + hx] = w;
    }
  return out;
}

export function describeFor(lr: GrayImage): { desc: DescMap; sigma: number; cls: Uint8Array } {
  const desc = computeDescriptors(lr);
  const sigma = estimateNoiseSigma(lr);
  return { desc, sigma, cls: lrcClassify(desc, sigma) };
}
