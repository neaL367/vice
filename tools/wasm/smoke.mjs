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
if (abi !== 1) throw new Error("ABI mismatch: " + abi);
console.log("abi=1 ok");

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
console.log("WASM SMOKE PASS");
