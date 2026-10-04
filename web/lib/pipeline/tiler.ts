/**
 * Overlap-Add Tiling Planner & Orchestrator.
 * Partitions large images into manageable overlapping tiles with Hann-window blending.
 */

import { lanczosAdaptiveScale, type LanczosAdaptiveOptions } from "./kernels";

export interface Tile {
  ix: number;
  iy: number;
  iw: number;
  ih: number;
}

export interface OverlapTile extends Tile {
  ox: number; // output origin (scale applied by caller)
  oy: number;
}

// Precomputed 1D separable Hann window.
// Combining hannX[x] * hannY[y] avoids millions of 2D Math.cos calls per tile.
export function createHann1D(length: number): Float32Array {
  const lut = new Float32Array(length);
  if (length <= 1) {
    lut.fill(1);
    return lut;
  }
  const factor = (2 * Math.PI) / (length - 1);
  for (let i = 0; i < length; i++) {
    lut[i] = 0.5 - 0.5 * Math.cos(factor * i);
  }
  return lut;
}

const HANN_1D_CACHE = new Map<number, Float32Array>();

export function getHann1D(length: number): Float32Array {
  let lut = HANN_1D_CACHE.get(length);
  if (!lut) {
    lut = createHann1D(length);
    HANN_1D_CACHE.set(length, lut);
  }
  return lut;
}

export function hannWeight(x: number, y: number, w: number, h: number): number {
  if (w <= 1 || h <= 1) return 1;
  const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (w - 1));
  const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (h - 1));
  return wx * wy;
}

// Reflect-101 index map for edge padding: -1->1, n->n-2, periodic 2*(n-1).
export function reflectIndex(x: number, n: number): number {
  if (n <= 1) return 0;
  const m = 2 * (n - 1);
  x = Math.abs(x) % m;
  return x >= n ? m - x : x;
}

// Prototype overlap-add tiling, wired into the worker TS fallback for large
// outputs (>4 MP). The WASM streaming strip path covers large outputs
// natively; see lib/limits.ts for caps.
export function planOverlap(inW: number, inH: number, t: number, o: number): OverlapTile[] {
  const step = Math.max(1, t - o);
  const xs: number[] = [];
  for (let x = 0; x + t < inW; x += step) xs.push(x);
  xs.push(Math.max(0, inW - t));
  const ys: number[] = [];
  for (let y = 0; y + t < inH; y += step) ys.push(y);
  ys.push(Math.max(0, inH - t));
  const out: OverlapTile[] = [];
  for (const y of [...new Set(ys)])
    for (const x of [...new Set(xs)])
      out.push({ ix: x, iy: y, iw: t, ih: t, ox: x, oy: y });
  return out;
}

/**
 * Tiled Lanczos-3 adaptive upscale with Hann-window overlap blending.
 * Divides large images into overlapping tiles to manage memory,
 * blending seams seamlessly before consistency projection.
 */
export function tiledUpscaleLanczos(
  src: Float32Array,
  w: number,
  h: number,
  c: number,
  scale: number,
  tileSize = 128,
  overlap = 16,
  options?: LanczosAdaptiveOptions,
): Float32Array {
  if (w <= tileSize && h <= tileSize) {
    return lanczosAdaptiveScale(src, w, h, c, scale, options);
  }

  const W = w * scale;
  const H = h * scale;
  const accum = new Float32Array(W * H * c);
  const weights = new Float32Array(W * H);
  const tiles = planOverlap(
    w,
    h,
    Math.min(tileSize, w),
    Math.min(overlap, Math.floor(Math.min(tileSize, w) / 4)),
  );

  for (const t of tiles) {
    const tileIn = new Float32Array(t.iw * t.ih * c);
    for (let ty = 0; ty < t.ih; ty++) {
      const sy = reflectIndex(t.iy + ty, h);
      for (let tx = 0; tx < t.iw; tx++) {
        const sx = reflectIndex(t.ix + tx, w);
        for (let ch = 0; ch < c; ch++) {
          tileIn[(ty * t.iw + tx) * c + ch] = src[(sy * w + sx) * c + ch];
        }
      }
    }

    const tileOut = lanczosAdaptiveScale(tileIn, t.iw, t.ih, c, scale, options);
    const twOut = t.iw * scale;
    const thOut = t.ih * scale;
    const oxOut = t.ox * scale;
    const oyOut = t.oy * scale;

    // Use fast 1D Hann window slices
    const hannX = getHann1D(twOut);
    const hannY = getHann1D(thOut);

    for (let ty = 0; ty < thOut; ty++) {
      const gy = oyOut + ty;
      if (gy >= H) continue;
      const wy = hannY[ty];
      for (let tx = 0; tx < twOut; tx++) {
        const gx = oxOut + tx;
        if (gx >= W) continue;
        const wx = hannX[tx];
        const wt = Math.max(1e-4, wx * wy);
        const idx = gy * W + gx;
        weights[idx] += wt;
        for (let ch = 0; ch < c; ch++) {
          accum[idx * c + ch] += tileOut[(ty * twOut + tx) * c + ch] * wt;
        }
      }
    }
  }

  for (let i = 0; i < W * H; i++) {
    const invW = weights[i] > 0 ? 1 / weights[i] : 1;
    for (let ch = 0; ch < c; ch++) {
      accum[i * c + ch] *= invW;
    }
  }

  return accum;
}
