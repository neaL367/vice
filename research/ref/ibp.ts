// Guarded IBP reference (ticket 04): simplest testable hypothesis.
// x₀ = fixed-kernel upscale; iterate x ← Π_clamp(x + W·Up_bilinear(y − DHx)).
// Flags isolate every guard for ablation: project, clamp, weights.
// Π = exact box projection (range-space guarantee); clamp bounds overshoot;
// W = per-HR-pixel weight map (null in unweighted mode; ticket 05 supplies it).

import { forwardResidual, projectBox, projectBoxTapered, simulateForward } from "./forward.ts";
import { upsample, upsampleSteered, type GrayImage, type KernelName, type SteerField } from "./kernels.ts";
import { regularizationMaps, regularizationStep, type RegMaps } from "./regularization.ts";
import { tvDenoiseMap } from "./tv.ts";

export interface IbpOptions {
  iters?: number; // T ≤ 5 default 4 (matches VICE_SMOOTH_ITERS spirit)
  init?: KernelName; // x₀ kernel (ignored when x0 given)
  x0?: GrayImage | null; // explicit initial estimate (e.g. anisotropic); default null
  project?: boolean; // exact box Π each pass (range guarantee)
  clamp?: boolean; // overshoot clamp to global [minLR,maxLR] each pass
  gain?: number; // back-projection step (1.0 default; convergence needs ≤ ~1)
  blurSigma?: number; // H model inside DH (0 = box only)
  /**
   * Directional P (iter-8): steer residual upsampling by observation geometry.
   * strength=0 reproduces isotropic lanczos2 P (ablation control). Field is
   * built from LR descriptors once (not per iteration: geometry is static).
   */
  steerP?: { field: SteerField; strength: number; sharp: number } | null;
  /**
   * Oscillation-gated TV (iter-9): per-HR-pixel λ map applied to (x + corr)
   * BEFORE clamp+Π each pass (TV-before-Π order). λ=0 pixels bypass exactly.
   * Lets texture zones take TV while isolated edges keep the pure loop.
   */
  tvMap?: { lambda: Float64Array; tvIters?: number } | null;
  /**
   * Tapered projection (zoom-pixelation fix): tent-weighted Π distributes
   * block-mean correction toward block centers, shrinking boundary steps.
   * Same exactness. No-op at s=2 (tent is uniform). Default off.
   */
  tapered?: boolean;
  /**
   * Structured regularization (iter-12): explicit gradient step on
   * R_freq + R_edge BEFORE clamp+Π each pass. Penalizes unsupported HF
   * (alias-risk-weighted) and edge overshoot (beyond local LR range) while
   * coherent structure passes untouched. Π still guarantees the range.
   * DEFAULT (reg undefined): R_edge-only (eta1=0, eta2=0.05) with maps from
   * the observation — measured safe everywhere (never harmful on 16-family
   * battery + photos), residual guarantee intact. Pass reg:null for the bare
   * loop, or custom maps/etas (R_freq is content-dependent: helps periodic
   * texture, destroys blocks — manual use only).
   */
  reg?: { maps: RegMaps; eta1: number; eta2: number } | null;
}

export interface IbpResult {
  x: GrayImage;
  residuals: number[]; // residual after x₀ then after each pass
}

function upsampleResidual(
  lr: GrayImage,
  scale: number,
  weights: Float64Array | null,
  gain: number,
  steerP: { field: SteerField; strength: number; sharp: number } | null,
): GrayImage {
  const up = steerP
    ? upsampleSteered(lr, scale, steerP.field, { strength: steerP.strength, sharp: steerP.sharp })
    : upsample(lr, scale, "bilinear");
  if (weights) {
    if (weights.length !== up.data.length) throw new Error("weight map size mismatch");
    const out = new Float64Array(up.data.length);
    for (let i = 0; i < out.length; i++) out[i] = up.data[i] * weights[i] * gain;
    return { w: up.w, h: up.h, data: out };
  }
  if (gain !== 1) {
    const out = new Float64Array(up.data.length);
    for (let i = 0; i < out.length; i++) out[i] = up.data[i] * gain;
    return { w: up.w, h: up.h, data: out };
  }
  return up;
}

export function reconstructIbp(
  lr: GrayImage,
  scale: number,
  opts: IbpOptions = {},
  weights: Float64Array | null = null,
): IbpResult {
  const { iters = 4, init = "lanczos3", x0 = null, project = true, clamp = true, gain = 1, blurSigma = 0, steerP = null, tvMap = null, tapered = false } = opts;
  // Default objective includes R_edge-only regularization (eta1=0, eta2=0.05).
  const reg = opts.reg === undefined ? { maps: regularizationMaps(lr, scale), eta1: 0, eta2: 0.05 } : opts.reg;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of lr.data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  let x = x0 ?? upsample(lr, scale, init);
  const residuals: number[] = [forwardResidual(x, lr, scale, blurSigma)];
  for (let t = 0; t < iters; t++) {
    const pred = simulateForward(x, scale, { blurSigma });
    const rdata = new Float64Array(pred.data.length);
    for (let i = 0; i < rdata.length; i++) rdata[i] = lr.data[i] - pred.data[i];
    const correction = upsampleResidual({ w: lr.w, h: lr.h, data: rdata }, scale, weights, gain, steerP);
    let corrected: GrayImage = { w: x.w, h: x.h, data: (() => {
      const nd = new Float64Array(x.data.length);
      for (let i = 0; i < nd.length; i++) nd[i] = x.data[i] + correction.data[i];
      return nd;
    })() };
    if (tvMap) corrected = tvDenoiseMap(corrected, tvMap.lambda, tvMap.tvIters ?? 30);
    if (reg) {
      // Projected-gradient step on R_freq + R_edge (objective modification,
      // not a post-filter): subtract the explicit penalty gradient, then let
      // clamp+Π restore feasibility. Range guarantee unaffected.
      const step = regularizationStep(corrected, reg.maps, reg.eta1, reg.eta2);
      const rd = new Float64Array(corrected.data.length);
      for (let i = 0; i < rd.length; i++) rd[i] = corrected.data[i] - step[i];
      corrected = { w: corrected.w, h: corrected.h, data: rd };
    }
    const nd = new Float64Array(x.data.length);
    for (let i = 0; i < nd.length; i++) {
      let v = corrected.data[i];
      if (clamp) v = v < lo ? lo : v > hi ? hi : v;
      nd[i] = v;
    }
    x = { w: x.w, h: x.h, data: nd };
    // Π after clamp: clamp can break block sums, projection restores them.
    // Order is clamp-then-project so the range guarantee always holds at pass end.
    if (project) x = tapered ? projectBoxTapered(x, lr, scale) : projectBox(x, lr, scale);
    residuals.push(forwardResidual(x, lr, scale, blurSigma));
  }
  return { x, residuals };
}
