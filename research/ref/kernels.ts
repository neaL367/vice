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

// Whole-sample symmetric (mirror) extension: precondition for IBP is that
// border pixels upsample without clamp asymmetry (measured: clamp borders cost
// ~4 dB on gradient-ramp while interior matched init). i in (-n, 2n) suffices
// for all kernel radii used here.
function edgeIdx(i: number, n: number): number {
  if (i < 0) return -i;
  if (i >= n) return 2 * n - 2 - i;
  return i;
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
        acc += src[y * w + edgeIdx(ix, w)] * wt;
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
        acc += src[edgeIdx(iy, h) * w + x] * wt;
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

/**
 * Kernel decimation D (forward-model mismatch probe): proper resampling with
 * the kernel stretched by s in input pixels (MATLAB-imresize-style), NOT a
 * box average. Bicubic-D is the standard "unknown real degradation" stand-in:
 * our Π enforces box-consistency, which is the WRONG constraint under it.
 */
export function downsampleKernel(hr: GrayImage, s: number, name: KernelName): GrayImage {
  if (!Number.isInteger(s) || s < 2 || s > 4) throw new Error(`unsupported scale ${s}`);
  if (hr.w % s !== 0 || hr.h % s !== 0) throw new Error(`image ${hr.w}x${hr.h} not divisible by ${s}`);
  const r = KERNEL_RADIUS[name];
  const w = hr.w / s;
  const h = hr.h / s;
  const data = new Float64Array(w * h);
  const at = (x: number, y: number) =>
    hr.data[Math.min(hr.h - 1, Math.max(0, y)) * hr.w + Math.min(hr.w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const cx = (x + 0.5) * s - 0.5;
      const cy = (y + 0.5) * s - 0.5;
      let acc = 0;
      let wsum = 0;
      for (let iy = Math.floor(cy - r * s); iy <= Math.ceil(cy + r * s); iy++)
        for (let ix = Math.floor(cx - r * s); ix <= Math.ceil(cx + r * s); ix++) {
          const wt = kernelWeight(name, (cx - ix) / s) * kernelWeight(name, (cy - iy) / s);
          if (wt === 0) continue;
          acc += at(ix, iy) * wt;
          wsum += wt;
        }
      data[y * w + x] = wsum !== 0 ? acc / wsum : 0;
    }
  return { w, h, data };
}

export function constantImage(w: number, h: number, v: number): GrayImage {
  return { w, h, data: new Float64Array(w * h).fill(v) };
}

export interface SteerField {
  w: number; // LR grid dims (matches src)
  h: number;
  dirX: Float64Array; // unit gradient direction per LR pixel
  dirY: Float64Array;
  coh: Float64Array; // structure-tensor coherence in [0,1]
}

export interface SteerParams {
  strength: number; // 0 = isotropic lanczos2; 1 = full steering
  sharp: number; // |cos|^sharp along-tangent selectivity
}

/**
 * Directional residual upsampler (iter-8): lanczos2 footprint reshaped by
 * edge orientation. Tap weight = base · ((1−a·coh) + a·coh·|cos φ|^p), where
 * φ is the angle between tap offset and edge tangent (gradient ⊥). Along-edge
 * taps keep full weight; across-edge taps are suppressed where coherent.
 * Renormalized per HR pixel → preserves constants and block means like any
 * normalized kernel. coh=0 reproduces lanczos2 exactly.
 */
export function upsampleSteered(
  src: GrayImage,
  scale: number,
  field: SteerField,
  params: SteerParams,
): GrayImage {
  if (!Number.isInteger(scale) || scale < 2 || scale > 4) throw new Error(`unsupported scale ${scale}`);
  if (field.w !== src.w || field.h !== src.h) throw new Error("steer field size mismatch");
  const R = 2;
  const ow = src.w * scale;
  const oh = src.h * scale;
  const out = new Float64Array(ow * oh);
  const at = (x: number, y: number) => src.data[Math.min(src.h - 1, Math.max(0, y)) * src.w + Math.min(src.w - 1, Math.max(0, x))];
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      const cx = (ox + 0.5) / scale - 0.5;
      const cy = (oy + 0.5) / scale - 0.5;
      // Orientation at nearest LR pixel (residual fields vary slowly vs taps).
      const nx = Math.min(src.w - 1, Math.max(0, Math.round(cx)));
      const ny = Math.min(src.h - 1, Math.max(0, Math.round(cy)));
      const ni = ny * src.w + nx;
      const gx = field.dirX[ni];
      const gy = field.dirY[ni];
      const coh = Math.min(1, Math.max(0, field.coh[ni]));
      // Edge tangent = gradient rotated 90°.
      const tx = -gy;
      const ty = gx;
      let acc = 0;
      let wsum = 0;
      for (let iy = Math.floor(cy - R); iy <= Math.ceil(cy + R); iy++) {
        for (let ix = Math.floor(cx - R); ix <= Math.ceil(cx + R); ix++) {
          const dx = cx - ix;
          const dy = cy - iy;
          const base = kernelWeight("lanczos2", dx) * kernelWeight("lanczos2", dy);
          if (base === 0) continue;
          let gate = 1;
          const len = Math.hypot(dx, dy);
          if (len > 1e-9 && coh > 0) {
            const cos = Math.abs((dx * tx + dy * ty) / len); // tangent unit length
            gate = 1 - params.strength * coh + params.strength * coh * Math.pow(cos, params.sharp);
          }
          const w = base * gate;
          acc += at(ix, iy) * w;
          wsum += w;
        }
      }
      out[oy * ow + ox] = wsum !== 0 ? acc / wsum : 0;
    }
  }
  return { w: ow, h: oh, data: out };
}
