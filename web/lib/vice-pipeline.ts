// Shared Vice math: mirrors core/src/*.cpp. Keep in sync.
// Linear-light premultiplied float, interleaved RGBA or RGB.

export function srgbToLinear(v: number): number {
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  if (v <= 0.0031308) return v * 12.92;
  return 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// Precomputed 256-entry lookup table for byte (0-255) -> linear float.
// Eliminates Math.pow calls during canvas decode.
export const BYTE_TO_LINEAR_LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  BYTE_TO_LINEAR_LUT[i] = srgbToLinear(i / 255);
}

// 4096-entry lookup tables for ultra-fast float color conversion in tight tile blending loops.
// Eliminates tens of millions of Math.pow calls per image.
const COLOR_LUT_SIZE = 4096;
export const FAST_SRGB_TO_LINEAR_LUT = new Float32Array(COLOR_LUT_SIZE + 1);
export const FAST_LINEAR_TO_SRGB_LUT = new Float32Array(COLOR_LUT_SIZE + 1);
for (let i = 0; i <= COLOR_LUT_SIZE; i++) {
  const v = i / COLOR_LUT_SIZE;
  FAST_SRGB_TO_LINEAR_LUT[i] = srgbToLinear(v);
  FAST_LINEAR_TO_SRGB_LUT[i] = linearToSrgb(v);
}

export function fastSrgbToLinear(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return FAST_SRGB_TO_LINEAR_LUT[(v * COLOR_LUT_SIZE + 0.5) | 0];
}

export function fastLinearToSrgb(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return FAST_LINEAR_TO_SRGB_LUT[(v * COLOR_LUT_SIZE + 0.5) | 0];
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

export const SMOOTH_ITERS = 4;

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

export interface Tile {
  ix: number;
  iy: number;
  iw: number;
  ih: number;
}

export function planTiles(
  inW: number,
  inH: number,
  tile = 128,
  overlap = 16,
): Tile[] {
  // v1 emits disjoint tiles; overlap feeds the Hann overlap blend next.
  void overlap;
  const out: Tile[] = [];
  for (let y = 0; y < inH; y += tile)
    for (let x = 0; x < inW; x += tile)
      out.push({
        ix: x,
        iy: y,
        iw: Math.min(tile, inW - x),
        ih: Math.min(tile, inH - y),
      });
  return out;
}

// Reflect-101 index map for edge padding: -1->1, n->n-2, periodic 2*(n-1).
export function reflectIndex(x: number, n: number): number {
  if (n <= 1) return 0;
  const m = 2 * (n - 1);
  x = Math.abs(x) % m;
  return x >= n ? m - x : x;
}

export interface OverlapTile extends Tile {
  ox: number; // output origin (scale applied by caller)
  oy: number;
}

// Overlapping fixed-size tiles covering every pixel >= once. Edge tiles
// clamp to bounds; caller reflect-pads the overhang. Step T-O.
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

export function hannWeight(x: number, y: number, w: number, h: number): number {
  if (w <= 1 || h <= 1) return 1;
  const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (w - 1));
  const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (h - 1));
  return wx * wy;
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
): Float32Array {
  if (w <= tileSize && h <= tileSize) {
    return lanczosAdaptiveScale(src, w, h, c, scale);
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

    const tileOut = lanczosAdaptiveScale(tileIn, t.iw, t.ih, c, scale);
    const twOut = t.iw * scale;
    const thOut = t.ih * scale;
    const oxOut = t.ox * scale;
    const oyOut = t.oy * scale;

    for (let ty = 0; ty < thOut; ty++) {
      const gy = oyOut + ty;
      if (gy >= H) continue;
      const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * ty) / Math.max(1, thOut - 1));
      for (let tx = 0; tx < twOut; tx++) {
        const gx = oxOut + tx;
        if (gx >= W) continue;
        const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * tx) / Math.max(1, twOut - 1));
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

