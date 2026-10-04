/**
 * Color space transformation utilities and fast lookup tables (LUT).
 * Linear-light premultiplied float <-> sRGB conversions.
 */

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
