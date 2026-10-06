// Ticket 03: baseline benchmark — degrade → reconstruct → score.
// Usage: bun research/ref/bench.ts
// Writes research/results/baseline.json + baseline.md

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allFixtures } from "./adversarial.ts";
import { adaptiveWeights, describeFor, varianceClassify } from "./adaptive.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { upsample, type GrayImage, type KernelName } from "./kernels.ts";
import { gradientError, psnr, ringing, ssimLite } from "./metrics.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
mkdirSync(root, { recursive: true });

const KERNELS: KernelName[] = ["nearest", "bilinear", "bicubic", "mitchell", "lanczos2", "lanczos3"];
const SCALES = [2, 4];

interface Row {
  fixture: string;
  scale: number;
  method: string;
  psnr: number | null; // null = Infinity
  ssim: number;
  gradErr: number;
  ringRange: number;
  residual: number;
  ms: number;
}

const rows: Row[] = [];
// Interior margin: boundary extension policy is tested separately; global
// scores on 32px fixtures are border-dominated (measured: 2px border carried
// ~95% of gradient-ramp MSE). Residual stays global (Π is exact everywhere).
const MARGIN = 4;
function interior(img: GrayImage, m: number): GrayImage {
  const w = img.w - 2 * m;
  const h = img.h - 2 * m;
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = img.data[(y + m) * img.w + x + m];
  return { w, h, data };
}
for (const f of allFixtures()) {
  for (const s of SCALES) {
    const lr = boxDownsample(f.hr, s);
    const { desc, sigma, cls } = describeFor(lr);
    const wLrc = adaptiveWeights(desc, cls, sigma, s, undefined, "lrc");
    const wVar = adaptiveWeights(desc, varianceClassify(desc), sigma, s, undefined, "variance");
    const methods: { name: string; run: () => { w: number; h: number; data: Float64Array } }[] = [
      ...KERNELS.map((k) => ({ name: k, run: () => upsample(lr, s, k) })),
      { name: "ibp-uniform", run: () => reconstructIbp(lr, s, { iters: 4 }).x },
      { name: "ibp-lrc", run: () => reconstructIbp(lr, s, { iters: 4 }, wLrc).x },
      { name: "ibp-var", run: () => reconstructIbp(lr, s, { iters: 4 }, wVar).x },
    ];
    for (const m of methods) {
      const t0 = performance.now();
      const x = m.run();
      const ms = performance.now() - t0;
      const ref = interior({ w: f.hr.w, h: f.hr.h, data: f.hr.data }, MARGIN);
      const est = interior(x, MARGIN);
      const p = psnr(ref, est);
      rows.push({
        fixture: f.name,
        scale: s,
        method: m.name,
        psnr: Number.isFinite(p) ? Math.round(p * 100) / 100 : null,
        ssim: Math.round(ssimLite(ref, est) * 10000) / 10000,
        gradErr: Math.round(gradientError(ref, est) * 100) / 100,
        ringRange: Math.round(ringing(est).range * 100) / 100,
        residual: forwardResidual(x, lr, s),
        ms: Math.round(ms * 10) / 10,
      });
    }
  }
}

writeFileSync(join(root, "baseline.json"), JSON.stringify({ rows }, null, 1));

// Markdown: per-scale winner table (PSNR) + residual violations.
let md = `# Baseline benchmark (reference TS, box-D, guarded IBP T=4, interior margin ${MARGIN}px)\n\n`;
md += `Null-PSNR cells (checkerboard/nyquist): every method scores ≈ identikit gray — expected, nullspace total.\n\n`;
for (const s of SCALES) {
  md += `## Scale ${s}x — PSNR interior (dB; null = ∞)\n\n| fixture | best fixed | dB | ibp-uniform | ibp-lrc | ibp-var | lrc Δ vs uniform | lrc Δ vs best-fixed |\n|---|---|---|---|---|---|---|---|\n`;
  const fx = [...new Set(rows.map((r) => r.fixture))];
  for (const f of fx) {
    const fixed = rows.filter((r) => r.fixture === f && r.scale === s && !r.method.startsWith("ibp-"));
    const uni = rows.find((r) => r.fixture === f && r.scale === s && r.method === "ibp-uniform")!;
    const lrc = rows.find((r) => r.fixture === f && r.scale === s && r.method === "ibp-lrc")!;
    const vr = rows.find((r) => r.fixture === f && r.scale === s && r.method === "ibp-var")!;
    const best = fixed.reduce((a, b) => ((a.psnr ?? Infinity) >= (b.psnr ?? Infinity) ? a : b));
    const fmt = (v: number | null) => (v === null ? "∞" : String(v));
    const d = (a: number | null, b: number | null) => {
      const x = (a ?? Infinity) - (b ?? Infinity);
      return !Number.isFinite(x) ? "−∞/exact" : `${x >= 0 ? "+" : ""}${Math.round(x * 100) / 100}`;
    };
    md += `| ${f} | ${best.method} | ${fmt(best.psnr)} | ${fmt(uni.psnr)} | ${fmt(lrc.psnr)} | ${fmt(vr.psnr)} | ${d(lrc.psnr, uni.psnr)} | ${d(lrc.psnr, best.psnr)} |\n`;
  }
  md += `\n`;
}
md += `## Residual violations (DHx≈y failures, RMS levels)\n\n| fixture | scale | worst open-loop method | residual |\n|---|---|---|---|\n`;
for (const r of rows.filter((x) => !x.method.startsWith("ibp-") && x.residual > 0.5)) {
  md += `| ${r.fixture} | ${r.scale}x | ${r.method} | ${Math.round(r.residual * 100) / 100} |\n`;
}
writeFileSync(join(root, "baseline.md"), md);
console.log(`wrote ${rows.length} rows → ${root}`);
