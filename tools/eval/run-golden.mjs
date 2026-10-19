// Golden-image regression runner for Vice deterministic upscaler.
// Generates synthetic test images in JS (no file deps), upscales via WASM,
// computes PSNR via box-downsampling, and compares against baselines.json.
//
// Usage:
//   node tools/eval/run-golden.mjs           # run regression check
//   node tools/eval/run-golden.mjs --update  # regenerate baselines.json

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";

import createCore from "../../web/public/wasm/core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINES_PATH = join(__dirname, "baselines.json");
const UPDATE = process.argv.includes("--update");

// ---------------------------------------------------------------------------
// WASM bootstrap (mirrors smoke.mjs pattern exactly)
// ---------------------------------------------------------------------------
const core = await createCore();
const malloc = core._malloc;
const free = core._free;
const HEAPU8 = core.HEAPU8;

// ---------------------------------------------------------------------------
// Image generators (grayscale, ch=1)
// ---------------------------------------------------------------------------

/** Left half black (0), right half white (255). */
function makeStep(w, h) {
  const buf = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      buf[y * w + x] = x < w / 2 ? 0 : 255;
  return buf;
}

/** Horizontal linear ramp: pixel = clamp(x * 8, 0, 255). */
function makeGradient(w, h) {
  const buf = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      buf[y * w + x] = Math.min(x * 8, 255);
  return buf;
}

/** Uniform gray (128). */
function makeFlat(w, h) {
  const buf = new Uint8Array(w * h).fill(128);
  return buf;
}

/** Alternating 0/255 checkerboard at the pixel level. */
function makeCheckerboard(w, h) {
  const buf = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      buf[y * w + x] = (x + y) % 2 === 0 ? 0 : 255;
  return buf;
}

// ---------------------------------------------------------------------------
// WASM upscale helpers
// ---------------------------------------------------------------------------

/**
 * Call vice_upscale for scale ≤ 4 (or use vice_upscale_progressive for
 * larger). Returns the output as a Uint8Array.
 */
function upscale(input, w, h, ch, scale, progressive = false) {
  const pin = malloc(input.length);
  HEAPU8.set(input, pin);
  const outLen = w * scale * h * scale * ch;
  const pout = malloc(outLen);

  const exportName = progressive ? "_vice_upscale_progressive" : "_vice_upscale";
  const fn = core[exportName];
  if (typeof fn !== "function") throw new Error(`missing export ${exportName}`);

  const rc = fn(pin, w, h, ch, scale, pout);
  if (rc !== 0) throw new Error(`${exportName} failed: rc=${rc}`);

  const out = HEAPU8.slice(pout, pout + outLen);
  free(pin);
  free(pout);
  return out;
}

// ---------------------------------------------------------------------------
// PSNR via box-downsampling
// ---------------------------------------------------------------------------

/**
 * Box-downsample `data` (Uint8Array, width=w*s, height=h*s, ch channels)
 * back to w×h using s×s averaging. Returns Float64Array.
 */
function boxDownsample(data, w, h, s, ch) {
  const ow = w / s, oh = h / s;
  // data is the upscaled output: its actual dimensions are ow*s × oh*s = w × h
  // But the caller passes w=upscaled_width and h=upscaled_height, s=scale.
  // So ow and oh are the *original* dimensions.
  const out = new Float64Array(ow * oh * ch);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++)
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++)
            sum += data[((y * s + dy) * w + x * s + dx) * ch + c];
        out[(y * ow + x) * ch + c] = sum / (s * s);
      }
  return out;
}

/**
 * Compute PSNR between box-downsampled upscaled output and original input.
 * Returns Infinity when MSE === 0.
 *
 * @param {Uint8Array} upscaled   - upscaled pixel buffer (w*s × h*s × ch)
 * @param {Uint8Array} original   - original input (w × h × ch)
 * @param {number} w              - original width
 * @param {number} h              - original height
 * @param {number} scale          - upscale factor
 * @param {number} ch             - channels
 */
