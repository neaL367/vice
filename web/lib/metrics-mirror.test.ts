import { describe, expect, test } from "bun:test";
import { psnr, seamRatio, ssim } from "../../tools/eval/metrics";

// Mirror-property tests for the TS metrics (C++ twin: core/src/metrics.cpp).
describe("eval metrics", () => {
  const w = 16;
  const h = 16;
  const c = 3;
  const grad = new Float32Array(w * h * c);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < c; ch++) grad[(y * w + x) * c + ch] = (x + y) / (w + h);

  test("ssim identical is 1", () => {
    expect(ssim(grad, grad, w, h, c)).toBeCloseTo(1, 9);
  });

  test("ssim symmetric and bounded", () => {
    const other = Float32Array.from(grad, (v) => Math.min(1, v + 0.05));
    const ab = ssim(grad, other, w, h, c);
    const ba = ssim(other, grad, w, h, c);
    expect(ab).toBeCloseTo(ba, 12);
    expect(ab).toBeGreaterThan(0.9);
    expect(ab).toBeLessThanOrEqual(1);
  });

  test("ssim rejects bad shapes", () => {
    expect(ssim(grad, grad.slice(0, 10), w, h, c)).toBe(-1);
    expect(ssim(grad, grad, 4, 4, c)).toBe(-1);
  });

  test("seam ~1 on smooth, psnr finite", () => {
    const s = seamRatio(grad, w, h, 2, c);
    expect(s).toBeGreaterThan(0.8);
    expect(s).toBeLessThan(1.25);
    const a = Uint8ClampedArray.from(grad, (v) => Math.round(v * 255));
    const b = Uint8ClampedArray.from(grad, (v) => Math.round(Math.min(1, v + 0.01) * 255));
    const p = psnr(a, b);
    expect(p).toBeGreaterThan(20);
    expect(p).toBeLessThan(Infinity);
    expect(psnr(a, a)).toBe(Infinity);
  });
});
