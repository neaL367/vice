// Ticket 05 tests: descriptor geometry + adaptive law contracts.

import { describe, expect, test } from "bun:test";
import { fixtureGradient, fixturePhotoSurrogate, fixtureRepeated, fixtureThinH, fixtureStep, lcg } from "./adversarial.ts";
import { adaptiveWeights, describeFor, varianceClassify } from "./adaptive.ts";
import { computeDescriptors } from "./descriptors.ts";
import { boxDownsample } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { upsample } from "./kernels.ts";
import { psnr } from "./metrics.ts";

describe("descriptors", () => {
  test("ramp: gradient along +x, coherent, zero curvature interior", () => {
    const lr = boxDownsample(fixtureGradient().hr, 2); // 16x16
    const d = computeDescriptors(lr);
    const i = 8 * 16 + 8;
    expect(d.dirX[i]).toBeCloseTo(1, 6);
    expect(Math.abs(d.dirY[i])).toBeLessThan(1e-9);
    expect(d.coh[i]).toBeCloseTo(1, 6);
    expect(d.curv[i]).toBeLessThan(0.05);
    expect(d.vnorm[i]).toBeGreaterThan(0); // ramp has variance
  });
  test("step LR: edge confidence + curvature peak at transition", () => {
    const lr = boxDownsample(fixtureStep().hr, 2);
    const d = computeDescriptors(lr);
    let edgeMax = 0;
    let curvMax = 0;
    for (let i = 0; i < d.edge.length; i++) {
      edgeMax = Math.max(edgeMax, d.edge[i]);
      curvMax = Math.max(curvMax, d.curv[i]);
    }
    expect(edgeMax).toBeGreaterThan(0.5);
    expect(curvMax).toBeGreaterThan(0.5);
  });
  test("flat LR (checkerboard nullspace): all descriptors ~0", () => {
    const lr = boxDownsample(fixtureGradient().hr, 2);
    void lr;
    const flat = { w: 8, h: 8, data: new Float64Array(64).fill(127.5) };
    const d = computeDescriptors(flat);
    for (let i = 0; i < 64; i++) {
      expect(d.gnorm[i]).toBe(0);
      expect(d.vnorm[i]).toBe(0);
      expect(d.hf[i]).toBe(0);
    }
  });
});

