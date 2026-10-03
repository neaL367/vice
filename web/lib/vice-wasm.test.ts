import { describe, expect, test } from "bun:test";
import { projectBox } from "./vice-pipeline";

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
});
