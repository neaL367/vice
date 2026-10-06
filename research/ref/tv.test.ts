// Iter-9 tests: TV-denoise contracts (not quality claims).

import { describe, expect, test } from "bun:test";
import { fixtureGradient, fixtureNoise, fixturePhotoSurrogate, fixtureStep, lcg } from "./adversarial.ts";
import { boxDownsample } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { constantImage, upsample } from "./kernels.ts";
import { psnr } from "./metrics.ts";
import { tvDenoise, tvDenoiseMap } from "./tv.ts";

describe("tvDenoise", () => {
  test("preserves constants; deterministic", () => {
    const c = constantImage(8, 8, 100);
    const a = tvDenoise(c, 4);
    const b = tvDenoise(c, 4);
    for (const v of a.data) expect(Math.abs(v - 100)).toBeLessThan(1e-9);
    expect(a.data).toEqual(b.data);
  });
  test("reduces noise variance on flats while keeping step height", () => {
    const rnd = lcg(99);
    const n = 16 * 16;
    const data = new Float64Array(n);
    for (let i = 0; i < n; i++) data[i] = 128 + (rnd() * 2 - 1) * 12;
    const noisy = { w: 16, h: 16, data };
    const den = tvDenoise(noisy, 4);
    const variance = (img: { data: Float64Array }) => {
      let m = 0;
      for (const v of img.data) m += v;
      m /= img.data.length;
      let va = 0;
      for (const v of img.data) va += (v - m) ** 2;
      return va / img.data.length;
    };
    expect(variance(den)).toBeLessThan(variance(noisy) * 0.5);
    // Step height preserved: TV does not blur edges like a linear filter.
    const step = fixtureStep();
    const lr = boxDownsample(step.hr, 2);
    const up = upsample(lr, 2, "lanczos3");
    const sm = tvDenoise(up, 8);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 14; y < 18; y++)
      for (let x = 0; x < 32; x++) {
        const v = sm.data[y * 32 + x];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    void fixtureNoise;
    void fixtureGradient;
    expect(hi - lo).toBeGreaterThan(200); // edge survives strong TV
  });
  test("tvMap zeros ≡ no-TV (bypass path exact, bit-identical)", () => {
    const step = fixtureStep();
    const lr = boxDownsample(step.hr, 2);
    const zeros = new Float64Array(lr.w * 2 * (lr.h * 2));
    const a = reconstructIbp(lr, 2, { iters: 4 });
    const b = reconstructIbp(lr, 2, { iters: 4, tvMap: { lambda: zeros, tvIters: 10 } });
    expect(b.x.data).toEqual(a.x.data);
  });
  test("uniform-λ TV-IBP is a different method: wins texture, loses edges", () => {
    // Locks the shootout verdict (iter-9): NOT equivalent, NOT superior.
    // Order in ibp.ts is TV-before-Π (measured better than post-filter).
    const ones = (w: number, h: number) => new Float64Array(w * h).fill(1);
    const step = fixtureStep();
    const lrS = boxDownsample(step.hr, 2);
    const baseS = reconstructIbp(lrS, 2, { iters: 4 });
    const tvS = reconstructIbp(lrS, 2, { iters: 4, tvMap: { lambda: ones(lrS.w * 2, lrS.h * 2), tvIters: 30 } });
    // TV loses clean edges badly: different method, not an improvement here.
    expect(psnr(step.hr, tvS.x)).toBeLessThan(psnr(step.hr, baseS.x) - 2);
    const sur = fixturePhotoSurrogate();
    const lrP = boxDownsample(sur.hr, 2);
    const baseP = reconstructIbp(lrP, 2, { iters: 4 });
    const tvP = reconstructIbp(lrP, 2, { iters: 4, tvMap: { lambda: ones(lrP.w * 2, lrP.h * 2), tvIters: 30 } });
    // ...but wins mixed texture: complementary strengths, neither dominates.
    expect(psnr(sur.hr, tvP.x)).toBeGreaterThan(psnr(sur.hr, baseP.x) + 0.3);
  });
});
