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
if (abi !== 4) throw new Error("ABI mismatch: " + abi);
console.log("abi=4 ok");

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

// Scale-4 now stages 2→4 internally (Stage-4 adoption): 4x4 RGB → 16x16.
{
  const W4 = 4, H4 = 4, S4 = 4;
  const in4 = new Uint8Array(W4 * H4 * 3);
  for (let y = 0; y < H4; y++)
    for (let x = 0; x < W4; x++) {
      const v = x < 2 ? 0 : 255;
      in4.set([v, v, v], (y * W4 + x) * 3);
    }
  const p4 = malloc(in4.length);
  HEAPU8.set(in4, p4);
  const o4len = W4 * S4 * H4 * S4 * 3;
  const q4 = malloc(o4len);
  const rc4 = ccall("vice_upscale", "number", [], [p4, W4, H4, 3, S4, q4]);
  if (rc4 !== 0) throw new Error("upscale 4x failed: " + rc4);
  const out4 = HEAPU8.slice(q4, q4 + o4len);
  const r4 = core._vice_last_residual();
  console.log("staged-4x residual=" + r4);
  if (!(r4 < 1e-5)) throw new Error("staged-4x residual gate failed");
  for (let by = 0; by < H4; by++)
    for (let bx = 0; bx < W4; bx++) {
      const src = in4[(by * W4 + bx) * 3];
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < S4; dy++)
          for (let dx = 0; dx < S4; dx++) sum += out4[((by * S4 + dy) * W4 * S4 + bx * S4 + dx) * 3 + c];
        if (sum !== S4 * S4 * src) throw new Error(`4x block sum violation at ${bx},${by} ch${c}`);
      }
    }
  console.log("staged 4x block sums exact ok");
  free(p4);
  free(q4);
}

// Burst: two identical 4x4 frames through the real export (pointer table in
// heap, NULL shifts = estimate internally). Identical frames fuse exactly.
{
  const Wb = 4, Hb = 4, Sb = 2;
  if (typeof core._vice_upscale_burst !== "function") throw new Error("missing export _vice_upscale_burst");
  const f0 = new Uint8Array(Wb * Hb * 3);
  for (let y = 0; y < Hb; y++)
    for (let x = 0; x < Wb; x++) {
      const v = x < 2 ? 0 : 255;
      f0.set([v, v, v], (y * Wb + x) * 3);
    }
  const p0 = malloc(f0.length);
  HEAPU8.set(f0, p0);
  const p1 = malloc(f0.length);
  HEAPU8.set(f0, p1);
  const ptab = malloc(8);
  new DataView(HEAPU8.buffer, ptab, 8).setUint32(0, p0, true);
  new DataView(HEAPU8.buffer, ptab, 8).setUint32(4, p1, true);
  const qo = malloc(Wb * Sb * Hb * Sb * 3);
  const rcb = core._vice_upscale_burst(ptab, 2, Wb, Hb, 3, Sb, qo, 0);
  if (rcb !== 0) throw new Error("burst failed: " + rcb);
  const ob = HEAPU8.slice(qo, qo + Wb * Sb * Hb * Sb * 3);
  const rb = core._vice_last_residual();
  console.log("burst residual=" + rb);
  if (!(rb < 1e-5)) throw new Error("burst residual gate failed");
  // Single-frame reference for agreement.
  const qs = malloc(Wb * Sb * Hb * Sb * 3);
  if (core._vice_upscale(p0, Wb, Hb, 3, Sb, qs) !== 0) throw new Error("single failed");
  const os = HEAPU8.slice(qs, qs + Wb * Sb * Hb * Sb * 3);
  let worst = 0;
  for (let i = 0; i < ob.length; i++) worst = Math.max(worst, Math.abs(ob[i] - os[i]));
  console.log("burst-vs-single max byte diff: " + worst);
  if (worst > 0) throw new Error("identical-frame burst must reproduce single-frame bytes");
  free(p0);
  free(p1);
  free(ptab);
  free(qo);
  free(qs);
  console.log("burst identical-frame agreement ok");
}
console.log("WASM SMOKE PASS");
