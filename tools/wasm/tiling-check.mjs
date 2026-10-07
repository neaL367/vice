// Tiling agreement probe (node): independent reimplementation of the web
// engine's halo tiling over core.js. 600x600 step crop → whole vice_upscale
// vs 4 overlapping tiles (512 cells, 16 halo) through vice_upscale_ranged
// with the global clamp range. Gate (same envelope as cross-validation):
// max byte diff ≤ 2, PSNR ≥ 50. Run: node tools/wasm/tiling-check.mjs
import createCore from "../../web/public/wasm/core.js";

const core = await createCore();
const W = 600, H = 600, S = 2, TILE = 512, HALO = 16;
const inp = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const v = x < W / 2 ? 0 : 255;
    inp.set([v, v, v, 255], (y * W + x) * 4);
  }

const run = (fn) => {
  const r = fn();
  if (r !== 0) throw new Error("rc=" + r);
};

// Whole image.
const pin = core._malloc(inp.length);
core.HEAPU8.set(inp, pin);
const pwhole = core._malloc(W * S * H * S * 4);
run(() => core._vice_upscale(pin, W, H, 4, S, pwhole));
const whole = core.HEAPU8.slice(pwhole, pwhole + W * S * H * S * 4);
core._free(pin);
core._free(pwhole);

// Global clamp ranges per channel.
const ranges = new Float64Array(8);
for (let c = 0; c < 4; c++) {
  let lo = 255, hi = 0;
  for (let i = c; i < inp.length; i += 4) {
    if (inp[i] < lo) lo = inp[i];
    if (inp[i] > hi) hi = inp[i];
  }
  ranges[c * 2] = lo;
  ranges[c * 2 + 1] = hi;
}

// Tiles.
const OW = W * S;
const stitched = new Uint8Array(W * S * H * S * 4);
const bounds = [0];
for (let x = 0; x < W; x += TILE) bounds.push(x);
bounds.push(W);
for (let cy = 0; cy < bounds.length - 1; cy++)
  for (let cx = 0; cx < bounds.length - 1; cx++) {
    const vx0 = bounds[cx], vy0 = bounds[cy], vx1 = bounds[cx + 1], vy1 = bounds[cy + 1];
    const px0 = Math.max(0, vx0 - HALO), py0 = Math.max(0, vy0 - HALO);
    const px1 = Math.min(W, vx1 + HALO), py1 = Math.min(H, vy1 + HALO);
    const pw = px1 - px0, ph = py1 - py0;
    const tile = new Uint8Array(pw * ph * 4);
    for (let y = 0; y < ph; y++)
      tile.set(inp.subarray(((py0 + y) * W + px0) * 4, ((py0 + y) * W + px1) * 4), y * pw * 4);
    const pti = core._malloc(tile.length);
    core.HEAPU8.set(tile, pti);
    const pto = core._malloc(pw * S * ph * S * 4);
    const pr = core._malloc(64);
    const view = new DataView(core.HEAPU8.buffer, pr, 64);
    for (let i = 0; i < 8; i++) view.setFloat64(i * 8, ranges[i], true);
    run(() => core._vice_upscale_ranged(pti, pw, ph, 4, S, pto, pr));
    const tb = core.HEAPU8.slice(pto, pto + pw * S * ph * S * 4);
    core._free(pti);
    core._free(pto);
    core._free(pr);
  const sx = (vx0 - px0) * S;
  for (let y = vy0; y < vy1; y++)
    for (let dy = 0; dy < S; dy++) {
      const sy = (y - py0) * S + dy;
      const len = (vx1 - vx0) * S * 4;
      stitched.set(
        tb.subarray((sy * pw * S + sx) * 4, (sy * pw * S + sx) * 4 + len),
        ((y * S + dy) * OW + vx0 * S) * 4,
      );
    }
  }

let worst = 0, se = 0;
for (let i = 0; i < whole.length; i++) {
  const d = Math.abs(whole[i] - stitched[i]);
  if (d > worst) worst = d;
  se += d * d;
}
console.log(`tiled-vs-whole max byte diff: ${worst}, PSNR: ${se === 0 ? "inf" : psnr.toFixed(2)}`);
if (worst > 2 || (se !== 0 && psnr < 50)) throw new Error("tiling agreement exceeds envelope");
console.log("TILING AGREEMENT PASS");
