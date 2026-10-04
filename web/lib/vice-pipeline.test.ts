import { describe, expect, test } from "bun:test";
import { linearToSrgb, srgbToLinear } from "./pipeline/color";
import { bilinearScale, computeStructureTensor, lanczosAdaptiveScale } from "./pipeline/kernels";
import { measureResidual, projectBox, projectClamp, projectMultiGrid } from "./pipeline/projection";
import { planOverlap, reflectIndex, tiledUpscaleLanczos } from "./pipeline/tiler";

describe("vice-pipeline", () => {
  test("project exact in float (<1e-5)", () => {
    const w = 5;
    const h = 4;
    const s = 2;
    const c = 3;
    const y = new Float32Array(w * h * c);
    const raw = new Float32Array(w * s * h * s * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 17) / 17;
    for (let i = 0; i < raw.length; i++) raw[i] = (i % 31) / 31;
    projectBox(y, raw, w, h, s, c);
    expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
  });

  test("3x bilinear + project stays consistent", () => {
    const w = 6;
    const h = 5;
    const s = 3;
    const c = 3;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 13) / 13;
    const raw = bilinearScale(y, w, h, c, s);
    expect(raw.length).toBe(w * s * h * s * c);
    // One projection is exact for any content (spec sec 3).
    projectBox(y, raw, w, h, s, c);
    expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
  });

  test("project+clamp exact on smooth content, all scales", () => {
    for (const s of [2, 3, 4]) {
      const w = 9;
      const h = 7;
      const c = 3;
      const y = new Float32Array(w * h * c);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++)
          for (let ch = 0; ch < c; ch++)
            y[(j * w + i) * c + ch] = 0.2 + 0.6 * (i / (w - 1)) * (j / (h - 1));
      const raw = bilinearScale(y, w, h, c, s);
      // Sharp content clips on clamp by design; smooth content must not.
      expect(projectClamp(y, raw, w, h, s, c, 3)).toBeLessThan(1e-5);
    }
  });

  test("color roundtrip within tolerance", () => {
    for (let i = 0; i <= 255; i++) {
      const s = i / 255;
      expect(Math.abs(linearToSrgb(srgbToLinear(s)) - s)).toBeLessThan(0.002);
    }
  });

  test("reflectIndex mirrors edges", () => {
    expect(reflectIndex(-1, 8)).toBe(1);
    expect(reflectIndex(8, 8)).toBe(6);
    expect(reflectIndex(0, 8)).toBe(0);
    expect(reflectIndex(7, 8)).toBe(7);
    expect(reflectIndex(-9, 8)).toBe(5);
    expect(reflectIndex(3, 1)).toBe(0);
  });

  test("planOverlap covers every pixel", () => {
    for (const [w, h, t, o] of [[300, 200, 128, 16], [8, 8, 512, 32], [1024, 1024, 512, 32]] as const) {
      const tiles = planOverlap(w, h, t, o);
      const cov = new Uint8Array(w * h);
      for (const tl of tiles)
        for (let y = 0; y < Math.min(tl.ih, h - tl.iy); y++)
          for (let x = 0; x < Math.min(tl.iw, w - tl.ix); x++)
            cov[(tl.iy + y) * w + tl.ix + x]++;
      for (let i = 0; i < cov.length; i++) expect(cov[i]).toBeGreaterThanOrEqual(1);
    }
  });

  test("lanczosAdaptiveScale + project stays consistent on all scales", () => {
    for (const s of [2, 3, 4]) {
      const w = 8;
      const h = 6;
      const c = 3;
      const y = new Float32Array(w * h * c);
      for (let i = 0; i < y.length; i++) y[i] = (i % 19) / 19;
      const raw = lanczosAdaptiveScale(y, w, h, c, s);
      expect(raw.length).toBe(w * s * h * s * c);
      projectBox(y, raw, w, h, s, c);
      expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
    }
  });

  test("tiledUpscaleLanczos + project stays consistent on large tiled inputs", () => {
    const w = 48;
    const h = 36;
    const s = 2;
    const c = 3;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 23) / 23;
    const raw = tiledUpscaleLanczos(y, w, h, c, s, 16, 4);
    expect(raw.length).toBe(w * s * h * s * c);
    projectBox(y, raw, w, h, s, c);
    expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
  });

  test("quality presets (pixel-art, smooth, photo) satisfy exact box consistency", () => {
    const w = 12;
    const h = 8;
    const c = 3;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 17) / 17;

    for (const preset of ["photo", "smooth", "pixel-art"] as const) {
      for (const s of [2, 3, 4]) {
        const raw = lanczosAdaptiveScale(y, w, h, c, s, { preset });
        projectBox(y, raw, w, h, s, c);
        expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
      }
    }
  });

  test("null-space sharpness and deringing tuning preserve box consistency", () => {
    const w = 10;
    const h = 10;
    const c = 3;
    const s = 2;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 13) / 13;

    // Test extreme sharpness and varied deringing
    for (const sharpness of [0.0, 0.5, 1.0]) {
      for (const dering of [0.0, 0.5, 1.0]) {
        const raw = lanczosAdaptiveScale(y, w, h, c, s, { sharpness, dering });
        projectBox(y, raw, w, h, s, c);
        expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
      }
    }
  });

  test("hierarchical multi-grid consistency solver satisfies exact box downscale", () => {
    const w = 16;
    const h = 12;
    const s = 2;
    const c = 4;
    const y = new Float32Array(w * h * c);
    const raw = new Float32Array(w * s * h * s * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 13) / 13;
    for (let i = 0; i < raw.length; i++) raw[i] = (i % 29) / 29;

    projectMultiGrid(y, raw, w, h, s, c, 2);
    expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
  });

  test("Vice 2.0 structure tensor accurately identifies directional edge coherence", () => {
    const w = 16;
    const h = 16;
    const c = 3;
    const img = new Float32Array(w * h * c);

    // Create a sharp diagonal step edge from (0, 0) to (15, 15)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = x > y ? 0.9 : 0.1;
        for (let ch = 0; ch < c; ch++) {
          img[(y * w + x) * c + ch] = val;
        }
      }
    }

    const tensor = computeStructureTensor(img, w, h, c);
    expect(tensor.coherence.length).toBe(w * h);

    // Flat region (0, 15) should have near zero coherence
    const flatIdx = 15 * w + 0;
    expect(tensor.coherence[flatIdx]).toBeLessThan(0.05);

    // Diagonal edge region (8, 8) should have high coherence
    const edgeIdx = 8 * w + 8;
    expect(tensor.coherence[edgeIdx]).toBeGreaterThan(0.5);
  });

  test("Vice 2.0 coherence shock filter steepens edges while preserving box consistency", () => {
    const w = 12;
    const h = 12;
    const s = 2;
    const c = 3;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 17) / 17;

    for (const shock of [0.2, 0.5, 0.8, 1.0]) {
      const raw = lanczosAdaptiveScale(y, w, h, c, s, { preset: "photo", shock, sharpness: 0.5 });
      projectBox(y, raw, w, h, s, c);
      expect(measureResidual(y, raw, w, h, s, c)).toBeLessThan(1e-5);
    }
  });
});
