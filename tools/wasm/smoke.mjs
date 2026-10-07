// WASM smoke test (node): ABI version, upscale step pattern, residual gate,
// integer-exact block sums. Run: node tools/wasm/smoke.mjs
import createCore from "../../web/public/wasm/core.js";

const core = await createCore();
const malloc = core._malloc;
const free = core._free;
const HEAPU8 = core.HEAPU8;
const ascii = (s) => {
  const bytes = [];
  for (const c of s) bytes.push(c.charCodeAt(0));
  return bytes;
};
const ccall = (name, ret, args, vals) => {
  const fn = core["_" + name];
  if (typeof fn !== "function") throw new Error("missing export _" + name);
  return fn(...vals);
};

const abi = ccall("vice_abi_version", "number", [], []);
if (abi !== 2) throw new Error("ABI mismatch: " + abi);
console.log("abi=2 ok");

// 8x8 RGBA step (left black, right white), 2x.
const W = 8, H = 8, S = 2;
const inp = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const v = x < 4 ? 0 : 255;
    inp.set([v, v, v, 255], (y * W + x) * 4);
  }
const pin = malloc(inp.length);
HEAPU8.set(inp, pin);
const outLen = W * S * H * S * 4;
const pout = malloc(outLen);
const rc = ccall("vice_upscale", "number", [], [pin, W, H, 4, S, pout]);
if (rc !== 0) throw new Error("upscale failed: " + rc);
const out = HEAPU8.slice(pout, pout + outLen);
const resid = core._vice_last_residual();
console.log("residual=" + resid);
if (!(resid < 1e-5)) throw new Error("residual gate failed");

// Integer-exact block sums on opaque content: every s×s block sums to s²×
// the source byte (exact-sum quantization in the core). Box-downscaling the
// output with any ordinary tool recovers the source pixel-for-pixel.
for (let by = 0; by < H; by++)
  for (let bx = 0; bx < W; bx++) {
    const src = inp[(by * W + bx) * 4];
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) sum += out[((by * S + dy) * W * S + bx * S + dx) * 4 + c];
      if (sum !== S * S * src) throw new Error(`block sum violation at ${bx},${by} ch${c}: ${sum} != ${S * S * src}`);
    }
  }
console.log("block sums exact ok");
free(pin);
free(pout);

// Progressive-8x through the new export: 4x4 RGB step → 32x32.
{
  const W8 = 4, H8 = 4, S8 = 8;
  const in8 = new Uint8Array(W8 * H8 * 3);
  for (let y = 0; y < H8; y++)
    for (let x = 0; x < W8; x++) {
      const v = x < 2 ? 0 : 255;
      in8.set([v, v, v], (y * W8 + x) * 3);
    }
  const p8 = malloc(in8.length);
  HEAPU8.set(in8, p8);
  const o8len = W8 * S8 * H8 * S8 * 3;
  const q8 = malloc(o8len);
  const rc8 = ccall("vice_upscale_progressive", "number", [], [p8, W8, H8, 3, S8, q8]);
  if (rc8 !== 0) throw new Error("progressive failed: " + rc8);
  const out8 = HEAPU8.slice(q8, q8 + o8len);
  const r8 = core._vice_last_residual();
  console.log("progressive residual=" + r8);
  if (!(r8 < 1e-5)) throw new Error("progressive residual gate failed");
  for (let by = 0; by < H8; by++)
    for (let bx = 0; bx < W8; bx++) {
      const src = in8[(by * W8 + bx) * 3];
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < S8; dy++)
          for (let dx = 0; dx < S8; dx++) sum += out8[((by * S8 + dy) * W8 * S8 + bx * S8 + dx) * 3 + c];
        if (sum !== S8 * S8 * src) throw new Error(`8x block sum violation at ${bx},${by} ch${c}`);
      }
    }
  console.log("progressive 8x block sums exact ok");
  free(p8);
  free(q8);
}
console.log("WASM SMOKE PASS");
