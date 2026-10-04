import { describe, expect, test } from "bun:test";
import { projectBox, projectSmooth, SMOOTH_ITERS } from "./pipeline/projection";

// WASM-vs-TS parity: same C++ source as native, compiled with Emscripten.
// Catches toolchain divergence (fast-math, SIMD, f32 precision).
// Requires web/public/wasm/* built (core/wasm-build.sh, gitignored artifacts).
describe("wasm parity", () => {
  test("project_box matches TS mirror", async () => {
    const mod = (await import("../public/wasm/core.js")) as {
      default: () => Promise<{
        _vice_project_box(yPtr: number, rawPtr: number, w: number, h: number, s: number, c: number): void;
        _malloc(n: number): number;
        _free(p: number): void;
        HEAPF32: Float32Array;
      }>;
    };
    const core = await mod.default();
    const w = 5;
    const h = 4;
    const s = 2;
    const c = 3;
    const y = new Float32Array(w * h * c);
    const base = new Float32Array(w * s * h * s * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 17) / 17;
    for (let i = 0; i < base.length; i++) base[i] = (i % 31) / 31;

    const expected = base.slice();
    projectBox(y, expected, w, h, s, c);

    const yPtr = core._malloc(y.length * 4);
    const rawPtr = core._malloc(base.length * 4);
    core.HEAPF32.set(y, yPtr / 4);
    core.HEAPF32.set(base, rawPtr / 4);
    core._vice_project_box(yPtr, rawPtr, w, h, s, c);
    const got = core.HEAPF32.slice(rawPtr / 4, rawPtr / 4 + base.length);
    core._free(yPtr);
    core._free(rawPtr);

    let worst = 0;
    for (let i = 0; i < expected.length; i++)
      worst = Math.max(worst, Math.abs(expected[i] - got[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  test("vice_project (smooth + box) matches TS projectSmooth + projectBox", async () => {
    const mod = (await import("../public/wasm/core.js")) as {
      default: () => Promise<{
        _vice_project_smooth(yPtr: number, rawPtr: number, w: number, h: number, s: number, c: number, it: number): void;
        _vice_project_box(yPtr: number, rawPtr: number, w: number, h: number, s: number, c: number): void;
        _malloc(n: number): number;
        _free(p: number): void;
        HEAPF32: Float32Array;
      }>;
    };
    const core = await mod.default();
    const w = 6;
    const h = 5;
    const s = 3;
    const c = 3;
    const y = new Float32Array(w * h * c);
    const base = new Float32Array(w * s * h * s * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 13) / 13;
    for (let i = 0; i < base.length; i++) base[i] = (i % 29) / 29;

    const expected = base.slice();
    projectSmooth(y, expected, w, h, s, c, SMOOTH_ITERS);
    projectBox(y, expected, w, h, s, c);

    const yPtr = core._malloc(y.length * 4);
    const rawPtr = core._malloc(base.length * 4);
    core.HEAPF32.set(y, yPtr / 4);
    core.HEAPF32.set(base, rawPtr / 4);
    core._vice_project_smooth(yPtr, rawPtr, w, h, s, c, SMOOTH_ITERS);
    core._vice_project_box(yPtr, rawPtr, w, h, s, c);
    const got = core.HEAPF32.slice(rawPtr / 4, rawPtr / 4 + base.length);
    core._free(yPtr);
    core._free(rawPtr);

    let worst = 0;
    for (let i = 0; i < expected.length; i++)
      worst = Math.max(worst, Math.abs(expected[i] - got[i]));
    expect(worst).toBeLessThan(1e-4);
  });

  test("native WASM upscale + project runs and satisfies box consistency", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    expect(core).toBeTruthy();
    if (!core) return;
    expect(core.hasNativeUpscale()).toBe(true);

    const w = 8;
    const h = 6;
    const scale = 2;
    const c = 4;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 19) / 19;

    const ctx = core.create(w, h, scale, c);
    core.setInput(ctx, y);
    core.upscale(ctx);
    core.project(ctx);
    const residual = core.lastResidual(ctx);
    expect(residual).toBeLessThan(1e-4);

    const png = core.finishPng(ctx, w * scale, h * scale, c);
    expect(png.length).toBeGreaterThan(8);
    expect(png[0]).toBe(137); // PNG magic byte
    expect(png[1]).toBe(80);  // 'P'
    core.destroy(ctx);
  });

  test("ViceCore setIccProfile embeds iCCP chunk into PNG", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    const w = 4;
    const h = 4;
    const ctx = core.create(w, h, 2, 4);
    const y = new Float32Array(w * h * 4).fill(0.5);
    core.setInput(ctx, y);
    core.upscale(ctx);
    core.project(ctx);
    const fakeIcc = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    core.setIccProfile(ctx, fakeIcc);
    const png = core.finishPng(ctx, w * 2, h * 2, 4);
    core.destroy(ctx);

    // Verify "iCCP" chunk tag exists in the PNG bytes
    let foundIccp = false;
    for (let i = 0; i + 4 <= png.length; i++) {
      if (
        png[i] === 0x69 && // 'i'
        png[i + 1] === 0x43 && // 'C'
        png[i + 2] === 0x43 && // 'C'
        png[i + 3] === 0x50 // 'P'
      ) {
        foundIccp = true;
        break;
      }
    }
    expect(foundIccp).toBe(true);
  });

  test("chained 4x (2x twice via downloadRaw) satisfies box consistency", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    const w = 6;
    const h = 6;
    const c = 4;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 11) / 11;

    // Pass 1: 2x
    const ctx1 = core.create(w, h, 2, c);
    core.setInput(ctx1, y);
    core.upscale(ctx1);
    core.project(ctx1);
    const mid = core.downloadRaw(ctx1, w * 2 * h * 2 * c);
    core.destroy(ctx1);

    // Pass 2: 2x
    const ctx2 = core.create(w * 2, h * 2, 2, c);
    core.setInput(ctx2, mid);
    core.upscale(ctx2);
    core.project(ctx2);
    const residual = core.lastResidual(ctx2);
    expect(residual).toBeLessThan(1e-4);

    const png = core.finishPng(ctx2, w * 4, h * 4, c);
    expect(png[0]).toBe(137);
    core.destroy(ctx2);
  });

  test("ViceCore upscale with tuning options (pixel-art, dering, sharpness) satisfies box consistency", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    const w = 8;
    const h = 8;
    const c = 4;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 17) / 17;

    for (const preset of ["photo", "smooth", "pixel-art"] as const) {
      const ctx = core.create(w, h, 2, c);
      core.setInput(ctx, y);
      core.upscale(ctx, { preset, dering: 0.8, sharpness: 0.4 });
      core.project(ctx);
      const residual = core.lastResidual(ctx);
      expect(residual).toBeLessThan(1e-4);
      core.destroy(ctx);
    }
  });

  test("ViceCore finishPng applies lossless compression and auto-prunes opaque alpha to RGB", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    const w = 16;
    const h = 16;
    const c = 4;
    const y = new Float32Array(w * h * c);
    // Fill RGB with gradient and Alpha with 1.0 (opaque)
    for (let i = 0; i < w * h; i++) {
      y[i * c + 0] = (i % 16) / 16;
      y[i * c + 1] = ((i * 3) % 16) / 16;
      y[i * c + 2] = ((i * 7) % 16) / 16;
      y[i * c + 3] = 1.0; // 100% opaque
    }

    const ctx = core.create(w, h, 2, c);
    core.setInput(ctx, y);
    core.upscale(ctx);
    core.project(ctx);

    const png = core.finishPng(ctx, w * 2, h * 2, c);
    expect(png[0]).toBe(137); // PNG signature
    expect(png[1]).toBe(80);

    // Byte 25 in standard PNG IHDR is the Color Type: 2 for RGB, 6 for RGBA
    // With lossless alpha pruning, opaque images are encoded as RGB (type 2)
    const colorType = png[25];
    expect(colorType).toBe(2);

    core.destroy(ctx);
  });

  test("ViceCore processBand un-premultiplies RGB and preserves linear alpha", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    const w = 4;
    const h = 4;
    const c = 4;
    const y = new Float32Array(w * h * c);
    // White at 50% alpha: in linear premultiplied float: RGB = 0.5, A = 0.5
    for (let i = 0; i < w * h; i++) {
      y[i * c + 0] = 0.5;
      y[i * c + 1] = 0.5;
      y[i * c + 2] = 0.5;
      y[i * c + 3] = 0.5;
    }
    const ctx = core.create(w, h, 2, c);
    core.setInput(ctx, y);
    core.upscale(ctx);
    core.project(ctx);

    const rows = core.processBand(ctx, 0, w * 2, h * 2, c);
    // White un-premultiplies back to ~255, and linear alpha is ~128
    // NOT the buggy 187 188 188 188
    expect(rows[0]).toBeGreaterThanOrEqual(254);
    expect(rows[1]).toBeGreaterThanOrEqual(254);
    expect(rows[2]).toBeGreaterThanOrEqual(254);
    expect(rows[3]).toBeGreaterThanOrEqual(127);
    expect(rows[3]).toBeLessThanOrEqual(128);

    core.destroy(ctx);
  });

  test("TS upscale+projectClamp matches WASM upscale+project pixels", async () => {
    // Full-pipeline parity: same residual is not enough (both converge),
    // pixels must match. Guards multigrid cycle count, shock, and alpha
    // handling drift between the TS mirror and the C++ core.
    const { ViceCore } = await import("./vice-wasm");
    const { lanczosAdaptiveScale } = await import("./pipeline/kernels");
    const { projectClamp } = await import("./pipeline/projection");
    const core = await ViceCore.load("../public/");
    if (!core) return;

    const cases = [
      { w: 8, h: 6, scale: 2, c: 4, opts: { preset: "photo" as const, dering: 1.0, sharpness: 0.35, shock: 0.35 } },
      { w: 7, h: 5, scale: 3, c: 3, opts: { preset: "smooth" as const, dering: 1.0, sharpness: 0.35, shock: 0 } },
    ];
    for (const { w, h, scale, c, opts } of cases) {
      const y = new Float32Array(w * h * c);
      for (let i = 0; i < y.length; i++) y[i] = ((i * 7 + 3) % 19) / 19;

      const tsRaw = lanczosAdaptiveScale(y, w, h, c, scale, opts);
      projectClamp(y, tsRaw, w, h, scale, c);

      const ctx = core.create(w, h, scale, c);
      core.setInput(ctx, y);
      core.upscale(ctx, opts);
      core.project(ctx);
      const wasmRaw = core.downloadRaw(ctx, w * scale * h * scale * c);
      core.destroy(ctx);

      let worst = 0;
      for (let i = 0; i < tsRaw.length; i++)
        worst = Math.max(worst, Math.abs(tsRaw[i] - wasmRaw[i]));
      expect(worst).toBeLessThan(1e-5);
    }
  });

  test("streaming strip matches full-image path within box-only tolerance", async () => {
    // The strip pipeline uses the same upscaler but box-only band projection
    // (no multigrid), so pixels differ slightly by design. Measured
    // 2026-10: flat identical, grad/chirp <= 2 LSB worst, step edge <= 7 LSB
    // worst / sub-LSB mean. White-noise adversarial input can flip isolated
    // near-rail pixels (both paths stay exact), so fixtures here are
    // photographic: flat, gradient, edge, chirp.
    const { ViceCore } = await import("./vice-wasm");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    expect(core.hasStream()).toBe(true);

    const cases = [
      { w: 8, h: 6, scale: 2, c: 4, kind: "grad" },
      { w: 8, h: 6, scale: 2, c: 4, kind: "flat" },
      { w: 8, h: 6, scale: 2, c: 4, kind: "edge" },
      { w: 9, h: 7, scale: 3, c: 3, kind: "chirp" },
    ] as const;
    for (const { w, h, scale, c, kind } of cases) {
      const y = new Float32Array(w * h * c);
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++)
          for (let ch = 0; ch < c; ch++) {
            y[(yy * w + xx) * c + ch] =
              kind === "flat"
                ? 0.5
                : kind === "edge"
                  ? xx < w / 2
                    ? 0.1
                    : 0.9
                  : kind === "chirp"
                    ? 0.5 + 0.4 * Math.sin(xx * 0.3) * Math.sin(yy * 0.23)
                    : 0.1 + 0.8 * (xx / (w - 1)) * (yy / (h - 1));
          }
      const opts = { preset: "photo" as const, dering: 1.0, sharpness: 0.35, shock: 0.35 };
      const W = w * scale;
      const H = h * scale;

      // Full-image 8-bit reference via processBand.
      const ctx = core.create(w, h, scale, c);
      core.setInput(ctx, y);
      core.upscale(ctx, opts);
      core.project(ctx);
      const full = new Uint8Array(W * H * c);
      let foff = 0;
      for (let b = 0; ; b++) {
        const rows = core.processBand(ctx, b, W, H, c);
        if (rows.length === 0) break;
        full.set(rows, foff);
        foff += rows.length;
      }
      expect(foff).toBe(W * H * c);
      core.destroy(ctx);

      // Streaming protocol: 3-row pushes, 64-row band pulls.
      const sctx = core.createStream(w, h, scale, c, 64);
      core.streamSetTuning(sctx, opts);
      core.streamSetIcc(sctx, new Uint8Array([9, 8, 7, 6]));
      const inRow = w * c;
      for (let yy = 0; yy < h; yy += 3) {
        const n = Math.min(3, h - yy);
        core.streamPushRows(sctx, y.subarray(yy * inRow, (yy + n) * inRow), n);
      }
      const got = new Uint8Array(W * H * c);
      const bandPtr = core.mallocBytes(64 * W * c);
      let emitted = 0;
      while (emitted < H) {
        if (!core.streamHasNext(sctx)) throw new Error("stream stalled");
        const { rows } = core.streamPullBand(sctx, bandPtr, 64);
        got.set(core.readBytes(bandPtr, rows * W * c), emitted * W * c);
        emitted += rows;
      }
      expect(emitted).toBe(H);
      core.freeBytes(bandPtr);
      expect(core.lastStreamResidual(sctx)).toBeLessThan(1e-5);

      // PNG finish over the accumulated rows carries the stored ICC profile.
      const rgbaPtr = core.writeBytes(got);
      const png = core.streamFinishPng(sctx, rgbaPtr, got.length);
      core.freeBytes(rgbaPtr);
      core.streamDestroy(sctx);
      expect(png.length).toBeGreaterThan(8);
      expect(png[0]).toBe(137);
      let foundIccp = false;
      for (let i = 0; i + 4 <= png.length; i++) {
        if (png[i] === 0x69 && png[i + 1] === 0x43 && png[i + 2] === 0x43 && png[i + 3] === 0x50) {
          foundIccp = true;
          break;
        }
      }
      expect(foundIccp).toBe(true);

      let worst = 0;
      let sum = 0;
      for (let i = 0; i < full.length; i++) {
        const d = Math.abs(full[i] - got[i]) / 255;
        if (d > worst) worst = d;
        sum += d;
      }
      expect(worst).toBeLessThan(0.05);
      expect(sum / full.length).toBeLessThan(0.01);
    }
  });

  test("TS lanczosAdaptiveScale matches WASM upscale with identical tuning", async () => {
    const { ViceCore } = await import("./vice-wasm");
    const { lanczosAdaptiveScale } = await import("./pipeline/kernels");
    const core = await ViceCore.load("../public/");
    if (!core) return;
    const w = 8;
    const h = 6;
    const scale = 2;
    const c = 4;
    const y = new Float32Array(w * h * c);
    for (let i = 0; i < y.length; i++) y[i] = (i % 19) / 19;

    for (const opts of [
      { preset: "photo" as const, dering: 1.0, sharpness: 0.35, shock: 0.35 },
      { preset: "smooth" as const, dering: 1.0, sharpness: 0.35, shock: 0 },
    ]) {
      const expected = lanczosAdaptiveScale(y, w, h, c, scale, opts);
      const ctx = core.create(w, h, scale, c);
      core.setInput(ctx, y);
      core.upscale(ctx, opts);
      const got = core.downloadRaw(ctx, w * scale * h * scale * c);
      core.destroy(ctx);
      let worst = 0;
      for (let i = 0; i < expected.length; i++)
        worst = Math.max(worst, Math.abs(expected[i] - got[i]));
      expect(worst).toBeLessThan(2e-3);
    }
  });
});
