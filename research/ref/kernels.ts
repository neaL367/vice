// Reference fixed-kernel upsampler (clarity-first, float64).
// Separable 1D passes with clamped edges. Signal range: 0..255.
// Analytic kernel definitions; weights renormalized per output pixel
// (standard practice; preserves constants exactly for all kernels here).

export type KernelName = "nearest" | "bilinear" | "bicubic" | "mitchell" | "lanczos2" | "lanczos3";

export const KERNEL_RADIUS: Record<KernelName, number> = {
  nearest: 0.5,
  bilinear: 1,
  bicubic: 2,
  mitchell: 2,
  lanczos2: 2,
  lanczos3: 3,
};

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

export function kernelWeight(name: KernelName, x: number): number {
  const ax = Math.abs(x);
  switch (name) {
    case "nearest":
      return ax < 0.5 ? 1 : 0;
    case "bilinear":
      return ax < 1 ? 1 - ax : 0;
    case "bicubic": {
      // Catmull-Rom, a = -0.5
      const a = -0.5;
      if (ax < 1) return (a + 2) * ax ** 3 - (a + 3) * ax ** 2 + 1;
      if (ax < 2) return a * ax ** 3 - 5 * a * ax ** 2 + 8 * a * ax - 4 * a;
      return 0;
    }
    case "mitchell": {
      // Mitchell-Netravali B=1/3, C=1/3
      const B = 1 / 3;
      const C = 1 / 3;
      if (ax < 1) {
        return (
          ((12 - 9 * B - 6 * C) * ax ** 3 +
            (-18 + 12 * B + 6 * C) * ax ** 2 +
            (6 - 2 * B)) /
          6
        );
      }
      if (ax < 2) {
        return (
          ((-B - 6 * C) * ax ** 3 +
            (6 * B + 30 * C) * ax ** 2 +
            (-12 * B - 48 * C) * ax +
            (8 * B + 24 * C)) /
          6
        );
      }
      return 0;
    }
    case "lanczos2":
      return ax < 2 ? sinc(x) * sinc(x / 2) : 0;
    case "lanczos3":
      return ax < 3 ? sinc(x) * sinc(x / 3) : 0;
  }
}

function clampIdx(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

// One separable pass along rows (w direction). src: h×w, returns h×(w*s).
function passRows(src: Float64Array, w: number, h: number, s: number, name: KernelName): Float64Array {
  const r = KERNEL_RADIUS[name];
  const ow = w * s;
  const out = new Float64Array(ow * h);
  for (let y = 0; y < h; y++) {
    for (let ox = 0; ox < ow; ox++) {
      const c = (ox + 0.5) / s - 0.5; // src-space center
      const lo = Math.floor(c - r) + 1;
      const hi = Math.ceil(c + r) - 1;
      let acc = 0;
      let wsum = 0;
      for (let ix = lo; ix <= hi; ix++) {
        const wt = kernelWeight(name, c - ix);
        if (wt === 0) continue;
        acc += src[y * w + clampIdx(ix, w)] * wt;
        wsum += wt;
      }
      out[y * ow + ox] = wsum !== 0 ? acc / wsum : 0;
    }
  }
  return out;
}

// One separable pass along columns. src: h×w, returns (h*s)×w.
function passCols(src: Float64Array, w: number, h: number, s: number, name: KernelName): Float64Array {
  const r = KERNEL_RADIUS[name];
  const oh = h * s;
  const out = new Float64Array(w * oh);
  for (let oy = 0; oy < oh; oy++) {
    const c = (oy + 0.5) / s - 0.5;
    const lo = Math.floor(c - r) + 1;
    const hi = Math.ceil(c + r) - 1;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let wsum = 0;
      for (let iy = lo; iy <= hi; iy++) {
        const wt = kernelWeight(name, c - iy);
        if (wt === 0) continue;
        acc += src[clampIdx(iy, h) * w + x] * wt;
        wsum += wt;
      }
      out[oy * w + x] = wsum !== 0 ? acc / wsum : 0;
    }
  }
  return out;
}

export interface GrayImage {
  w: number;
  h: number;
  data: Float64Array; // row-major, 0..255
}

export function upsample(src: GrayImage, scale: number, name: KernelName): GrayImage {
  if (!Number.isInteger(scale) || scale < 2 || scale > 4) throw new Error(`unsupported scale ${scale}`);
  const horiz = passRows(src.data, src.w, src.h, scale, name);
  const full = passCols(horiz, src.w * scale, src.h, scale, name);
  return { w: src.w * scale, h: src.h * scale, data: full };
}

export function constantImage(w: number, h: number, v: number): GrayImage {
  return { w, h, data: new Float64Array(w * h).fill(v) };
}
