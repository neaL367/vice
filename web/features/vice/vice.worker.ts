// vice.worker.ts — owns decode, upscale, projection, PNG encode.
// Pure Mathematical Super-Resolution: Edge-Adaptive Lanczos-3 with exact box-projection.
// Fully private client-side execution, zero network downloads, zero model overhead.

import {
  BYTE_TO_LINEAR_LUT,
  fastLinearToSrgb,
  spatialTriangularDither,
} from "../../lib/pipeline/color";
import { lanczosAdaptiveScale, type LanczosAdaptiveOptions } from "../../lib/pipeline/kernels";
import { tiledUpscaleLanczos } from "../../lib/pipeline/tiler";
import { projectClamp } from "../../lib/pipeline/projection";
import { maxOutputPixels } from "../../lib/limits";
import { ViceCore } from "../../lib/vice-wasm";
import { extractIccProfile } from "../../lib/icc";
import type {
  ViceIncoming,
  ViceOutgoing,
  ViceProgress,
  ViceResultMeta,
  ViceRunOptions,
  ViceScale,
} from "./types/vice";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
}

function straightSrgbToPremultLinear(
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

let coreCache: { key: string; promise: Promise<ViceCore | null> } | null = null;

function ensureCore(base: string): Promise<ViceCore | null> {
  if (!coreCache || coreCache.key !== base)
    coreCache = { key: base, promise: ViceCore.load(base).catch(() => null) };
  return coreCache.promise;
}

export async function runViceUpscale(
  file: File,
  scale: ViceScale,
  onProgress: (p: ViceProgress) => void,
  opts: ViceRunOptions = {},
): Promise<{ blob: Blob; meta: ViceResultMeta }> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined")
    throw new Error("Browser lacks OffscreenCanvas / createImageBitmap.");
  throwIfAborted(opts.signal);

  // Auto-correct smartphone EXIF camera orientation (from-image) & extract ICC profile
  const [fileBuf, bmp] = await Promise.all([
    file.arrayBuffer().catch(() => null),
    createImageBitmap(file, {
      colorSpaceConversion: "none",
      imageOrientation: "from-image",
    }),
  ]);
  const icc = fileBuf ? await extractIccProfile(fileBuf).catch(() => null) : null;

  const outPx = bmp.width * bmp.height * scale * scale;
  const capPx = maxOutputPixels();
  if (outPx > capPx) {
    const mp = (outPx / 1_000_000).toFixed(1);
    const capMp = (capPx / 1_000_000).toFixed(0);
    bmp.close();
    throw new Error(
      `Output ${mp} MP exceeds this device's ${capMp} MP limit. Use a smaller image or scale.`,
    );
  }

  const backend = "Lanczos-3";
  onProgress({ band: 1, totalBands: 3, stage: "Upscaling…", backend });

  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) {
    bmp.close();
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const lin = straightSrgbToPremultLinear(img.data, cv.width, cv.height);
  const w = cv.width;
  const h = cv.height;
  throwIfAborted(opts.signal);

  const W = w * scale;
  const H = h * scale;

  // 1. Native C++ WebAssembly engine: ultra-fast in-memory Lanczos-3 with diagonal steering
  const core = opts.base ? await ensureCore(opts.base) : null;
  if (core && core.hasNativeUpscale()) {
    if (scale === 4 && opts.chained4x) {
      // Chained 2x twice per spec section 3: box4 = box2 o box2
      onProgress({ band: 1, totalBands: 4, stage: "Pass 1 (2×)…", backend });
      throwIfAborted(opts.signal);
      const cctx1 = core.create(w, h, 2, 4);
      let mid: Float32Array;
      try {
        core.setInput(cctx1, lin);
        core.upscale(cctx1, {
          preset: opts.preset,
          dering: opts.dering,
          sharpness: opts.sharpness,
          shock: opts.shock,
        });
        core.project(cctx1);
        mid = core.downloadRaw(cctx1, w * 2 * h * 2 * 4);
      } finally {
        core.destroy(cctx1);
      }
      throwIfAborted(opts.signal);

      onProgress({ band: 2, totalBands: 4, stage: "Pass 2 (2×)…", backend });
      const cctx2 = core.create(w * 2, h * 2, 2, 4);
      try {
        core.setInput(cctx2, mid);
        core.upscale(cctx2, {
          preset: opts.preset,
          dering: opts.dering,
          sharpness: opts.sharpness,
          shock: opts.shock,
        });
        onProgress({ band: 3, totalBands: 4, stage: "Projecting…", backend });
        throwIfAborted(opts.signal);
        core.project(cctx2);
        const residual = core.lastResidual(cctx2);
        if (icc) core.setIccProfile(cctx2, icc);
        onProgress({ band: 4, totalBands: 4, stage: "Encoding…", backend });
        let blob: Blob;
        try {
          const png = core.finishPng(cctx2, W, H, 4);
          blob = new Blob([png as unknown as BlobPart], { type: "image/png" });
        } catch (encodeErr) {
          console.warn("[Vice] Native PNG encode failed, falling back to canvas:", encodeErr);
          const rawBuf = core.downloadRaw(cctx2, W * H * 4);
          blob = await encodeCanvasPng(rawBuf, W, H);
        }
        onProgress({ band: 4, totalBands: 4, stage: "done", backend });
        return {
          blob,
          meta: {
            residual,
            backend,
            outW: W,
            outH: H,
            hasIcc: !!icc,
            chained4x: true,
            preset: opts.preset,
            dering: opts.dering,
            sharpness: opts.sharpness,
            shock: opts.shock,
          },
        };
      } finally {
        core.destroy(cctx2);
      }
    }

    onProgress({ band: 1, totalBands: 3, stage: "Upscaling…", backend });
    throwIfAborted(opts.signal);
    const cctx = core.create(w, h, scale, 4);
    try {
      core.setInput(cctx, lin);
      core.upscale(cctx, {
        preset: opts.preset,
        dering: opts.dering,
        sharpness: opts.sharpness,
        shock: opts.shock,
      });
      onProgress({ band: 2, totalBands: 3, stage: "Projecting…", backend });
      throwIfAborted(opts.signal);
      core.project(cctx);
      const residual = core.lastResidual(cctx);
      if (icc) core.setIccProfile(cctx, icc);
      onProgress({ band: 3, totalBands: 3, stage: "Encoding…", backend });
      throwIfAborted(opts.signal);
      let blob: Blob;
      try {
        const png = core.finishPng(cctx, W, H, 4);
        blob = new Blob([png as unknown as BlobPart], { type: "image/png" });
      } catch (encodeErr) {
        console.warn("[Vice] Native PNG encode failed, falling back to canvas:", encodeErr);
        const rawBuf = core.downloadRaw(cctx, W * H * 4);
        blob = await encodeCanvasPng(rawBuf, W, H);
      }
      onProgress({ band: 3, totalBands: 3, stage: "done", backend });
      return {
        blob,
        meta: {
          residual,
          backend,
          outW: W,
          outH: H,
          hasIcc: !!icc,
          chained4x: false,
          preset: opts.preset,
          dering: opts.dering,
          sharpness: opts.sharpness,
          shock: opts.shock,
        },
      };
    } finally {
      core.destroy(cctx);
    }
  }

  // 2. Pure Mathematical Super-Resolution TypeScript fallback:
  // Separable Edge-Adaptive Lanczos-3 with Diagonal Steering and Noise-Gated Acutance.
  // Large outputs go through the tiled overlap-add path to bound peak memory.
  const upscaleTS = (
    src: Float32Array,
    w: number,
    h: number,
    c: number,
    s: number,
    options: LanczosAdaptiveOptions,
  ): Float32Array => {
    if (w * s * h * s > 4_000_000) {
      return tiledUpscaleLanczos(src, w, h, c, s, 256, 32, options);
    }
    return lanczosAdaptiveScale(src, w, h, c, s, options);
  };
  let raw: Float32Array;
  let residual: number;
  if (scale === 4 && opts.chained4x) {
    const mid = upscaleTS(lin, w, h, 4, 2, {
      preset: opts.preset,
      dering: opts.dering,
      sharpness: opts.sharpness,
      shock: opts.shock,
    });
    projectClamp(lin, mid, w, h, 2, 4, 3);
    raw = upscaleTS(mid, w * 2, h * 2, 4, 2, {
      preset: opts.preset,
      dering: opts.dering,
      sharpness: opts.sharpness,
      shock: opts.shock,
    });
    residual = projectClamp(mid, raw, w * 2, h * 2, 2, 4, 3);
  } else {
    raw = upscaleTS(lin, w, h, 4, scale, {
      preset: opts.preset,
      dering: opts.dering,
      sharpness: opts.sharpness,
      shock: opts.shock,
    });
    residual = projectClamp(lin, raw, w, h, scale, 4, 3);
  }
  throwIfAborted(opts.signal);

  onProgress({ band: 2, totalBands: 2, stage: "Encoding…", backend });

  const blob = await encodeCanvasPng(raw, W, H);
  onProgress({ band: 2, totalBands: 2, stage: "done", backend });
  return {
    blob,
    meta: {
      residual,
      backend,
      outW: W,
      outH: H,
      hasIcc: !!icc,
      chained4x: !!opts.chained4x,
      preset: opts.preset,
      dering: opts.dering,
      sharpness: opts.sharpness,
      shock: opts.shock,
    },
  };
}

