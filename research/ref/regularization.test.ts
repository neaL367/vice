// Iter-12 tests: penalty fields behave as the source analysis claims.

import { describe, expect, test } from "bun:test";
import { fixtureGradient, fixtureNoise, fixtureStep } from "./adversarial.ts";
import { boxDownsample } from "./forward.ts";
import { constantImage, upsample } from "./kernels.ts";
import { laplacian, regularizationMaps, regularizationStep } from "./regularization.ts";

describe("regularization", () => {
  test("flat field: zero Laplacian, zero penalty step", () => {
    const flat = constantImage(8, 8, 128);
    for (const v of laplacian(flat)) expect(v).toBe(0);
    const lr = boxDownsample(constantImage(8, 8, 128), 2);
    const maps = regularizationMaps(lr, 2);
    const step = regularizationStep(upsample(lr, 2, "bilinear"), maps, 0.05, 0.1);
    for (const v of step) expect(Math.abs(v)).toBeLessThan(1e-9);
  });
  test("weights discriminate: step edge confident, noise alias-like", () => {
    // Geometry measured on the LR grid (nullspace content like a perfect
    // checkerboard vanishes under box-D, so LR maps are the honest domain).
    const mean = (a: Float64Array) => a.reduce((s, v) => s + v, 0) / a.length;
    const mst = regularizationMaps(boxDownsample(fixtureStep().hr, 2), 2);
    const mno = regularizationMaps(boxDownsample(fixtureNoise().hr, 2), 2);
    expect(mean(mst.vEdge)).toBeGreaterThan(0.01); // edge present
    expect(mean(mst.wFreq)).toBeLessThan(0.1); // coherent: not alias-like
    expect(mean(mno.wFreq)).toBeGreaterThan(mean(mst.wFreq)); // noise is alias-like
  });
  test("edge overshoot localized: step ringing pixels penalized, interior not", () => {
    const f = fixtureStep();
    const lr = boxDownsample(f.hr, 2);
    const maps = regularizationMaps(lr, 2);
    const x = upsample(lr, 2, "lanczos3"); // rings at the transition
    const step = regularizationStep(x, maps, 0, 1); // edge term only, eta2=1
    // Penalty concentrated near the edge column (x=16 in 32-wide HR).
    let near = 0;
    let far = 0;
    let nn = 0;
    let nf = 0;
    for (let y = 0; y < 32; y++)
      for (let xx = 0; xx < 32; xx++) {
        const v = Math.abs(step[y * 32 + xx]);
        if (Math.abs(xx - 16) <= 2) {
          near += v;
          nn++;
        } else {
          far += v;
          nf++;
        }
      }
    expect(near / nn).toBeGreaterThan((far / nf) * 5);
  });
  test("stability: one reg step moves smooth content <0.5 levels", () => {
    const f = fixtureGradient();
    const lr = boxDownsample(f.hr, 2);
    const maps = regularizationMaps(lr, 2);
    const x = upsample(lr, 2, "lanczos3");
    const step = regularizationStep(x, maps, 0.05, 0.1);
    let worst = 0;
    for (const v of step) worst = Math.max(worst, Math.abs(v));
    expect(worst).toBeLessThan(0.5);
  });
});
