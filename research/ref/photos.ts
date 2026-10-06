// Iter-5 photo harness: Kodak PNGs → luma → degrade → reconstruct → score.
// Usage: bun research/ref/photos.ts
// Luma is BT.709 on gamma bytes (documented approx; linear path covered by
// color.test.ts). Scores full-frame: borders are a negligible fraction at
// photo sizes, and boundary policy was settled separately (mirror + interior).

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptiveWeights, describeFor } from "./adaptive.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { upsample, type GrayImage, type KernelName } from "./kernels.ts";
import { gradientError, psnr, ringing, ssimLite } from "./metrics.ts";
import { decodePng } from "./png.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "eval", "data", "photos");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
mkdirSync(outDir, { recursive: true });

const KERNELS: KernelName[] = ["nearest", "bilinear", "bicubic", "lanczos3"];
const SCALES = [2, 4];

function luma(img: { w: number; h: number; ch: number; data: Uint8Array }): GrayImage {
  const n = img.w * img.h;
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = img.data[i * img.ch];
    const g = img.data[i * img.ch + (img.ch > 1 ? 1 : 0)];
    const b = img.data[i * img.ch + (img.ch > 2 ? 2 : 0)];
    data[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return { w: img.w, h: img.h, data };
}

interface Row {
  photo: string;
  scale: number;
  method: string;
  psnr: number;
  ssim: number;
  gradErr: number;
  ringRange: number;
  residual: number;
  ms: number;
}

const rows: Row[] = [];
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
for (const file of files) {
  const hr = luma(decodePng(new Uint8Array(readFileSync(join(dir, file)))));
  console.log(file, `${hr.w}x${hr.h}`);
  for (const s of SCALES) {
    const lr = boxDownsample(hr, s);
    const { desc, sigma, cls } = describeFor(lr);
    const wLrc = adaptiveWeights(desc, cls, sigma, s, undefined, "lrc");
    const methods: { name: string; run: () => GrayImage }[] = [
      ...KERNELS.map((k) => ({ name: k, run: () => upsample(lr, s, k) })),
      { name: "ibp-uniform", run: () => reconstructIbp(lr, s, { iters: 4 }).x },
      { name: "ibp-lrc", run: () => reconstructIbp(lr, s, { iters: 4 }, wLrc).x },
    ];
    for (const m of methods) {
      const t0 = performance.now();
      const x = m.run();
      const ms = performance.now() - t0;
      rows.push({
        photo: file,
        scale: s,
        method: m.name,
        psnr: Math.round(psnr(hr, x) * 100) / 100,
        ssim: Math.round(ssimLite(hr, x) * 10000) / 10000,
        gradErr: Math.round(gradientError(hr, x) * 100) / 100,
        ringRange: Math.round(ringing(x).range * 100) / 100,
        residual: forwardResidual(x, lr, s),
        ms: Math.round(ms),
      });
    }
  }
}

writeFileSync(join(outDir, "photos.json"), JSON.stringify({ rows }, null, 1));

let md = `# Photo validation (Kodak 5, luma, box-D, IBP T=4)\n\n`;
md += `Research use; Kodak set is a standard benchmark (see tools/eval/README license note).\n\n`;
for (const s of SCALES) {
  md += `## Scale ${s}x — PSNR (dB)\n\n| photo | nearest | bilinear | bicubic | lanczos3 | ibp-uniform | ibp-lrc | lrc Δ best-fixed |\n|---|---|---|---|---|---|---|---|\n`;
  for (const file of files) {
    const g = (m: string) => rows.find((r) => r.photo === file && r.scale === s && r.method === m)!;
    const fixed = [g("nearest"), g("bilinear"), g("bicubic"), g("lanczos3")];
    const best = fixed.reduce((a, b) => (a.psnr >= b.psnr ? a : b));
    const d = Math.round((g("ibp-lrc").psnr - best.psnr) * 100) / 100;
    md += `| ${file} | ${fixed.map((r) => r.psnr).join(" | ")} | ${g("ibp-uniform").psnr} | ${g("ibp-lrc").psnr} | ${d >= 0 ? "+" : ""}${d} |\n`;
  }
  md += `\n## Scale ${s}x — SSIM-lite / gradErr (lanczos3 vs ibp-lrc)\n\n| photo | ssim lz3 → lrc | gradErr lz3 → lrc | ring lz3 → lrc |\n|---|---|---|---|\n`;
  for (const file of files) {
    const g = (m: string) => rows.find((r) => r.photo === file && r.scale === s && r.method === m)!;
    md += `| ${file} | ${g("lanczos3").ssim} → ${g("ibp-lrc").ssim} | ${g("lanczos3").gradErr} → ${g("ibp-lrc").gradErr} | ${g("lanczos3").ringRange} → ${g("ibp-lrc").ringRange} |\n`;
  }
  md += `\n`;
}
writeFileSync(join(outDir, "photos.md"), md);
console.log(`wrote ${rows.length} rows`);
