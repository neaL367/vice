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
import { maxOutputPixels, maxStreamPixels } from "../../lib/limits";
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
  const fullCapPx = opts.streamThresholdPx ?? maxOutputPixels();
  const streamCapPx = maxStreamPixels();
  // Save-to-disk (infinite) path has no output MP cap: size changes time
  // and disk use, not peak RAM. The Blob routes below keep their caps.
  if (outPx > streamCapPx && !opts.sink) {
    const mp = (outPx / 1_000_000).toFixed(1);
    bmp.close();
    throw new Error(
      `Output ${mp} MP exceeds this device's ${(streamCapPx / 1_000_000).toFixed(0)} MP streaming limit. Use a smaller image or scale, or save to disk.`,
    );
  }
  if (scale === 4 && opts.chained4x && outPx > fullCapPx && !opts.sink) {
    bmp.close();
    throw new Error(
      `Chained 2×2× above ${(fullCapPx / 1_000_000).toFixed(0)} MP is not supported. Disable it for a direct 4× upscale, or save to disk.`,
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
  const w = cv.width;
  const h = cv.height;
  throwIfAborted(opts.signal);

  const W = w * scale;
  const H = h * scale;
  const engineStart = performance.now();
  const engineMs = () => Math.round(performance.now() - engineStart);

  // 1. Native C++ WebAssembly engine: ultra-fast in-memory Lanczos-3 with diagonal steering
  const core = opts.base ? await ensureCore(opts.base) : null;
  if (opts.sink && !(core && core.hasStream() && core.hasInfinite())) {
    bmp.close();
    throw new Error(
      "Save-to-disk export needs the current native engine (stale or missing WASM core).",
    );
  }
  if (core && core.hasNativeUpscale()) {
    // 1a. Infinite path: band renderer -> incremental PNG writer -> caller
    // sink (disk). No full RGBA, no full PNG, no Blob: peak working memory
    // is band-sized plus fixed writer buffers, independent of output height.
    // Chained 4x runs fused (strip-local 2x o 2x, exact 4x4 projection).
    const useInfinite = !!opts.sink;
    if (useInfinite) {
      const infBackend = `Lanczos-3 infinite${scale === 4 && opts.chained4x ? " 2×2×" : ""}`;
      const BAND = 64;
      const CHUNK = 256;
      onProgress({ band: 0, totalBands: H, stage: "Streaming…", backend: infBackend });
      throwIfAborted(opts.signal);
      // Color type from INPUT alpha (tiled scan, bounded): the incremental
      // writer must commit to RGB/RGBA in IHDR before the first band.
      let hasAlpha = false;
      scan: for (let y0 = 0; y0 < h; y0 += 512) {
        const rows = Math.min(512, h - y0);
        const strip = ctx.getImageData(0, y0, w, rows);
        const d = strip.data;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] < 255) {
            hasAlpha = true;
            break scan;
          }
        }
        throwIfAborted(opts.signal);
      }
      const outCh = hasAlpha ? 4 : 3;
      const sctx = core.createStream(w, h, scale, 4, BAND);
      if (scale === 4 && opts.chained4x) core.streamSetFused(sctx, opts.fourXDetail ? 2 : 1);
      const bandPtr = core.mallocBytes(BAND * W * 4);
      const pst = core.pngOpen(W, H, 4, outCh, icc ?? undefined);
      // Fixed preview product: box-downsample emitted bands into a <=1600px
      // RGBA buffer. The giant output never becomes a canvas or Blob URL.
      const PV_MAX = 1600;
      let pW = W;
      let pH = H;
      if (pW > PV_MAX || pH > PV_MAX) {
        const k = Math.min(PV_MAX / pW, PV_MAX / pH);
        pW = Math.max(1, Math.round(pW * k));
        pH = Math.max(1, Math.round(pH * k));
      }
      const preview = new Uint8Array(pW * pH * 4);
      const accSum = new Float32Array(pW * 4);
      let accN = 0;
      let curPy = -1;
      const flushPreviewRow = (py: number) => {
        if (py < 0 || accN === 0) return;
        const base = py * pW * 4;
        for (let px = 0; px < pW; px++) {
          for (let c = 0; c < 4; c++) {
            preview[base + px * 4 + c] = Math.max(
              0,
              Math.min(255, Math.round(accSum[px * 4 + c] / accN)),
            );
          }
        }
      };
      const sink = opts.sink!;
      let emitted = 0;
      let fileBytes = 0;
      const drainToDisk = async () => {
        for (;;) {
          const chunk = core.pngDrain(pst);
          if (chunk.length === 0) break;
          fileBytes += chunk.length;
          await sink.write(chunk);
          throwIfAborted(opts.signal);
        }
      };
      try {
        core.streamSetTuning(sctx, {
          preset: opts.preset,
          dering: opts.dering,
          sharpness: opts.sharpness,
          shock: opts.shock,
        });
        if (icc) core.streamSetIcc(sctx, icc);
        const pump = async () => {
          while (core.streamHasNext(sctx)) {
            const { rc, rows } = core.streamPullBand(sctx, bandPtr, BAND);
            const bytes = core.readBytes(bandPtr, rows * W * 4);
            core.pngWriteRows(pst, bandPtr, rows);
            // Preview: horizontal box per output row, vertical box across rows.
            for (let r = 0; r < rows; r++) {
              const y = emitted + r;
              const py = Math.min(pH - 1, Math.floor((y * pH) / H));
              if (py !== curPy) {
                flushPreviewRow(curPy);
                accSum.fill(0);
                accN = 0;
                curPy = py;
              }
              const rowOff = r * W * 4;
              for (let px = 0; px < pW; px++) {
                const x0 = Math.floor((px * W) / pW);
                const x1 = Math.max(x0 + 1, Math.floor(((px + 1) * W) / pW));
                const n = x1 - x0;
                for (let c = 0; c < 4; c++) {
                  let s = 0;
                  for (let x = x0; x < x1; x++) s += bytes[rowOff + x * 4 + c];
                  accSum[px * 4 + c] += s / n;
                }
              }
              accN++;
            }
            emitted += rows;
            await drainToDisk();
            if (emitted % 512 === 0 || rc === 1) {
              onProgress({
                band: Math.min(emitted, H),
                totalBands: H,
                stage: "Streaming…",
                backend: infBackend,
              });
            }
            throwIfAborted(opts.signal);
            if (rc === 1) break;
          }
        };
        let pushed = 0;
        while (pushed < h) {
          const rows = Math.min(CHUNK, h - pushed);
          const strip = ctx.getImageData(0, pushed, w, rows);
          core.streamPushRows(
            sctx,
            straightSrgbToPremultLinear(strip.data, w, rows),
            rows,
          );
          pushed += rows;
          throwIfAborted(opts.signal);
          await pump();
        }
        while (emitted < H) {
          if (!core.streamHasNext(sctx)) {
            throw new Error("stream stalled: input exhausted with rows unemitted");
          }
          await pump();
        }
        flushPreviewRow(curPy);
        const residual = core.lastStreamResidual(sctx);
        onProgress({ band: H, totalBands: H, stage: "Saving…", backend: infBackend });
        throwIfAborted(opts.signal);
        core.pngClose(pst);
        await drainToDisk();
        bmp.close();
        const pvCanvas = new OffscreenCanvas(pW, pH);
        const pvCtx = pvCanvas.getContext("2d");
        if (!pvCtx) throw new Error("preview context unavailable");
        pvCtx.putImageData(new ImageData(new Uint8ClampedArray(preview), pW, pH), 0, 0);
        const blob = await pvCanvas.convertToBlob({ type: "image/png" });
        onProgress({ band: H, totalBands: H, stage: "done", backend: infBackend });
        return {
          blob,
          meta: {
            residual,
            backend: infBackend,
            outW: W,
            outH: H,
            hasIcc: !!icc,
            chained4x: scale === 4 && !!opts.chained4x,
            preset: opts.preset,
            dering: opts.dering,
            sharpness: opts.sharpness,
            shock: opts.shock,
            durationMs: engineMs(),
            savedToDisk: true,
            fileBytes,
          },
        };
      } finally {
        core.freeBytes(bandPtr);
        core.pngDestroy(pst);
        core.streamDestroy(sctx);
      }
    }
    // 1b. Streaming strip path: band-sized floats, 8-bit accumulation, one
    // PNG encode. Bounded memory above the full-image cap; box-only band
    // projection (same guarantee, no multigrid). Direct scales only.
    const useStream =
      !useInfinite && core.hasStream() && !(scale === 4 && opts.chained4x) && outPx > fullCapPx;
    if (useStream) {
      const streamBackend = "Lanczos-3 stream";
      const BAND = 64;
      const CHUNK = 256;
      onProgress({ band: 0, totalBands: H, stage: "Streaming…", backend: streamBackend });
      throwIfAborted(opts.signal);
      const sctx = core.createStream(w, h, scale, 4, BAND);
      const bandPtr = core.mallocBytes(BAND * W * 4);
      const rgbaPtr = core.mallocBytes(W * H * 4);
      let emitted = 0;
      try {
        core.streamSetTuning(sctx, {
          preset: opts.preset,
          dering: opts.dering,
          sharpness: opts.sharpness,
          shock: opts.shock,
        });
        if (icc) core.streamSetIcc(sctx, icc);
        const pump = () => {
          while (core.streamHasNext(sctx)) {
            const { rc, rows } = core.streamPullBand(sctx, bandPtr, BAND);
            core.copyBytes(bandPtr, rgbaPtr + emitted * W * 4, rows * W * 4);
            emitted += rows;
            if (emitted % 512 === 0 || rc === 1) {
              onProgress({
                band: Math.min(emitted, H),
                totalBands: H,
                stage: "Streaming…",
                backend: streamBackend,
              });
            }
            throwIfAborted(opts.signal);
            if (rc === 1) break;
          }
        };
        let pushed = 0;
        while (pushed < h) {
          const rows = Math.min(CHUNK, h - pushed);
          const strip = ctx.getImageData(0, pushed, w, rows);
          core.streamPushRows(
            sctx,
            straightSrgbToPremultLinear(strip.data, w, rows),
            rows,
          );
          pushed += rows;
          throwIfAborted(opts.signal);
          pump();
        }
        while (emitted < H) {
          if (!core.streamHasNext(sctx)) {
            throw new Error("stream stalled: input exhausted with rows unemitted");
          }
          pump();
        }
        const residual = core.lastStreamResidual(sctx);
        onProgress({ band: H, totalBands: H, stage: "Encoding…", backend: streamBackend });
        throwIfAborted(opts.signal);
        const png = core.streamFinishPng(sctx, rgbaPtr, W * H * 4);
        const blob = new Blob([png as unknown as BlobPart], { type: "image/png" });
        onProgress({ band: H, totalBands: H, stage: "done", backend: streamBackend });
        return {
          blob,
          meta: {
            residual,
            backend: streamBackend,
            outW: W,
            outH: H,
            hasIcc: !!icc,
            chained4x: false,
            preset: opts.preset,
            dering: opts.dering,
            sharpness: opts.sharpness,
            shock: opts.shock,
            durationMs: engineMs(),
          },
        };
      } finally {
        core.freeBytes(bandPtr);
        core.freeBytes(rgbaPtr);
        core.streamDestroy(sctx);
      }
    }

    const linWasm = straightSrgbToPremultLinear(img.data, cv.width, cv.height);
    if (scale === 4 && opts.chained4x) {
      // Chained 2x twice per spec section 3: box4 = box2 o box2
      onProgress({ band: 1, totalBands: 4, stage: "Pass 1 (2×)…", backend });
      throwIfAborted(opts.signal);
      const cctx1 = core.create(w, h, 2, 4);
      let mid: Float32Array;
      try {
        core.setInput(cctx1, linWasm);
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
        // Clean second pass: the mid image is already sharpened; re-sharpening
        // compounds block seams (eval: 4x seam 1.85 chained vs 1.37 direct).
        // Preset/dering carry over, sharpness/shock do not.
        core.upscale(cctx2, {
          preset: opts.preset,
          dering: opts.dering,
          sharpness: 0,
          shock: 0,
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
            durationMs: engineMs(),
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
      core.setInput(cctx, linWasm);
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
            durationMs: engineMs(),
          },
      };
    } finally {
      core.destroy(cctx);
    }
  }

  // 2. Pure Mathematical Super-Resolution TypeScript fallback:
  // Separable Edge-Adaptive Lanczos-3 with Diagonal Steering and Noise-Gated Acutance.
  // Large outputs go through the tiled overlap-add path to bound peak memory.
  // Linearized lazily: the streaming branch above never builds this buffer.
  const lin = straightSrgbToPremultLinear(img.data, cv.width, cv.height);
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
      sharpness: 0,
      shock: 0,
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
      durationMs: engineMs(),
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
  const ackWaiters = new Map<number, { resolve: () => void; reject: (e: unknown) => void }>();
  const scope = self as unknown as {
    addEventListener(
      type: "message",
      listener: (e: MessageEvent<ViceIncoming>) => void,
    ): void;
    postMessage(message: ViceOutgoing, transfer?: Transferable[]): void;
  };
  scope.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "cancel") {
      controllers.get(msg.jobId)?.abort();
      ackWaiters.get(msg.jobId)?.reject(new DOMException("cancelled", "AbortError"));
      ackWaiters.delete(msg.jobId);
      return;
    }
    if (msg.type === "pngack") {
      ackWaiters.get(msg.jobId)?.resolve();
      ackWaiters.delete(msg.jobId);
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
        streamThresholdPx: msg.streamThresholdPx,
        fourXDetail: msg.fourXDetail,
        sink: msg.saveToDisk
          ? {
              write: (chunk) =>
                new Promise<void>((resolve, reject) => {
                  if (ctrl.signal.aborted) {
                    reject(new DOMException("cancelled", "AbortError"));
                    return;
                  }
                  ackWaiters.set(msg.jobId, { resolve, reject });
                  const buf = chunk.buffer as ArrayBuffer;
                  scope.postMessage({ type: "pngchunk", jobId: msg.jobId, chunk }, [buf]);
                }),
            }
          : undefined,
      },
    ).then(
      ({ blob, meta }) => {
        controllers.delete(msg.jobId);
        ackWaiters.delete(msg.jobId);
        scope.postMessage({ type: "done", jobId: msg.jobId, blob, meta });
      },
      (err: unknown) => {
        controllers.delete(msg.jobId);
        ackWaiters.delete(msg.jobId);
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
