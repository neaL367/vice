// Bundled at test time (bun build) and served via page.route; never shipped.
// Runs the REAL WebGPU pipeline plus the TS reference mirror in-page so the
// matrix below compares actual pixels. Skipped entirely when no adapter.
import { isWebGPUSupported } from "../../lib/webgpu/webgpu-support";
import { runWebGPUUpscale } from "../../lib/webgpu/webgpu-upscaler";
import { lanczosAdaptiveScale } from "../../lib/pipeline/kernels";
import { projectClamp } from "../../lib/pipeline/projection";
import {
  BYTE_TO_LINEAR_LUT,
  fastLinearToSrgb,
} from "../../lib/pipeline/color";

export interface WebGPUCaseResult {
  outW: number;
  outH: number;
  residual: number;
  leftMean: number;
  rightMean: number;
  alphaOk: boolean;
  refMeanAbsDiff: number;
}

async function fixture(
  kind: "halves-bw" | "halves-alpha",
): Promise<{ bmp: ImageBitmap; bytes: Uint8ClampedArray }> {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const x = c.getContext("2d")!;
  if (kind === "halves-bw") {
    x.fillStyle = "#000000";
    x.fillRect(0, 0, 4, 8);
    x.fillStyle = "#ffffff";
    x.fillRect(4, 0, 4, 8);
  } else {
    x.clearRect(0, 0, 8, 8);
    x.fillStyle = "#c02020";
    x.fillRect(0, 0, 4, 8);
  }
  const bmp = await createImageBitmap(c);
  const d = x.getImageData(0, 0, 8, 8);
  return { bmp, bytes: d.data };
}

function linearize(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = BYTE_TO_LINEAR_LUT[data[i * 4 + ch]] * a;
    out[i * 4 + 3] = a;
  }
  return out;
}

async function decode(blob: Blob): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  bmp.close();
  return { w: cv.width, h: cv.height, data: d.data };
}

async function runCase(
  kind: "halves-bw" | "halves-alpha",
): Promise<WebGPUCaseResult> {
  const { bmp, bytes } = await fixture(kind);
  const gpu = await runWebGPUUpscale(bmp, 2, {
    dering: 1.0,
    sharpness: 0.35,
    shock: 0.35,
  });
  bmp.close();
  if (!gpu) throw new Error("webgpu pipeline returned null (over limits?)");
  const out = await decode(await gpu.blob);

  // TS reference mirror on the same input (lanczos + full projectClamp).
  const lin = linearize(bytes, 8, 8);
  const ref = lanczosAdaptiveScale(lin, 8, 8, 4, 2, {
    dering: 1.0,
    sharpness: 0.35,
    shock: 0.35,
  });
  projectClamp(lin, ref, 8, 8, 2, 4);

  let left = 0;
  let right = 0;
  let diff = 0;
  let alphaOk = true;
  for (let y = 0; y < out.h; y++) {
    for (let xx = 0; xx < out.w; xx++) {
      const i = y * out.w + xx;
      const r = out.data[i * 4] / 255;
      const a = out.data[i * 4 + 3];
      if (xx < 4) left += r;
      else if (xx >= 12) right += r;
      if (kind === "halves-alpha") {
        if (xx < 6 && a !== 255) alphaOk = false;
        if (xx > 9 && a !== 0) alphaOk = false;
      } else if (a !== 255) {
        alphaOk = false;
      }
      for (let ch = 0; ch < 3; ch++) {
        const got = out.data[i * 4 + ch] / 255;
        const want = fastLinearToSrgb(Math.max(0, Math.min(1, ref[i * 4 + ch])));
        diff += Math.abs(got - want);
      }
    }
  }
  const n = out.w * out.h;
  return {
    outW: out.w,
    outH: out.h,
    residual: gpu.residual,
    leftMean: left / (4 * out.h),
    rightMean: right / (4 * out.h),
    alphaOk,
    refMeanAbsDiff: diff / (n * 3),
  };
}

export async function runMatrix(): Promise<Record<string, WebGPUCaseResult>> {
  return {
    bw: await runCase("halves-bw"),
    alpha: await runCase("halves-alpha"),
  };
}

(window as unknown as { __webgpuProbe: object }).__webgpuProbe = {
  isSupported: isWebGPUSupported,
  runMatrix,
};
