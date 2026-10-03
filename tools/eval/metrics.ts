// tools/eval: TS metrics mirror the C++ core (vice_metrics.h). Keep in sync:
// same Rec.709 luma, same 8x8 box-window SSIM, same seam definition.
export function psnr(a: Uint8ClampedArray, b: Uint8ClampedArray, max = 255): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let se = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    se += d * d;
  }
  const mse = se / a.length;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((max * max) / mse);
}

// Seam metric: gradient energy on block boundaries vs interiors; want ~1.
export function seamRatio(
  img: Float32Array,
  w: number,
  h: number,
  s: number,
  c = 1,
): number {
  let edge = 0;
  let inner = 0;
  let ne = 0;
  let ni = 0;
  const gx = (x: number, y: number, ch: number) =>
    Math.abs(img[(y * w + Math.min(w - 1, x + 1)) * c + ch] - img[(y * w + x) * c + ch]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w - 1; x++) {
      const onEdge = (x + 1) % s === 0;
      const g = gx(x, y, 0);
      if (onEdge) {
        edge += g;
        ne++;
      } else {
        inner += g;
        ni++;
      }
    }
  if (!ne || !ni) return 1;
  return edge / ne / (inner / ni || 1e-9);
}

function luma(p: Float32Array, o: number, c: number): number {
  const r = c > 0 ? p[o] : 0;
  const g = c > 1 ? p[o + 1] : r;
  const b = c > 2 ? p[o + 2] : g;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// SSIM on float [0,1] luma, 8x8 non-overlapping box windows. Mirrors C++.
export function ssim(a: Float32Array, b: Float32Array, w: number, h: number, c: number): number {
  if (a.length !== b.length || w < 8 || h < 8 || c <= 0) return -1;
  const C1 = 0.01 * 0.01;
  const C2 = 0.03 * 0.03;
  const W = 8;
  let sum = 0;
  let windows = 0;
  for (let y = 0; y + W <= h; y += W)
    for (let x = 0; x + W <= w; x += W) {
      let ma = 0;
      let mb = 0;
      for (let dy = 0; dy < W; dy++)
        for (let dx = 0; dx < W; dx++) {
          ma += luma(a, ((y + dy) * w + x + dx) * c, c);
          mb += luma(b, ((y + dy) * w + x + dx) * c, c);
        }
      ma /= W * W;
      mb /= W * W;
      let va = 0;
      let vb = 0;
      let cab = 0;
      for (let dy = 0; dy < W; dy++)
        for (let dx = 0; dx < W; dx++) {
          const da = luma(a, ((y + dy) * w + x + dx) * c, c) - ma;
          const db = luma(b, ((y + dy) * w + x + dx) * c, c) - mb;
          va += da * da;
          vb += db * db;
          cab += da * db;
        }
      va /= W * W;
      vb /= W * W;
      cab /= W * W;
      sum += ((2 * ma * mb + C1) * (2 * cab + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      windows++;
    }
  return windows ? sum / windows : -1;
}
