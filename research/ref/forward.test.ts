// Ticket 01 tests: forward model exactness + projection guarantee.

import { describe, expect, test } from "bun:test";
import { boxDownsample, forwardResidual, projectBox, projectBoxTapered, simulateForward } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { constantImage, downsampleKernel, upsample } from "./kernels.ts";
import { psnr } from "./metrics.ts";

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

describe("downsampleKernel (mismatch probe)", () => {
  test("constant preserved; differs from box on steps (model mismatch is real)", () => {
    const c = downsampleKernel(constantImage(8, 8, 200), 2, "bicubic");
    expect(c.w).toBe(4);
    for (const v of c.data) expect(Math.abs(v - 200)).toBeLessThan(1e-9);
    // step edge fixture would differ; direct check on a step:
    const data = new Float64Array(8 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) data[y * 8 + x] = x < 4 ? 0 : 255;
    const step = { w: 8, h: 4, data };
    const box = boxDownsample(step, 2);
    const bic = downsampleKernel(step, 2, "bicubic");
    let diff = 0;
    for (let i = 0; i < box.data.length; i++) diff = Math.max(diff, Math.abs(box.data[i] - bic.data[i]));
    expect(diff).toBeGreaterThan(1); // models genuinely disagree near edges
  });
  test("throws on indivisible geometry", () => {
    expect(() => downsampleKernel(constantImage(7, 8, 0), 2, "bicubic")).toThrow();
  });
});

describe("projectBoxTapered (zoom-seam probe, shelved)", () => {
  test("block means stay exact; s=2 identical to uniform (tent is uniform)", () => {
    const lr = constantImage(4, 4, 100);
    const raw = upsample(constantImage(4, 4, 90), 2, "lanczos3");
    const proj = projectBoxTapered(raw, lr, 2);
    expect(forwardResidual(proj, lr, 2)).toBeLessThan(1e-9);
    const uni = projectBox(raw, lr, 2);
    for (let i = 0; i < uni.data.length; i++) expect(Math.abs(proj.data[i] - uni.data[i])).toBeLessThan(1e-12);
  });
  test("website verdict lock: tapered blurs blocks (4x step loses >2 dB vs uniform)", () => {
    // If a future change makes tapered beat uniform on blocks, update the
    // falsification record instead of silently flipping behavior.
    const data = new Float64Array(32 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) data[y * 32 + x] = x < 16 ? 0 : 255;
    const hr = { w: 32, h: 32, data };
    const lr = boxDownsample(hr, 4);
    const a = reconstructIbp(lr, 4, { iters: 4 });
    const b = reconstructIbp(lr, 4, { iters: 4, tapered: true });
    // Tapered must remain worse-or-equal here; its adoption was killed.
    expect(psnr(hr, a.x) - psnr(hr, b.x)).toBeGreaterThan(2);
  });
});
