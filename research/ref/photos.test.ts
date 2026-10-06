// Iter-5 photo validation lock. Runs only when Kodak PNGs are present
// (tools/eval/data is gitignored; fetch per tools/eval/photos note).
// Asserts the headline: adaptive loop ≥ best fixed kernel on every photo.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adaptiveWeights, describeFor } from "./adaptive.ts";
import { boxDownsample } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { upsample } from "./kernels.ts";
import { psnr } from "./metrics.ts";
import { decodePng } from "./png.ts";

const dir = "tools/eval/data/photos";
const present = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".png"));

describe.skipIf(!present)("kodak validation", () => {
  test("ibp-lrc ≥ lanczos3 on every photo at 2x (within 0.05 dB tolerance)", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const png = decodePng(new Uint8Array(readFileSync(join(dir, file))));
      const n = png.w * png.h;
      const data = new Float64Array(n);
      for (let i = 0; i < n; i++)
        data[i] = 0.2126 * png.data[i * png.ch] + 0.7152 * png.data[i * png.ch + 1] + 0.0722 * png.data[i * png.ch + 2];
      const hr = { w: png.w, h: png.h, data };
      const lr = boxDownsample(hr, 2);
      const { desc, sigma, cls } = describeFor(lr);
      const ad = reconstructIbp(lr, 2, { iters: 4 }, adaptiveWeights(desc, cls, sigma, 2));
      const lz = upsample(lr, 2, "lanczos3");
      expect(psnr(hr, ad.x) - psnr(hr, lz)).toBeGreaterThan(-0.05);
    }
  });
});
