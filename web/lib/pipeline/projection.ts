/**
 * Vice Consistency Projection Engine.
 * Mirrors core/src/upscale.cpp.
 * Enforces exact box downscale identity and smooth residual convergence.
 */

export const SMOOTH_ITERS = 4;

// spec sec 3: out = U(y) + (r - U(A(r))). In-place on raw.
export function projectBox(
  y: Float32Array,
  raw: Float32Array,
  w: number,
  h: number,
  s: number,
  c: number,
): void {
  const W = w * s;
  const inv = 1 / (s * s);
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      for (let ch = 0; ch < c; ch++) {
        let sum = 0;
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++)
            sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
        const d = y[(by * w + bx) * c + ch] - sum * inv;
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++)
            raw[((by * s + dy) * W + bx * s + dx) * c + ch] += d;
      }
    }
  }
}

// Mirror of core vice_project_smooth: raw += bilinear(y - A(raw)), repeated.
export function projectSmooth(
  y: Float32Array,
  raw: Float32Array,
  w: number,
  h: number,
  s: number,
  c: number,
  iterations = SMOOTH_ITERS,
): void {
  const W = w * s;
  const inv = 1 / (s * s);
  const d = new Float32Array(w * h * c);
  for (let it = 0; it < iterations; it++) {
    for (let by = 0; by < h; by++)
      for (let bx = 0; bx < w; bx++)
        for (let ch = 0; ch < c; ch++) {
          let sum = 0;
          for (let dy = 0; dy < s; dy++)
            for (let dx = 0; dx < s; dx++)
              sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
          d[(by * w + bx) * c + ch] = y[(by * w + bx) * c + ch] - sum * inv;
        }
    for (let py = 0; py < h * s; py++) {
      const fy = (py + 0.5) / s - 0.5;
      const y0 = fy < 0 ? -1 : Math.floor(fy);
      const ty = fy - y0;
      const ya = y0 < 0 ? 0 : y0;
      const yb = Math.min(y0 + 1, h - 1);
      for (let px = 0; px < W; px++) {
        const fx = (px + 0.5) / s - 0.5;
        const x0 = fx < 0 ? -1 : Math.floor(fx);
        const tx = fx - x0;
        const xa = x0 < 0 ? 0 : x0;
        const xb = Math.min(x0 + 1, w - 1);
        const alpha = s === 2 ? 1.35 : 1.15;
        for (let ch = 0; ch < c; ch++) {
          const a = d[(ya * w + xa) * c + ch];
          const b = d[(ya * w + xb) * c + ch];
          const cc = d[(yb * w + xa) * c + ch];
          const e = d[(yb * w + xb) * c + ch];
          const top = a + (b - a) * tx;
          const bot = cc + (e - cc) * tx;
          raw[(py * W + px) * c + ch] += alpha * (top + (bot - top) * ty);
        }
      }
    }
  }
}

export function measureResidual(
  y: Float32Array,
  out: Float32Array,
  w: number,
  h: number,
  s: number,
  c: number,
): number {
  const W = w * s;
  const inv = 1 / (s * s);
  let worst = 0;
  for (let by = 0; by < h; by++)
    for (let bx = 0; bx < w; bx++)
      for (let ch = 0; ch < c; ch++) {
        let sum = 0;
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++)
            sum += out[((by * s + dy) * W + bx * s + dx) * c + ch];
        const e = Math.abs(sum * inv - y[(by * w + bx) * c + ch]);
        if (e > worst) worst = e;
      }
  return worst;
}

export function projectClamp(
  y: Float32Array,
  raw: Float32Array,
  w: number,
  h: number,
  s: number,
  c: number,
  rounds = 3,
  smoothIterations = SMOOTH_ITERS,
): number {
  let residual = Infinity;
  if (smoothIterations > 0) projectSmooth(y, raw, w, h, s, c, smoothIterations);
  for (let i = 0; i < rounds; i++) {
    projectBox(y, raw, w, h, s, c);
    let oob = false;
    for (let k = 0; k < raw.length; k++) {
      if (raw[k] < 0 || raw[k] > 1) {
        oob = true;
        raw[k] = raw[k] < 0 ? 0 : 1;
      }
    }
    residual = measureResidual(y, raw, w, h, s, c);
    if (!oob) break;
  }
  return residual;
}