describe("adaptive law", () => {
  test("weights in [0,1], deterministic", () => {
    const lr = boxDownsample(fixtureStep().hr, 2);
    const { desc, sigma, cls } = describeFor(lr);
    const a = adaptiveWeights(desc, cls, sigma, 2);
    const b = adaptiveWeights(desc, cls, sigma, 2);
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  test("noise-aware: adaptive amplifies noise less than uniform IBP", () => {
    // True acceptance (ticket 06): conservative in noisy zones = less HF
    // energy injected into the nullspace. Intra-block variance measures it:
    // Π fixes block means, so variance inside blocks is pure nullspace choice.
    // (A mean-weight proxy was tried first and failed honestly: noise inflates
    // every amplitude descriptor, so noisy weights exceed clean ones. The
    // decision moved to gates; this metric is what "conservative" means.)
    const clean = boxDownsample(fixtureGradient().hr, 2);
    const rnd = lcg(1234);
    const noisyData = new Float64Array(clean.data.length);
    for (let i = 0; i < noisyData.length; i++) noisyData[i] = clean.data[i] + (rnd() * 2 - 1) * 10;
    const noisy = { w: clean.w, h: clean.h, data: noisyData };
    const n = describeFor(noisy);
    expect(n.sigma).toBeGreaterThan(1); // estimator sees the injected noise
    const w = adaptiveWeights(n.desc, n.cls, n.sigma, 2);
    const uni = reconstructIbp(noisy, 2, { iters: 4 });
    const ad = reconstructIbp(noisy, 2, { iters: 4 }, w);
    const ibvar = (img: { w: number; h: number; data: Float64Array }, s: number) => {
      let sv = 0;
      let nb = 0;
      for (let y = 0; y < img.h; y += s)
        for (let x = 0; x < img.w; x += s) {
          let m = 0;
          for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) m += img.data[(y + dy) * img.w + x + dx];
          m /= s * s;
          let v = 0;
          for (let dy = 0; dy < s; dy++)
            for (let dx = 0; dx < s; dx++) {
              const dd = img.data[(y + dy) * img.w + x + dx] - m;
              v += dd * dd;
            }
          sv += v / (s * s);
          nb++;
        }
      return sv / nb;
    };
    expect(ibvar(ad.x, 2)).toBeLessThan(ibvar(uni.x, 2));
  });
  test("gradient 4x interior: adaptive beats uniform by ≥0.5 dB (locks observed win)", () => {
    // Interior-scored: boundary extension policy is tested separately; global
    // scores on 32px fixtures are border-dominated (see bench.ts MARGIN note).
    const f = fixtureGradient();
    const lr = boxDownsample(f.hr, 4);
    const { desc, sigma, cls } = describeFor(lr);
    const uni = reconstructIbp(lr, 4, { iters: 4 });
    const ad = reconstructIbp(lr, 4, { iters: 4 }, adaptiveWeights(desc, cls, sigma, 4));
    const crop = (img: { w: number; h: number; data: Float64Array }, m: number) => {
      const data = new Float64Array((img.w - 2 * m) * (img.h - 2 * m));
      for (let y = 0; y < img.h - 2 * m; y++)
        for (let x = 0; x < img.w - 2 * m; x++) data[y * (img.w - 2 * m) + x] = img.data[(y + m) * img.w + x + m];
      return { w: img.w - 2 * m, h: img.h - 2 * m, data };
    };
    const ref = crop(f.hr, 4);
    expect(psnr(ref, crop(ad.x, 4)) - psnr(ref, crop(uni.x, 4))).toBeGreaterThan(0.5);
  });
  test("HYP-2 kill test: LRC classes differ wildly from variance-only, outcomes do not", () => {
    // thin-h 4x: classifiers disagree on >50% of pixels, yet PSNR matches —
    // the complexity classifier carries no decision-relevant information here.
    const thinH = fixtureThinH();
    const lr2 = boxDownsample(thinH.hr, 4);
    const d2 = describeFor(lr2);
    const vr2 = varianceClassify(d2.desc);
    let diff = 0;
    for (let i = 0; i < d2.cls.length; i++) if ((d2.cls[i] === 0) !== (vr2[i] === 0)) diff++;
    expect(diff / d2.cls.length).toBeGreaterThan(0.5); // mechanisms genuinely differ
    const ad = reconstructIbp(lr2, 4, { iters: 4 }, adaptiveWeights(d2.desc, d2.cls, d2.sigma, 4, undefined, "lrc"));
    const va = reconstructIbp(lr2, 4, { iters: 4 }, adaptiveWeights(d2.desc, vr2, d2.sigma, 4, undefined, "variance"));
    expect(Math.abs(psnr(thinH.hr, ad.x) - psnr(thinH.hr, va.x))).toBeLessThan(0.1); // ...yet outcomes match
  });
  test("photo-surrogate 2x: loop beats best fixed by >1 dB, adaptive ≥ uniform", () => {
    // Transfer test: law must hold at photo scale (128px mixed 1/f content),
    // not just on 32px toys. Interior-scored (margin 4).
    const f = fixturePhotoSurrogate();
    const lr = boxDownsample(f.hr, 2);
    const { desc, sigma, cls } = describeFor(lr);
    const uni = reconstructIbp(lr, 2, { iters: 4 });
    const ad = reconstructIbp(lr, 2, { iters: 4 }, adaptiveWeights(desc, cls, sigma, 2));
    const lz = upsample(lr, 2, "lanczos3");
    const crop = (img: { w: number; h: number; data: Float64Array }, m: number) => {
      const data = new Float64Array((img.w - 2 * m) * (img.h - 2 * m));
      for (let y = 0; y < img.h - 2 * m; y++)
        for (let x = 0; x < img.w - 2 * m; x++) data[y * (img.w - 2 * m) + x] = img.data[(y + m) * img.w + x + m];
      return { w: img.w - 2 * m, h: img.h - 2 * m, data };
    };
    const ref = crop(f.hr, 4);
    expect(psnr(ref, crop(ad.x, 4)) - psnr(ref, crop(lz, 4))).toBeGreaterThan(1);
    expect(psnr(ref, crop(ad.x, 4))).toBeGreaterThanOrEqual(psnr(ref, crop(uni.x, 4)));
  });
});
