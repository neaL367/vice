// Ticket 01 tests: forward model exactness + projection guarantee.

import { describe, expect, test } from "bun:test";
import { boxDownsample, forwardResidual, projectBox, simulateForward } from "./forward.ts";
import { constantImage, upsample } from "./kernels.ts";

describe("boxDownsample", () => {
  test("constant preserved; checker 2x2 averages to mid", () => {
    const c = boxDownsample(constantImage(8, 8, 200), 2);
    expect(c.w).toBe(4);
    for (const v of c.data) expect(v).toBe(200);
  });
  test("throws on indivisible geometry", () => {
    expect(() => boxDownsample(constantImage(7, 8, 0), 2)).toThrow();
  });
});

describe("projectBox", () => {
  test("block means equal LR exactly; residual ~0 after projection", () => {
    const lr = constantImage(4, 4, 100);
    // Perturbed HR: lanczos of wrong-ish input won't match lr.
    const raw = upsample(constantImage(4, 4, 90), 2, "lanczos3");
    const proj = projectBox(raw, lr, 2);
    const r = forwardResidual(proj, lr, 2);
    expect(r).toBeLessThan(1e-9);
    // Every 2x2 block mean == 100
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        let acc = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) acc += proj.data[(y * 2 + dy) * 8 + x * 2 + dx];
        expect(Math.abs(acc / 4 - 100)).toBeLessThan(1e-9);
      }
  });
  test("unprojected lanczos has nonzero residual (documents why Π matters)", () => {
    const lr = constantImage(4, 4, 100);
    const raw = upsample(constantImage(4, 4, 90), 2, "lanczos3");
    expect(forwardResidual(raw, lr, 2)).toBeGreaterThan(1);
  });
  test("simulateForward with blur still consistent with itself", () => {
    const hr = constantImage(8, 8, 50);
    const lr = simulateForward(hr, 2, { blurSigma: 0.8 });
    for (const v of lr.data) expect(Math.abs(v - 50)).toBeLessThan(1e-9);
  });
});
