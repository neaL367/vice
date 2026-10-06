// Iter-7 full-set harness: Set5/Set14 (full) + BSD100/Urban100 (sampled).
// Protocol mirrors vice_eval: HR only, OWN degradations (box + bicubic D),
// scales 2/3/4, center-crop to multiples of 12 (one crop for all scales).
// Gamma luma; compare method ORDER, not absolute numbers (eval scores linear).
// Usage: bun research/ref/sets.ts [maxBig]   (default maxBig=10)

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptiveWeights, describeFor } from "./adaptive.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { downsampleKernel, upsample, type GrayImage } from "./kernels.ts";
import { gradientError, psnr, ssimLite } from "./metrics.ts";
import { decodePng } from "./png.ts";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "eval", "data");
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
mkdirSync(outDir, { recursive: true });
const maxBig = Number(process.argv[2] ?? 10);

function luma(png: { w: number; h: number; ch: number; data: Uint8Array }): GrayImage {
  const n = png.w * png.h;
  const data = new Float64Array(n);
  for (let i = 0; i < n; i++)
    data[i] = 0.2126 * png.data[i * png.ch] + 0.7152 * png.data[i * png.ch + 1] + 0.0722 * png.data[i * png.ch + 2];
  return { w: png.w, h: png.h, data };
}

function crop12(img: GrayImage): GrayImage {
  const w = Math.floor(img.w / 12) * 12;
  const h = Math.floor(img.h / 12) * 12;
  const x0 = ((img.w - w) / 2) | 0;
  const y0 = ((img.h - h) / 2) | 0;
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = img.data[(y + y0) * img.w + x + x0];
  return { w, h, data };
}

interface Row {
  set: string;
  scale: number;
  degrad: string;
  method: string;
  psnr: number;
  ssim: number;
  ms: number;
  n: number;
}

const sets: { name: string; hrDir: (s: number) => string; max: number }[] = [
  { name: "Set5", hrDir: (s) => join(dataDir, "Set5", "Set5", `image_SRF_${s}`), max: 0 },
  { name: "Set14", hrDir: (s) => join(dataDir, "Set14", "Set14", `image_SRF_${s}`), max: 0 },
  { name: "BSD100", hrDir: (s) => join(dataDir, "BSD100", "BSD100", `image_SRF_${s}`), max: maxBig },
  { name: "Urban100", hrDir: () => join(dataDir, "Urban100", "Urban100_HR"), max: maxBig },
];

const rows: Row[] = [];
for (const set of sets) {
  for (const s of [2, 3, 4]) {
    const dir = set.hrDir(s);
    if (!existsSync(dir)) continue;
    let files = readdirSync(dir).filter((f) => f.endsWith(".png") && f.includes("_HR")).sort();
    if (files.length === 0 && set.name === "Urban100") files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    if (set.max > 0) files = files.slice(0, set.max);
    const acc: Record<string, { psnr: number; ssim: number; ms: number; n: number }> = {};
    for (const file of files) {
      const hr = crop12(luma(decodePng(new Uint8Array(readFileSync(join(dir, file))))));
      for (const degrad of ["box", "bicubic"] as const) {
        const lr = degrad === "box" ? boxDownsample(hr, s) : downsampleKernel(hr, s, "bicubic");
        const { desc, sigma, cls } = describeFor(lr);
        const wLrc = adaptiveWeights(desc, cls, sigma, s, undefined, "lrc");
        const methods: { name: string; run: () => GrayImage }[] = [
          { name: "lanczos3", run: () => upsample(lr, s, "lanczos3") },
          { name: "bicubic", run: () => upsample(lr, s, "bicubic") },
          { name: "uni", run: () => reconstructIbp(lr, s, { iters: 4 }).x },
          { name: "lrc", run: () => reconstructIbp(lr, s, { iters: 4 }, wLrc).x },
        ];
        for (const m of methods) {
          const key = `${degrad}/${m.name}`;
          acc[key] ??= { psnr: 0, ssim: 0, ms: 0, n: 0 };
          const t0 = performance.now();
          const x = m.run();
          acc[key].ms += performance.now() - t0;
          acc[key].psnr += psnr(hr, x);
          acc[key].ssim += ssimLite(hr, x);
          acc[key].n++;
          void gradientError;
          void forwardResidual;
        }
      }
    }
    for (const [key, a] of Object.entries(acc)) {
      const [degrad, method] = key.split("/");
      rows.push({ set: set.name, scale: s, degrad, method, psnr: a.psnr / a.n, ssim: a.ssim / a.n, ms: a.ms / a.n, n: a.n });
    }
    console.log(set.name, s + "x done");
  }
}

writeFileSync(join(outDir, "sets.json"), JSON.stringify({ rows }, null, 1));
let md = `# Full-set harness (gamma luma, own degradations, T=4)\n\nMethod order only — vice_eval scores linear light (see table below for the shipped bar).\n\n`;
for (const r of rows)
  md += `${r.set} ${r.scale}x ${r.degrad}: ${r.method} psnr=${r.psnr.toFixed(2)} ssim=${r.ssim.toFixed(4)} ms=${r.ms.toFixed(0)} n=${r.n}\n`;
writeFileSync(join(outDir, "sets.md"), md);
console.log(`wrote ${rows.length} rows`);
