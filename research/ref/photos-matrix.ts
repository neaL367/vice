// Iter-6 mismatch matrix: D ∈ {box, bicubic} × domain ∈ {gamma, linear} ×
// projection ∈ {on, off} on Kodak 5 at 2x/4x.
// Question: does box-consistency (Π) help or hurt when the true degradation
// is bicubic? And does the adaptive win survive linear light?
// Usage: bun research/ref/photos-matrix.ts

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptiveWeights, describeFor } from "./adaptive.ts";
import { linearToSrgb, srgbToLinear } from "./color.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { downsampleKernel, upsample, type GrayImage } from "./kernels.ts";
import { gradientError, psnr, ssimLite } from "./metrics.ts";
import { decodePng } from "./png.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "eval", "data", "photos");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
mkdirSync(outDir, { recursive: true });

const SCALES = [2, 4];

function lumaGamma(png: { w: number; h: number; ch: number; data: Uint8Array }): GrayImage {
  const n = png.w * png.h;
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++)
    data[i] = 0.2126 * png.data[i * png.ch] + 0.7152 * png.data[i * png.ch + 1] + 0.0722 * png.data[i * png.ch + 2];
  return { w: png.w, h: png.h, data };
}

function lumaLinear(png: { w: number; h: number; ch: number; data: Uint8Array }): GrayImage {
  // Linear-light luma in 0..1 (engine works 0..255: scaled at call sites).
  const n = png.w * png.h;
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++)
    data[i] =
      0.2126 * srgbToLinear(png.data[i * png.ch] / 255) +
      0.7152 * srgbToLinear(png.data[i * png.ch + 1] / 255) +
      0.0722 * srgbToLinear(png.data[i * png.ch + 2] / 255);
  return { w: png.w, h: png.h, data };
}

interface Row {
  photo: string;
  scale: number;
  degrad: string;
  domain: string;
  method: string;
  psnr: number;
  ssim: number;
  gradErr: number;
  ms: number;
}

const rows: Row[] = [];
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
for (const file of files) {
  const png = decodePng(new Uint8Array(readFileSync(join(dir, file))));
  for (const domain of ["gamma", "linear"] as const) {
    const base = domain === "gamma" ? lumaGamma(png) : lumaLinear(png);
    const peak = domain === "gamma" ? 255 : 1;
    // Engine works in 0..255: scale linear up, unscale for scoring.
    const work: GrayImage =
      domain === "gamma" ? base : { w: base.w, h: base.h, data: base.data.map((v) => v * 255) };
    const truth: GrayImage = domain === "gamma" ? base : base;
    for (const s of SCALES) {
      for (const degrad of ["box", "bicubic"] as const) {
        const lr = degrad === "box" ? boxDownsample(work, s) : downsampleKernel(work, s, "bicubic");
        const { desc, sigma, cls } = describeFor(lr);
        const wLrc = adaptiveWeights(desc, cls, sigma, s, undefined, "lrc");
        const unscale = (x: GrayImage): GrayImage =>
          domain === "gamma" ? x : { w: x.w, h: x.h, data: x.data.map((v) => v / 255) };
        const methods: { name: string; run: () => GrayImage }[] = [
          { name: "lanczos3", run: () => unscale(upsample(lr, s, "lanczos3")) },
          { name: "bicubic", run: () => unscale(upsample(lr, s, "bicubic")) },
          { name: "uni-proj", run: () => unscale(reconstructIbp(lr, s, { iters: 4 }).x) },
          { name: "uni-noproj", run: () => unscale(reconstructIbp(lr, s, { iters: 4, project: false, clamp: false }).x) },
          { name: "lrc-proj", run: () => unscale(reconstructIbp(lr, s, { iters: 4 }, wLrc).x) },
          { name: "lrc-noproj", run: () => unscale(reconstructIbp(lr, s, { iters: 4, project: false, clamp: false }, wLrc).x) },
        ];
        for (const m of methods) {
          const t0 = performance.now();
          const x = m.run();
          const ms = performance.now() - t0;
          rows.push({
            photo: file,
            scale: s,
            degrad,
            domain,
            method: m.name,
            psnr: Math.round(psnr(truth, x, peak) * 100) / 100,
            ssim: Math.round(ssimLite(truth, x, peak) * 10000) / 10000,
            gradErr: Math.round(gradientError(truth, x) * 100) / 100,
            ms: Math.round(ms),
          });
        }
      }
    }
  }
  console.log(file, "done");
}

void linearToSrgb;
writeFileSync(join(outDir, "photos-matrix.json"), JSON.stringify({ rows }, null, 1));

let md = `# Mismatch matrix (Kodak 5, D × domain × projection)\n\n`;
md += `PSNR across domains NOT comparable (different peak/scale); compare method ORDER within each block.\n`;
md += `box-D rows should reproduce photos.md (sanity check).\n\n`;
for (const domain of ["gamma", "linear"]) {
  for (const s of SCALES) {
    for (const degrad of ["box", "bicubic"]) {
      md += `## ${domain} ${s}x ${degrad}-D — mean PSNR over 5 photos\n\n| method | mean PSNR | mean SSIM | mean gradErr |\n|---|---|---|---|\n`;
      for (const m of ["lanczos3", "bicubic", "uni-proj", "uni-noproj", "lrc-proj", "lrc-noproj"]) {
        const rs = rows.filter((r) => r.domain === domain && r.scale === s && r.degrad === degrad && r.method === m);
        const mean = (f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
        md += `| ${m} | ${mean((r) => r.psnr).toFixed(2)} | ${mean((r) => r.ssim).toFixed(4)} | ${mean((r) => r.gradErr).toFixed(2)} |\n`;
      }
      md += `\n`;
    }
  }
}
writeFileSync(join(outDir, "photos-matrix.md"), md);
console.log(`wrote ${rows.length} rows`);
