// Guarded IBP reference (ticket 04): simplest testable hypothesis.
// x₀ = fixed-kernel upscale; iterate x ← Π_clamp(x + W·Up_bilinear(y − DHx)).
// Flags isolate every guard for ablation: project, clamp, weights.
// Π = exact box projection (range-space guarantee); clamp bounds overshoot;
// W = per-HR-pixel weight map (null in unweighted mode; ticket 05 supplies it).

import { forwardResidual, projectBox, simulateForward } from "./forward.ts";
import { upsample, upsampleSteered, type GrayImage, type KernelName, type SteerField } from "./kernels.ts";

export interface IbpOptions {
  iters?: number; // T ≤ 5 default 4 (matches VICE_SMOOTH_ITERS spirit)
  init?: KernelName; // x₀ kernel
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
  const { iters = 4, init = "lanczos3", project = true, clamp = true, gain = 1, blurSigma = 0, steerP = null } = opts;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of lr.data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  let x = upsample(lr, scale, init);
  const residuals: number[] = [forwardResidual(x, lr, scale, blurSigma)];
  for (let t = 0; t < iters; t++) {
    const pred = simulateForward(x, scale, { blurSigma });
    const rdata = new Float64Array(pred.data.length);
    for (let i = 0; i < rdata.length; i++) rdata[i] = lr.data[i] - pred.data[i];
    const correction = upsampleResidual({ w: lr.w, h: lr.h, data: rdata }, scale, weights, gain, steerP);
    const nd = new Float64Array(x.data.length);
    for (let i = 0; i < nd.length; i++) {
      let v = x.data[i] + correction.data[i];
      if (clamp) v = v < lo ? lo : v > hi ? hi : v;
      nd[i] = v;
    }
    x = { w: x.w, h: x.h, data: nd };
    // Π after clamp: clamp can break block sums, projection restores them.
    // Order is clamp-then-project so the range guarantee always holds at pass end.
    if (project) x = projectBox(x, lr, scale);
    residuals.push(forwardResidual(x, lr, scale, blurSigma));
  }
  return { x, residuals };
}