function computePSNR(upscaled, original, w, h, scale, ch) {
  const downsampled = boxDownsample(upscaled, w * scale, h * scale, scale, ch);
  let mse = 0;
  const n = w * h * ch;
  for (let i = 0; i < n; i++) {
    const diff = downsampled[i] - original[i];
    mse += diff * diff;
  }
  mse /= n;
  if (mse === 0) return Infinity;
  return 10 * Math.log10(255 * 255 / mse);
}

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------
const CASES = [
  {
    id: "step-2x",
    w: 32, h: 32, ch: 1, scale: 2,
    gen: () => makeStep(32, 32),
    progressive: false,
  },
  {
    id: "gradient-2x",
    w: 32, h: 32, ch: 1, scale: 2,
    gen: () => makeGradient(32, 32),
    progressive: false,
  },
  {
    id: "flat-2x",
    w: 32, h: 32, ch: 1, scale: 2,
    gen: () => makeFlat(32, 32),
    progressive: false,
  },
  {
    id: "step-4x",
    w: 16, h: 16, ch: 1, scale: 4,
    gen: () => makeStep(16, 16),
    progressive: false,
  },
  {
    id: "gradient-4x",
    w: 16, h: 16, ch: 1, scale: 4,
    gen: () => makeGradient(16, 16),
    progressive: false,
  },
  {
    id: "checkerboard-2x",
    w: 32, h: 32, ch: 1, scale: 2,
    gen: () => makeCheckerboard(32, 32),
    progressive: false,
  },
];

// ---------------------------------------------------------------------------
// Load existing baselines (if any)
// ---------------------------------------------------------------------------
let baselines = {};
if (!UPDATE && existsSync(BASELINES_PATH)) {
  const raw = JSON.parse(readFileSync(BASELINES_PATH, "utf8"));
  // Normalize psnr:"Infinity" strings back to JS Infinity
  for (const [id, v] of Object.entries(raw)) {
    baselines[id] = { ...v, psnr: v.psnr === "Infinity" ? Infinity : v.psnr };
  }
}

// ---------------------------------------------------------------------------
// Run all cases
// ---------------------------------------------------------------------------
const results = {};
let anyFail = false;

for (const tc of CASES) {
  const { id, w, h, ch, scale, gen, progressive } = tc;
  const input = gen();
  const output = upscale(input, w, h, ch, scale, progressive);
  const psnr = computePSNR(output, input, w, h, scale, ch);

  results[id] = { psnr, scale, w, h, ch };

  if (UPDATE) {
    const display = isFinite(psnr) ? psnr.toFixed(2) + " dB" : "Infinity";
    console.log(`  measured ${id}: psnr=${display}`);
    continue;
  }

  // Regression check
  const base = baselines[id];
  if (!base) {
    console.log(`SKIP ${id} (no baseline — run --update first)`);
    continue;
  }

  const baselinePsnr = base.psnr;

  // flat / Infinity handling
  if (!isFinite(psnr) && (!isFinite(baselinePsnr) || baselinePsnr === null)) {
    console.log(`PASS ${id} psnr=Infinity`);
    continue;
  }
  if (!isFinite(psnr) && isFinite(baselinePsnr)) {
    // Measured Infinity but baseline was finite → improvement → pass
    console.log(`PASS ${id} psnr=Infinity (baseline=${baselinePsnr.toFixed(2)})`);
    continue;
  }
  if (isFinite(psnr) && !isFinite(baselinePsnr)) {
    if (psnr < 100) {
      console.log(`FAIL ${id} psnr=${psnr.toFixed(2)} (baseline=Infinity, delta=${(psnr - 100).toFixed(2)})`);
      anyFail = true;
      continue;
    }
    console.log(`PASS ${id} psnr=${psnr.toFixed(2)} (baseline=Infinity)`);
    continue;
  }

  const delta = psnr - baselinePsnr;
  if (delta < -0.1) {
    console.log(`FAIL ${id} psnr=${psnr.toFixed(2)} (baseline=${baselinePsnr.toFixed(2)}, delta=${delta.toFixed(2)})`);
    anyFail = true;
  } else {
    console.log(`PASS ${id} psnr=${psnr.toFixed(2)}`);
  }
}

// ---------------------------------------------------------------------------
// Write baselines if --update
// ---------------------------------------------------------------------------
if (UPDATE) {
  // Serialize: store Infinity as the string "Infinity" for JSON compatibility
  const serializable = {};
  for (const [id, v] of Object.entries(results)) {
    serializable[id] = {
      psnr: isFinite(v.psnr) ? v.psnr : "Infinity",
      scale: v.scale,
      w: v.w,
      h: v.h,
      ch: v.ch,
    };
  }
  writeFileSync(BASELINES_PATH, JSON.stringify(serializable, null, 2) + "\n");
  console.log(`\nbaselines.json written to ${BASELINES_PATH}`);
  process.exit(0);
}

process.exit(anyFail ? 1 : 0);
