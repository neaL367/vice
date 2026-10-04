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

/**
 * Hierarchical 2-level multi-grid consistency solver.
 * Restricts residual error to coarse grid, prolongates coarse correction,
 * and post-smooths to eliminate low-frequency edge halos.
 */
export function projectMultiGrid(
  y: Float32Array,
  raw: Float32Array,
  w: number,
  h: number,
  s: number,
  c: number,
  cycles = 1,
): void {
  const W = w * s;
  const H = h * s;
  const inv = 1 / (s * s);

  for (let cyc = 0; cyc < cycles; cyc++) {
    const d0 = new Float32Array(w * h * c);
    for (let by = 0; by < h; by++) {
      for (let bx = 0; bx < w; bx++) {
        for (let ch = 0; ch < c; ch++) {
          let sum = 0;
          for (let dy = 0; dy < s; dy++) {
            for (let dx = 0; dx < s; dx++) {
              sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
            }
          }
          d0[(by * w + bx) * c + ch] = y[(by * w + bx) * c + ch] - sum * inv;
        }
      }
    }

    if (w >= 4 && h >= 4) {
      const cw = (w / 2) | 0;
      const ch = (h / 2) | 0;
      const d1 = new Float32Array(cw * ch * c);
      for (let cy = 0; cy < ch; cy++) {
        for (let cx = 0; cx < cw; cx++) {
          for (let ch_idx = 0; ch_idx < c; ch_idx++) {
            let blockSum = 0;
            for (let ry = 0; ry < 2; ry++) {
              for (let rx = 0; rx < 2; rx++) {
                const fy = cy * 2 + ry;
                const fx = cx * 2 + rx;
                blockSum += d0[(fy * w + fx) * c + ch_idx];
              }
            }
            d1[(cy * cw + cx) * c + ch_idx] = blockSum * 0.25;
          }
        }
      }

      const coarseScale = s * 2;
      for (let py = 0; py < H; py++) {
        const fcy = (py + 0.5) / coarseScale - 0.5;
        const cy0 = fcy < 0 ? -1 : Math.floor(fcy);
        const tcy = fcy - cy0;
        const cya = cy0 < 0 ? 0 : cy0 >= ch ? ch - 1 : cy0;
        const cyb = cy0 + 1 >= ch ? ch - 1 : cy0 + 1 < 0 ? 0 : cy0 + 1;

        for (let px = 0; px < W; px++) {
          const fcx = (px + 0.5) / coarseScale - 0.5;
          const cx0 = fcx < 0 ? -1 : Math.floor(fcx);
          const tcx = fcx - cx0;
          const cxa = cx0 < 0 ? 0 : cx0 >= cw ? cw - 1 : cx0;
          const cxb = cx0 + 1 >= cw ? cw - 1 : cx0 + 1 < 0 ? 0 : cx0 + 1;

          for (let ch_idx = 0; ch_idx < c; ch_idx++) {
            const a = d1[(cya * cw + cxa) * c + ch_idx];
            const b = d1[(cya * cw + cxb) * c + ch_idx];
            const cc = d1[(cyb * cw + cxa) * c + ch_idx];
            const e = d1[(cyb * cw + cxb) * c + ch_idx];
            const top = a + (b - a) * tcx;
            const bot = cc + (e - cc) * tcx;
            const corr = top + (bot - top) * tcy;
            raw[(py * W + px) * c + ch_idx] += corr * 0.85;
          }
        }
      }
    }

    projectSmooth(y, raw, w, h, s, c, 1);
  }

  projectBox(y, raw, w, h, s, c);
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
  useMultiGrid = true,
): number {
  let residual = Infinity;
  if (useMultiGrid) {
    projectMultiGrid(y, raw, w, h, s, c, 1);
  } else if (smoothIterations > 0) {
    projectSmooth(y, raw, w, h, s, c, smoothIterations);
  }
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
