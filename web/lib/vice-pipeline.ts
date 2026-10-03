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

export function projectClamp(
  y: Float32Array,
  raw: Float32Array,
  w: number,
  h: number,
  s: number,
  c: number,
  rounds = 3,
): number {
  let residual = Infinity;
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

// Bilinear stand-in for ONNX predict(tile)->tile.
// Generic integer factor; model path uses factor 2 via the same shape.
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