async function encodeCanvasPng(raw: Float32Array, W: number, H: number): Promise<Blob> {
  const outCanvas = new OffscreenCanvas(W, H);
  const octx = outCanvas.getContext("2d");
  if (!octx) throw new Error("output context unavailable");
  const outImg = octx.createImageData(W, H);
  const c = 4;
  for (let y = 0; y < H; y++) {
    const rowOffset = y * W;
    for (let x = 0; x < W; x++) {
      const i = rowOffset + x;
      const a = Math.max(0, Math.min(1, raw[i * c + 3]));
      const invA = a > 1e-6 ? 1 / a : 0;
      for (let ch = 0; ch < 3; ch++) {
        const dither = spatialTriangularDither(x, y, ch);
        const lin = Math.max(0, Math.min(1, raw[i * c + ch] * invA));
        const srgbVal = fastLinearToSrgb(lin) * 255;
        outImg.data[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(srgbVal + dither)));
      }
      outImg.data[i * 4 + 3] = Math.round(a * 255);
    }
  }
  octx.putImageData(outImg, 0, 0);
  return await outCanvas.convertToBlob({ type: "image/png" });
}

// --- Worker-thread RPC bridge -------------------------------------------

function isWorkerScope(): boolean {
  if (typeof window !== "undefined") return false;
  if (typeof self === "undefined") return false;
  return (
    typeof (self as unknown as { postMessage?: unknown }).postMessage === "function"
  );
}

