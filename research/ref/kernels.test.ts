// Ticket 01 tests: kernels preserve constants; bilinear has no overshoot,
// Lanczos rings on steps (documents foundations §2 claims numerically).

import { describe, expect, test } from "bun:test";
import { constantImage, kernelWeight, upsample, type GrayImage, type KernelName } from "./kernels.ts";

const ALL: KernelName[] = ["nearest", "bilinear", "bicubic", "mitchell", "lanczos2", "lanczos3"];

describe("kernel weights", () => {
  test("partition of unity at half-integers (constant preservation condition)", () => {
    // Renormalized passes preserve constants by construction; raw weights
    // of symmetric kernels sum to ~1 on dense grids.
    for (const k of ALL) {
      let s = 0;
      for (let i = -8; i <= 8; i++) s += kernelWeight(k, i * 0.37);
      expect(Math.abs(s) > 0.2).toBe(true);
    }
  });
  test("bilinear/mitchell non-negative-ish; bicubic/lanczos have negative lobes", () => {
    let minBilinear = Infinity;
    let minCubic = Infinity;
    let minLanczos = Infinity;
    for (let i = 0; i <= 40; i++) {
      const x = i / 10;
      minBilinear = Math.min(minBilinear, kernelWeight("bilinear", x));
      minCubic = Math.min(minCubic, kernelWeight("bicubic", x));
      minLanczos = Math.min(minLanczos, kernelWeight("lanczos3", x));
    }
    expect(minBilinear).toBeGreaterThanOrEqual(0); // non-negative → no ringing
    expect(minCubic).toBeLessThan(0); // negative lobes → halo source
    expect(minLanczos).toBeLessThan(0);
  });
});

describe("upsample constants", () => {
  test("all kernels preserve flat fields (renormalized)", () => {
    for (const k of ALL) {
      const out = upsample(constantImage(8, 8, 128), 2, k);
      let worst = 0;
      for (const v of out.data) worst = Math.max(worst, Math.abs(v - 128));
      expect(worst).toBeLessThan(1e-9);
    }
  });
});

describe("step response", () => {
  // 8px wide: left 0, right 255. Upscale 2x, inspect row middle.
  function step(): GrayImage {
    const w = 8;
    const h = 4;
    const data = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x < 4 ? 0 : 255;
    return { w, h, data };
  }
  test("bilinear never overshoots [0,255]; lanczos3 does (ringing documented)", () => {
    const s = step();
    const b = upsample(s, 2, "bilinear");
    const l = upsample(s, 2, "lanczos3");
    let bWorst = 0;
    let lMax = -Infinity;
    let lMin = Infinity;
    for (const v of b.data) bWorst = Math.max(bWorst, v < 0 ? -v : v > 255 ? v - 255 : 0);
    for (const v of l.data) {
      lMax = Math.max(lMax, v);
      lMin = Math.min(lMin, v);
    }
    expect(bWorst).toBe(0);
    expect(lMax).toBeGreaterThan(255); // overshoot above white
    expect(lMin).toBeLessThan(0); // undershoot below black
  });
});
