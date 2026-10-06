// Iter-10 tests: anisotropic x0 contracts + bounded win/loss locks.

import { describe, expect, test } from "bun:test";
import { fixtureGradient, fixturePhotoSurrogate, fixtureRepeated, fixtureStep } from "./adversarial.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { constantImage, upsample, upsampleAniso } from "./kernels.ts";
import { psnr } from "./metrics.ts";
import { computeDescriptors } from "./descriptors.ts";

function edgeField(lr: { w: number; h: number; data: Float64Array }) {
  const d = computeDescriptors(lr);
  const e = new Float64Array(d.coh.length);
  for (let i = 0; i < e.length; i++) e[i] = d.coh[i] * Math.min(1, d.gnorm[i] * 2) * Math.min(1, d.curv[i] / 0.1);
  return { w: lr.w, h: lr.h, dirX: d.dirX, dirY: d.dirY, coh: e };
}

describe("aniso x0", () => {
  test("preserves constants; coh=0 reproduces isotropic lanczos3", () => {
    const src = constantImage(8, 8, 60);
    const n = 64;
    const flat = { w: 8, h: 8, dirX: new Float64Array(n).fill(1), dirY: new Float64Array(n), coh: new Float64Array(n) };
    const out = upsampleAniso(src, 2, flat, { rAlong: 3, rAcross: 2.25 });
    for (const v of out.data) expect(Math.abs(v - 60)).toBeLessThan(1e-9);
    const lz = upsample(src, 2, "lanczos3");
    for (let i = 0; i < lz.data.length; i++) expect(Math.abs(out.data[i] - lz.data[i])).toBeLessThan(1e-9);
  });
  test("gradient-4x wins (smooth zones like mild anisotropy)", () => {
    const f = fixtureGradient();
    const lr = boxDownsample(f.hr, 4);
    const iso = reconstructIbp(lr, 4, { iters: 4 });
    const ax0 = upsampleAniso(lr, 4, edgeField(lr), { rAlong: 3, rAcross: 2.25 });
    const an = reconstructIbp(lr, 4, { iters: 4, x0: ax0 });
    expect(psnr(f.hr, an.x) - psnr(f.hr, iso.x)).toBeGreaterThan(0.5);
  });
  test("bounded loss: step-2x and repeated-4x stay within 1.2 dB (kill if worse)", () => {
    // Aniso is bidirectional; this test caps the known loss zones. If a future
    // change widens them, the idea dies here instead of silently regressing.
    for (const [f, s] of [[fixtureStep(), 2], [fixtureRepeated(), 4]] as const) {
      const lr = boxDownsample(f.hr, s);
      const iso = reconstructIbp(lr, s, { iters: 4 });
      const ax0 = upsampleAniso(lr, s, edgeField(lr), { rAlong: 3, rAcross: 2.25 });
      const an = reconstructIbp(lr, s, { iters: 4, x0: ax0 });
      expect(psnr(f.hr, an.x) - psnr(f.hr, iso.x)).toBeGreaterThan(-1.2);
    }
  });
  test("photo-surrogate-2x wins (all zones positive at rAcross=2.25)", () => {
    const f = fixturePhotoSurrogate();
    const lr = boxDownsample(f.hr, 2);
    const iso = reconstructIbp(lr, 2, { iters: 4 });
    const ax0 = upsampleAniso(lr, 2, edgeField(lr), { rAlong: 3, rAcross: 2.25 });
    const an = reconstructIbp(lr, 2, { iters: 4, x0: ax0 });
    expect(psnr(f.hr, an.x) - psnr(f.hr, iso.x)).toBeGreaterThan(0.3);
  });
  test("x0 passthrough respected (residuals[0] matches explicit x0)", () => {
    const f = fixtureStep();
    const lr = boxDownsample(f.hr, 2);
    const ax0 = upsampleAniso(lr, 2, edgeField(lr), { rAlong: 3, rAcross: 2.25 });
    const r = reconstructIbp(lr, 2, { iters: 1, x0: ax0 });
    expect(r.residuals[0]).toBe(forwardResidual(ax0, lr, 2));
  });
});