if (isWorkerScope()) {
  const controllers = new Map<number, AbortController>();
  const scope = self as unknown as {
    addEventListener(
      type: "message",
      listener: (e: MessageEvent<ViceIncoming>) => void,
    ): void;
    postMessage(message: ViceOutgoing): void;
  };
  scope.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "cancel") {
      controllers.get(msg.jobId)?.abort();
      return;
    }
    if (msg.type === "warm") {
      if (msg.base) ensureCore(msg.base).catch(() => {});
      return;
    }
    const ctrl = new AbortController();
    controllers.set(msg.jobId, ctrl);
    runViceUpscale(
      msg.file,
      msg.scale,
      (progress) => {
        scope.postMessage({ type: "progress", jobId: msg.jobId, progress });
      },
      {
        signal: ctrl.signal,
        base: msg.base,
        chained4x: msg.chained4x,
        preset: msg.preset,
        dering: msg.dering,
        sharpness: msg.sharpness,
        shock: msg.shock,
      },
    ).then(
      ({ blob, meta }) => {
        controllers.delete(msg.jobId);
        scope.postMessage({ type: "done", jobId: msg.jobId, blob, meta });
      },
      (err: unknown) => {
        controllers.delete(msg.jobId);
        const aborted = err instanceof DOMException && err.name === "AbortError";
        scope.postMessage({
          type: "fail",
          jobId: msg.jobId,
          message: err instanceof Error ? err.message : "Upscale failed",
          aborted,
        });
      },
    );
  });

  scope.postMessage({ type: "ready", jobId: 0 });
}
