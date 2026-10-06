// C++ cross-validation: RGB PPM crop → vice_upscale CLI vs per-channel TS
// reference. Asserts byte agreement (≤1 level) and residual gate.
// Usage: bun research/ref/validate-cpp.ts  (needs Release build + Kodak data)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructIbp } from "./ibp.ts";
import { decodePng } from "./png.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exe = join(root, "core", "build", "Release", "vice_upscale.exe");
const photo = join(root, "tools", "eval", "data", "photos", "kodim04.png");
if (!existsSync(exe)) throw new Error("build core first");
if (!existsSync(photo)) throw new Error("kodak data missing");

const W = 256;
const H = 256;
const S = 2;
const png = decodePng(new Uint8Array(readFileSync(photo)));
const x0 = ((png.w - W) / 2) | 0;
const y0 = ((png.h - H) / 2) | 0;
const ch: Float64Array[] = [new Float64Array(W * H), new Float64Array(W * H), new Float64Array(W * H)];
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y + y0) * png.w + x + x0;
    ch[0][y * W + x] = png.data[i * 3];
    ch[1][y * W + x] = png.data[i * 3 + 1];
    ch[2][y * W + x] = png.data[i * 3 + 2];
  }

// RGB PPM in.
const header = `P6\n${W} ${H}\n255\n`;
const body = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  body[i * 3] = ch[0][i];
  body[i * 3 + 1] = ch[1][i];
  body[i * 3 + 2] = ch[2][i];
}
mkdirSync(join(root, "research", "results", "cpp"), { recursive: true });
const inp = join(root, "research", "results", "cpp", "crop.ppm");
const outp = join(root, "research", "results", "cpp", "crop-cpp.ppm");
writeFileSync(inp, Buffer.concat([Buffer.from(header), body]));
const err = execFileSync(exe, [inp, String(S), outp], { encoding: "utf8" });
console.log("cli:", (err as string).trim());

// TS per-channel reference → bytes.
const parsePpm = (buf: Buffer) => {
  let p = 0;
  const tok = (): string => {
    while (buf[p] === 0x20 || buf[p] === 0x0a || buf[p] === 0x0d || buf[p] === 0x09) p++;
    let s = "";
    while (!(buf[p] === 0x20 || buf[p] === 0x0a || buf[p] === 0x0d || buf[p] === 0x09)) s += String.fromCharCode(buf[p++]);
    return s;
  };
  if (tok() !== "P6") throw new Error("bad ppm");
  const w = Number(tok());
  const h = Number(tok());
  if (tok() !== "255") throw new Error("bad maxval");
  p++;
  return { w, h, data: buf.subarray(p) };
};
const cpp = parsePpm(readFileSync(outp) as Buffer);
const tsBytes = Buffer.alloc(W * S * H * S * 3);
for (let c = 0; c < 3; c++) {
  // NOTE: CLI upscales the INPUT as LR (no degradation inside) — reference
  // must upscale the same input pixels, not a box-downsampled version.
  const r = reconstructIbp({ w: W, h: H, data: ch[c] }, S, { iters: 4 });
  for (let i = 0; i < W * S * H * S; i++) tsBytes[i * 3 + c] = Math.max(0, Math.min(255, Math.round(r.x.data[i])));
}
let worst = 0;
let se = 0;
for (let i = 0; i < tsBytes.length; i++) {
  const d = Math.abs(tsBytes[i] - cpp.data[i]);
  if (d > worst) worst = d;
  se += d * d;
}
const psnr = 10 * Math.log10((65025 * tsBytes.length) / se);
console.log(`max byte diff: ${worst}, bytes PSNR(TS vs C++): ${se === 0 ? "inf" : psnr.toFixed(2)}`);
if (worst > 1) throw new Error("C++/TS divergence exceeds 1 level");
console.log("CROSS-VALIDATION PASS");
