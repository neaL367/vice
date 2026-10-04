// Input image decoder: EXIF orientation, ICC profile, canvas buffer, linear color conversion.

import { BYTE_TO_LINEAR_LUT } from "../../../lib/pipeline/color";
import { extractIccProfile } from "../../../lib/icc";

export interface DecodedImage {
  width: number;
  height: number;
  icc: Uint8Array | null;
  hasAlpha: boolean;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  getPremultipliedLinear(): Float32Array;
  getLinearStrip(y0: number, rows: number): Float32Array;
  close(): void;
}

export function straightSrgbToPremultLinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Float32Array {
  const c = 4;
  const out = new Float32Array(w * h * c);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    for (let ch = 0; ch < 3; ch++) {
      out[i * c + ch] = BYTE_TO_LINEAR_LUT[data[i * 4 + ch]] * a;
    }
    out[i * c + 3] = a;
  }
  return out;
}

export async function decodeInputImage(
  file: File,
  signal?: AbortSignal,
): Promise<DecodedImage> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
    throw new Error("Environment lacks OffscreenCanvas / createImageBitmap.");
  }
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");

  const [fileBuf, bmp] = await Promise.all([
    file.arrayBuffer().catch(() => null),
    createImageBitmap(file, {
      colorSpaceConversion: "none",
      imageOrientation: "from-image",
    }),
  ]);
  if (signal?.aborted) {
    bmp.close();
    throw new DOMException("cancelled", "AbortError");
  }

  const icc = fileBuf ? await extractIccProfile(fileBuf).catch(() => null) : null;
  const w = bmp.width;
  const h = bmp.height;

  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) {
    bmp.close();
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  // Scan for alpha channel presence in chunks to avoid blowing memory
  let hasAlpha = false;
  for (let y0 = 0; y0 < h; y0 += 512) {
    const rows = Math.min(512, h - y0);
    const strip = ctx.getImageData(0, y0, w, rows);
    const d = strip.data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
    if (hasAlpha || signal?.aborted) break;
  }
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");

  let cachedLinear: Float32Array | null = null;

  return {
    width: w,
    height: h,
    icc,
    hasAlpha,
    getImageData(x: number, y: number, width: number, height: number): ImageData {
      return ctx.getImageData(x, y, width, height);
    },
    getPremultipliedLinear(): Float32Array {
      if (!cachedLinear) {
        const fullImg = ctx.getImageData(0, 0, w, h);
        cachedLinear = straightSrgbToPremultLinear(fullImg.data, w, h);
      }
      return cachedLinear;
    },
    getLinearStrip(y0: number, rows: number): Float32Array {
      const strip = ctx.getImageData(0, y0, w, rows);
      return straightSrgbToPremultLinear(strip.data, w, rows);
    },
    close() {
      cachedLinear = null;
    },
  };
}
