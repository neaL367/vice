// Ticket 03: baseline benchmark — degrade → reconstruct → score.
// Usage: bun research/ref/bench.ts
// Writes research/results/baseline.json + baseline.md

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allFixtures } from "./adversarial.ts";
import { boxDownsample, forwardResidual } from "./forward.ts";
import { reconstructIbp } from "./ibp.ts";
import { upsample, type KernelName } from "./kernels.ts";
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
for (const f of allFixtures()) {
  for (const s of SCALES) {
    const lr = boxDownsample(f.hr, s);
    const methods: { name: string; run: () => { w: number; h: number; data: Float64Array } }[] = [
      ...KERNELS.map((k) => ({ name: k, run: () => upsample(lr, s, k) })),
      { name: "ibp-guarded", run: () => reconstructIbp(lr, s, { iters: 4 }).x },
    ];
    for (const m of methods) {
      const t0 = performance.now();
      const x = m.run();
      const ms = performance.now() - t0;
      const hr = { w: f.hr.w, h: f.hr.h, data: f.hr.data };
      const p = psnr(hr, x);
      rows.push({
        fixture: f.name,
        scale: s,
        method: m.name,
        psnr: Number.isFinite(p) ? Math.round(p * 100) / 100 : null,
        ssim: Math.round(ssimLite(hr, x) * 10000) / 10000,
        gradErr: Math.round(gradientError(hr, x) * 100) / 100,
        ringRange: Math.round(ringing(x).range * 100) / 100,
        residual: forwardResidual(x, lr, s),
        ms: Math.round(ms * 10) / 10,
      });
    }
  }
}

writeFileSync(join(root, "baseline.json"), JSON.stringify({ rows }, null, 1));

// Markdown: per-scale winner table (PSNR) + residual violations.
let md = `# Baseline benchmark (reference TS, box-D, guarded IBP T=4)\n\n`;
md += `Null-PSNR cells (checkerboard/nyquist at 2x/4x): every method scores ≈ identikit gray — expected, nullspace total.\n\n`;
for (const s of SCALES) {
  md += `## Scale ${s}x — PSNR (dB, higher better; null = ∞)\n\n| fixture | best fixed | dB | ibp-guarded | dB | ibp Δ |\n|---|---|---|---|---|---|\n`;
  const fx = [...new Set(rows.map((r) => r.fixture))];
  for (const f of fx) {
    const fixed = rows.filter((r) => r.fixture === f && r.scale === s && r.method !== "ibp-guarded");
    const ibp = rows.find((r) => r.fixture === f && r.scale === s && r.method === "ibp-guarded")!;
    const best = fixed.reduce((a, b) => ((a.psnr ?? Infinity) >= (b.psnr ?? Infinity) ? a : b));
    const bdb = best.psnr ?? Infinity;
    const idb = ibp.psnr ?? Infinity;
    const d = idb - bdb;
    const cell = (v: number | null) => (v === null ? "∞" : String(v));
    const dcell = !Number.isFinite(d) ? "−∞ (fixed exact)" : `${d >= 0 ? "+" : ""}${Math.round(d * 100) / 100}`;
    md += `| ${f} | ${best.method} | ${cell(best.psnr)} | ibp-guarded | ${cell(ibp.psnr)} | ${dcell} |\n`;
  }
  md += `\n`;
}
md += `## Residual violations (DHx≈y failures, RMS levels)\n\n| fixture | scale | worst open-loop method | residual |\n|---|---|---|---|\n`;
for (const r of rows.filter((x) => x.method !== "ibp-guarded" && x.residual > 0.5)) {
  md += `| ${r.fixture} | ${r.scale}x | ${r.method} | ${Math.round(r.residual * 100) / 100} |\n`;
}
writeFileSync(join(root, "baseline.md"), md);
console.log(`wrote ${rows.length} rows → ${root}`);