// Bilinear scale interpolation with generic integer factor.
export function bilinearScale(
  src: Float32Array,
  w: number,
  h: number,
  c: number,
  s: number,
): Float32Array {
  const W = w * s;
  const H = h * s;
  const dst = new Float32Array(W * H * c);
  for (let y = 0; y < H; y++) {
    const gy = y / s - 0.5;
    const y0 = Math.max(0, Math.min(h - 1, Math.floor(gy)));
    const y1 = Math.max(0, Math.min(h - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, gy - y0));
    for (let x = 0; x < W; x++) {
      const gx = x / s - 0.5;
      const x0 = Math.max(0, Math.min(w - 1, Math.floor(gx)));
      const x1 = Math.max(0, Math.min(w - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, gx - x0));
      for (let ch = 0; ch < c; ch++) {
        const a = src[(y0 * w + x0) * c + ch];
        const b = src[(y0 * w + x1) * c + ch];
        const d = src[(y1 * w + x0) * c + ch];
        const e = src[(y1 * w + x1) * c + ch];
        dst[(y * W + x) * c + ch] =
          a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
  }
  return dst;
}

export function bilinear2x(src: Float32Array, w: number, h: number, c: number): Float32Array {
  return bilinearScale(src, w, h, c, 2);
}

// ---------------------------------------------------------------------------
// Pure Mathematical Super-Resolution: Edge-Adaptive Lanczos-3
// ---------------------------------------------------------------------------

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczos3(x: number): number {
  const ax = Math.abs(x);
  if (ax === 0) return 1;
  if (ax >= 3) return 0;
  return sinc(ax) * sinc(ax / 3);
}

// Precomputed weights for fast 6-tap Lanczos-3 resampling
const LANCZOS_LUT_STEPS = 256;
const LANCZOS_WEIGHT_TABLE = new Float32Array(LANCZOS_LUT_STEPS * 6);
for (let s = 0; s < LANCZOS_LUT_STEPS; s++) {
  const frac = s / LANCZOS_LUT_STEPS;
  let sum = 0;
  for (let tap = -2; tap <= 3; tap++) {
    const w = lanczos3(frac - tap);
    LANCZOS_WEIGHT_TABLE[s * 6 + (tap + 2)] = w;
    sum += w;
  }
  const invSum = sum !== 0 ? 1 / sum : 1;
  for (let i = 0; i < 6; i++) {
    LANCZOS_WEIGHT_TABLE[s * 6 + i] *= invSum;
  }
}

/**
 * Fast spatial zero-mean triangular probability density function (TPDF) dither.
 * Breaks up 8-bit quantization banding in smooth gradients and shadows without noise artifacts.
 * Return value is in range [-0.5, 0.5] with mean 0.
 */
export function spatialTriangularDither(x: number, y: number, ch: number): number {
  let h = (x * 374761393 + y * 668265263 + ch * 91234567) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  const u1 = ((h & 0xffff) / 65535) - 0.5;
  const u2 = (((h >> 16) & 0xffff) / 65535) - 0.5;
  return (u1 + u2) * 0.5;
}

/**
 * High-Performance Separable Edge-Adaptive Lanczos-3 Resampling with Diagonal Steering.
 * - Interpolates in linear premultiplied float space.
 * - Multi-scale acutance restores fine micro-contrast on 4K+ sensors.
 * - Diagonal edge steering eliminates staircase stepping along oblique contours.
 * - Anti-ringing bounds clamp prevents sinc edge halos.
 */
export function lanczosAdaptiveScale(
  src: Float32Array,
  w: number,
  h: number,
  c: number,
  scale: number,
): Float32Array {
  const W = w * scale;
  const H = h * scale;

  // Pass 1: Horizontal scale (w x h -> W x h)
  const tmp = new Float32Array(W * h * c);
  for (let x = 0; x < W; x++) {
    const srcX = (x + 0.5) / scale - 0.5;
    const baseIdx = Math.floor(srcX);
    const frac = srcX - baseIdx;
    const lutIdx = Math.min(LANCZOS_LUT_STEPS - 1, Math.max(0, (frac * LANCZOS_LUT_STEPS) | 0));
    const lutOffset = lutIdx * 6;

    for (let y = 0; y < h; y++) {
      const rowSrc = y * w;
      const rowDst = y * W;

      for (let ch = 0; ch < c; ch++) {
        let val = 0;
        let min4 = Infinity;
        let max4 = -Infinity;

        // Central pixels for acutance curvature calculation
        const p0 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx))) * c + ch];
        const p1 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx + 1))) * c + ch];
        const pm1 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx - 1))) * c + ch];
        const p2 = src[(rowSrc + Math.max(0, Math.min(w - 1, baseIdx + 2))) * c + ch];

        for (let tap = -2; tap <= 3; tap++) {
          const sx = Math.max(0, Math.min(w - 1, baseIdx + tap));
          const pixel = src[(rowSrc + sx) * c + ch];
          val += pixel * LANCZOS_WEIGHT_TABLE[lutOffset + (tap + 2)];

          if (tap >= -1 && tap <= 2) {
            if (pixel < min4) min4 = pixel;
            if (pixel > max4) max4 = pixel;
          }
        }

        // Noise-gated multi-scale edge acutance: suppresses sensor/compression noise on smooth areas
        const localDelta = Math.abs(p1 - p0);
        const wideDelta = Math.abs(p2 - pm1);
        const edgeEnergy = Math.max(localDelta, 0.5 * wideDelta);
        const NOISE_FLOOR = 0.008;

        if (edgeEnergy > NOISE_FLOOR) {
          const linearCenter = p0 + frac * (p1 - p0);
          const wideCenter = 0.5 * (pm1 + p2);
          const curvature = linearCenter - wideCenter;
          const boost = 0.45 * Math.min(1, (edgeEnergy - NOISE_FLOOR) * 6);
          val += boost * curvature;
        }

        // True anti-ringing clamp bounded by the 4-tap local envelope
        tmp[(rowDst + x) * c + ch] = val < min4 ? min4 : val > max4 ? max4 : val;
      }
    }
  }

  // Pass 2: Vertical scale with Diagonal Edge Steering (W x h -> W x H)
  const dst = new Float32Array(W * H * c);
  const stepX = Math.max(1, Math.round(scale));

  for (let y = 0; y < H; y++) {
    const srcY = (y + 0.5) / scale - 0.5;
    const baseIdx = Math.floor(srcY);
    const frac = srcY - baseIdx;
    const lutIdx = Math.min(LANCZOS_LUT_STEPS - 1, Math.max(0, (frac * LANCZOS_LUT_STEPS) | 0));
    const lutOffset = lutIdx * 6;

    const rowDst = y * W;
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < c; ch++) {
        let val = 0;
        let min4 = Infinity;
        let max4 = -Infinity;

        const p0 = tmp[(Math.max(0, Math.min(h - 1, baseIdx)) * W + x) * c + ch];
        const p1 = tmp[(Math.max(0, Math.min(h - 1, baseIdx + 1)) * W + x) * c + ch];
        const pm1 = tmp[(Math.max(0, Math.min(h - 1, baseIdx - 1)) * W + x) * c + ch];
        const p2 = tmp[(Math.max(0, Math.min(h - 1, baseIdx + 2)) * W + x) * c + ch];

        for (let tap = -2; tap <= 3; tap++) {
          const sy = Math.max(0, Math.min(h - 1, baseIdx + tap));
          const pixel = tmp[(sy * W + x) * c + ch];
          val += pixel * LANCZOS_WEIGHT_TABLE[lutOffset + (tap + 2)];

          if (tap >= -1 && tap <= 2) {
            if (pixel < min4) min4 = pixel;
            if (pixel > max4) max4 = pixel;
          }
        }

        // Noise-gated vertical edge acutance
        const localDelta = Math.abs(p1 - p0);
        const wideDelta = Math.abs(p2 - pm1);
        const edgeEnergy = Math.max(localDelta, 0.5 * wideDelta);
        const NOISE_FLOOR = 0.008;

        if (edgeEnergy > NOISE_FLOOR) {
          const linearCenter = p0 + frac * (p1 - p0);
          const wideCenter = 0.5 * (pm1 + p2);
          const curvature = linearCenter - wideCenter;
          const boost = 0.45 * Math.min(1, (edgeEnergy - NOISE_FLOOR) * 6);
          val += boost * curvature;
        }

        // Diagonal Edge Steering: evaluate 45° vs 135° cross gradients
        const xL = Math.max(0, x - stepX);
        const xR = Math.min(W - 1, x + stepX);
        const yTop = Math.max(0, Math.min(h - 1, baseIdx));
        const yBot = Math.max(0, Math.min(h - 1, baseIdx + 1));

        const tl = tmp[(yTop * W + xL) * c + ch];
        const tr = tmp[(yTop * W + xR) * c + ch];
        const bl = tmp[(yBot * W + xL) * c + ch];
        const br = tmp[(yBot * W + xR) * c + ch];

        const d45 = Math.abs(tr - bl);
        const d135 = Math.abs(tl - br);
        const diff = d135 - d45;
        const total = d135 + d45 + 1e-4;

        if (Math.abs(diff) / total > 0.15) {
          // If d135 > d45, edge is at 45° -> average along tr-bl
          // If d45 > d135, edge is at 135° -> average along tl-br
          const diagAvg = diff > 0 ? 0.5 * (tr + bl) : 0.5 * (tl + br);
          const steerWeight = 0.2 * Math.min(1, Math.abs(diff) / total);
          val = (1 - steerWeight) * val + steerWeight * diagAvg;
        }

        // True anti-ringing clamp bounded by the 4-tap local envelope
        dst[(rowDst + x) * c + ch] = val < min4 ? min4 : val > max4 ? max4 : val;
      }
    }
  }

  return dst;
}
