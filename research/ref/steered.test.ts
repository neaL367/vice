// Iter-8 tests: steered upsampler contracts + diagonal targeted test.

import { describe, expect, test } from "bun:test";
import { fixtureDiagonal } from "./adversarial.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { constantImage, upsample, upsampleSteered } from "./kernels.ts";
import { gradientError, psnr } from "./metrics.ts";
import { computeDescriptors } from "./descriptors.ts";

function flatField(w: number, h: number): { w: number; h: number; dirX: Float64Array; dirY: Float64Array; coh: Float64Array } {
  const n = w * h;
  return { w, h, dirX: new Float64Array(n).fill(1), dirY: new Float64Array(n), coh: new Float64Array(n) };
}

describe("steered upsample", () => {
  test("preserves constants; coh=0 reproduces lanczos2", () => {
    const src = constantImage(8, 8, 77);
    const out = upsampleSteered(src, 2, flatField(8, 8), { strength: 0.75, sharp: 2 });
    for (const v of out.data) expect(Math.abs(v - 77)).toBeLessThan(1e-9);
    const lz = upsample(src, 2, "lanczos2");
    const st = upsampleSteered(src, 2, flatField(8, 8), { strength: 0.9, sharp: 3 });
    // Same math, different summation order (joint 2D vs separable passes):
    // equal within fp noise, not bit-identical.
    for (let i = 0; i < lz.data.length; i++) expect(Math.abs(st.data[i] - lz.data[i])).toBeLessThan(1e-9);
  });
  test("deterministic", () => {
    const f = fixtureDiagonal();
    const lr = boxDownsample(f.hr, 2);
    const d = computeDescriptors(lr);
    const a = upsampleSteered(lr, 2, d, { strength: 0.75, sharp: 2 });
    const b = upsampleSteered(lr, 2, d, { strength: 0.75, sharp: 2 });
    expect(a.data).toEqual(b.data);
  });
  test("diagonal 2x: steered correction ≤ isotropic gradErr (jaggy must not grow)", () => {
    const f = fixtureDiagonal();
    const lr = boxDownsample(f.hr, 2);
    const d = computeDescriptors(lr);
    const field = { w: lr.w, h: lr.h, dirX: d.dirX, dirY: d.dirY, coh: d.coh };
    const iso = reconstructIbp(lr, 2, { iters: 4, steerP: { field, strength: 0, sharp: 2 } });
    const dir = reconstructIbp(lr, 2, { iters: 4, steerP: { field, strength: 0.75, sharp: 2 } });
    expect(gradientError(f.hr, dir.x)).toBeLessThanOrEqual(gradientError(f.hr, iso.x));
    expect(forwardResidual(dir.x, lr, 2)).toBeLessThan(1e-5);
  });
});
