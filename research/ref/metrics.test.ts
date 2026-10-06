// Ticket 01 tests: metrics sanity.

import { describe, expect, test } from "bun:test";
import { constantImage } from "./kernels.ts";
import { gradientError, mse, psnr, ringing, ssimLite } from "./metrics.ts";

describe("metrics", () => {
  test("identity: mse 0, psnr ∞, ssim 1, gradErr 0, no ringing", () => {
    const a = constantImage(8, 8, 128);
    const b = constantImage(8, 8, 128);
    expect(mse(a, b)).toBe(0);
    expect(psnr(a, b)).toBe(Infinity);
    expect(ssimLite(a, b)).toBeCloseTo(1, 12);
    expect(gradientError(a, b)).toBe(0);
    expect(ringing(a).range).toBe(0);
  });
  test("ordering: flat-vs-step worse than flat-vs-nearflat", () => {
    const flat = constantImage(8, 8, 128);
    const near = constantImage(8, 8, 130);
    const step = constantImage(8, 8, 128);
    for (let i = 32; i < 64; i++) step.data[i] = 255;
    expect(psnr(flat, near)).toBeGreaterThan(psnr(flat, step));
    expect(ssimLite(flat, near)).toBeGreaterThan(ssimLite(flat, step));
  });
});
