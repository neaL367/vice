// Ticket 06 tests: colorimetry mirrors core + alpha exact + degradation probes.

import { describe, expect, test } from "bun:test";
import { fixtureGradient, fixtureJpegBlocks, fixtureNoise } from "./adversarial.ts";
import { chromaDownsample422, linearToSrgb, reconstructAlpha, srgbToLinear } from "./color.ts";
import { estimateNoiseSigma, jpegGridScore } from "./degradation.ts";
import { boxDownsample } from "./forward.ts";

describe("color", () => {
  test("EOTF round-trips; mid-gray 0.18 linear ≈ 0.461 sRGB (core constants)", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.4613, 3);
    for (const v of [0.01, 0.18, 0.5, 0.9]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 12);
  });
  test("alpha path exact: downsample(reconstructAlpha) == source", () => {
    const lr = boxDownsample(fixtureGradient().hr, 2);
    const out = reconstructAlpha(lr, 2);
    const back = boxDownsample(out, 2);
    for (let i = 0; i < back.data.length; i++) expect(Math.abs(back.data[i] - lr.data[i])).toBeLessThan(1e-9);
  });
  test("chroma 422: gray input centers Cb/Cr at 128", () => {
    const g = fixtureGradient().hr; // 32x32 ramp
    const rgb = { w: g.w, h: g.h, r: g, g, b: g };
    const { cb, cr } = chromaDownsample422(rgb);
    for (let i = 0; i < cb.length; i++) {
      expect(Math.abs(cb[i] - 128)).toBeLessThan(1e-9);
      expect(Math.abs(cr[i] - 128)).toBeLessThan(1e-9);
    }
  });
});

describe("degradation", () => {
  test("noise σ̂ orders: white-noise >> gradient (≈0)", () => {
    const n = estimateNoiseSigma(boxDownsample(fixtureNoise().hr, 2));
    const g = estimateNoiseSigma(boxDownsample(fixtureGradient().hr, 2));
    expect(g).toBeLessThan(1);
    expect(n).toBeGreaterThan(10 * g + 1);
  });
  test("jpeg grid score: block fixture > smooth fixture", () => {
    const j = jpegGridScore(fixtureJpegBlocks().hr, 8);
    const g = jpegGridScore(fixtureGradient().hr, 8);
    expect(j).toBeGreaterThan(g + 0.1);
    expect(Math.abs(g - 1)).toBeLessThan(0.15);
  });
});
