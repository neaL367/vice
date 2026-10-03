// vice.worker.ts — owns decode, upscale, projection, PNG encode.
// Neural path: RealPLKSR x2 via ONNX Runtime (self-hosted WASM EP) when the
// model asset resolves; bilinear stand-in otherwise. Projection always runs.
// API stays: run(file, scale, onProgress, opts) -> {blob, residual, backend}.
// WASM core (C++) drops in behind same messages later.
//
// Cancellation is per-job via AbortSignal, never module state: concurrent
// renders share this module, so a flag here would race across jobs.
// ORT session is cached per model URL (worker thread runs jobs serially).

import type * as Ort from "onnxruntime-web";
import {
  bilinearScale,
  hannWeight,
  linearToSrgb,
  planOverlap,
  projectClamp,
  reflectIndex,
  srgbToLinear,
} from "../../lib/vice-pipeline";
import {
  VICE_FALLBACK,
  VICE_MODEL,
  modelUrl,
  ortModuleUrl,
  ortWasmBase,
  type ViceAssets,
} from "../../lib/vice-model";
import { ViceCore } from "../../lib/vice-wasm";
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

// Canvas decodes to straight (non-premultiplied) sRGB bytes. Convert to
// premultiplied linear-light float, the domain projection runs in.
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
      out[i * c + ch] = srgbToLinear(data[i * 4 + ch] / 255) * a;
    }
    out[i * c + 3] = a;
  }
  return out;
}

type OrtModule = typeof import("onnxruntime-web");

interface OrtSession {
  ort: OrtModule;
  session: Ort.InferenceSession;
  inputName: string;
  outputName: string;
  ep: string;
}

let sessionCache: { key: string; promise: Promise<OrtSession> } | null = null;
let sessionError = "";

let coreCache: { key: string; promise: Promise<ViceCore | null> } | null = null;

function ensureCore(base: string): Promise<ViceCore | null> {
  if (!coreCache || coreCache.key !== base)
    coreCache = { key: base, promise: ViceCore.load(base).catch(() => null) };
  return coreCache.promise;
}

function ensureSession(
  assets: ViceAssets,
  prog: (p: ViceProgress) => void,
  backend: string,
): Promise<OrtSession | null> {
  const key = modelUrl(assets);
  if (!sessionCache || sessionCache.key !== key)
    sessionCache = {
      key,
      promise: buildSession(assets, prog, backend).catch((e: unknown) => {
        sessionError = e instanceof Error ? e.message : String(e);
        throw e;
      }),
    };
  return sessionCache.promise.catch(() => null);
}

async function buildSession(
  assets: ViceAssets,
  prog: (p: ViceProgress) => void,
  backend: string,
): Promise<OrtSession> {
  prog({ band: 0, totalBands: 1, stage: "model", backend });
  const url = modelUrl(assets);
  const cache = await caches.open("vice-assets-v1");
  let bytes: ArrayBuffer;
  const hit = await cache.match(url);
  if (hit) {
    bytes = await hit.arrayBuffer();
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`model HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1_000_000) throw new Error("model truncated");
    await cache.put(
      url,
      new Response(buf.slice(0), { headers: { "Content-Type": "application/octet-stream" } }),
    );
    bytes = buf;
  }
  prog({ band: 0, totalBands: 1, stage: "model-bytes", backend });
  // Runtime URL: left as-is by bundlers (turbopackIgnore) and by bun build.
  prog({ band: 0, totalBands: 1, stage: "ort", backend });
  const ort: OrtModule = await import(/* turbopackIgnore: true */ ortModuleUrl(assets));
  ort.env.wasm.wasmPaths = ortWasmBase(assets);
  prog({ band: 0, totalBands: 1, stage: "session", backend });
  // WebGPU first when a GPU is exposed; anything failing there falls back
  // to the verified WASM path. No GPU in headless CI: wasm exercises.
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
  const eps: string[][] = gpu ? [["webgpu", "wasm"], ["wasm"]] : [["wasm"]];
  let session: Ort.InferenceSession | null = null;
  let ep = "wasm";
  for (const list of eps) {
    try {
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: list,
        // Init cost is wasm compile, not graph opt; "basic" keeps fusion wins.
        graphOptimizationLevel: "basic",
      });
      ep = list[0];
      break;
    } catch {
      session = null;
    }
  }
  if (!session) throw new Error("no ORT execution provider available");
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const inMeta = session.inputMetadata[0];
  if (!inMeta.isTensor) throw new Error("model input not a tensor");
  const shape = inMeta.shape;
  if (shape[1] !== 3) throw new Error("model channels != 3");
  const t = typeof shape[2] === "number" && shape[2] > 0 ? shape[2] : VICE_MODEL.tile;
  if (t !== VICE_MODEL.tile) throw new Error(`model tile ${t} != ${VICE_MODEL.tile}`);
  return { ort, session, inputName, outputName, ep };
}

// RGB predictor: sRGB [0,1] tile -> 2x sRGB tile. Alpha never enters the net.
type Predictor = (rgb: Float32Array, t: number) => Promise<Float32Array>;

function ortPredictor(s: OrtSession): Predictor {
  return async (rgb, t) => {
    const nchw = new Float32Array(3 * t * t);
    for (let y = 0; y < t; y++)
      for (let x = 0; x < t; x++)
        for (let c = 0; c < 3; c++) nchw[(c * t + y) * t + x] = rgb[(y * t + x) * 3 + c];
    const tensor = new s.ort.Tensor("float32", nchw, [1, 3, t, t]);
    const out = await s.session.run({ [s.inputName]: tensor });
    const data = out[s.outputName].data as Float32Array;
    const S = t * VICE_MODEL.scale;
    if (data.length !== S * S * 3) throw new Error("model output shape mismatch");
    const rgb2 = new Float32Array(S * S * 3);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        for (let c = 0; c < 3; c++) rgb2[(y * S + x) * 3 + c] = data[(c * S + y) * S + x];
    return rgb2;
  };
}

function bilinearPredictorFor(s: number): Predictor {
  return (rgb, t) => Promise.resolve(bilinearScale(rgb, t, t, 3, s));
}

async function upscaleOnce(
  lin: Float32Array,
  w: number,
  h: number,
  onProgress: (p: ViceProgress) => void,
  backend: string,
  pass: string,
  opts: {
    signal?: AbortSignal;
    tile: number;
    overlap: number;
    factor: number;
    predict: Predictor;
    core: ViceCore | null;
    finalizePng: boolean;
  },
): Promise<{ buf: Float32Array; w: number; h: number; residual: number; png?: Uint8Array }> {
  const c = 4;
  const T = opts.tile;
  const O = opts.overlap;
  const S = opts.factor;
  const tiles = planOverlap(w, h, T, O);
  const W = w * S;
  const H = h * S;
  const raw = new Float32Array(W * H * c);
  const wsum = new Float32Array(W * H);
  // Seed with nearest-neighbor U(y) so every block starts consistent.
  for (let by = 0; by < h; by++)
    for (let bx = 0; bx < w; bx++)
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++)
          for (let ch = 0; ch < c; ch++)
            raw[((by * S + dy) * W + bx * S + dx) * c + ch] =
              lin[(by * w + bx) * c + ch];

  for (let i = 0; i < tiles.length; i++) {
    throwIfAborted(opts.signal);
    const t = tiles[i];
    // Reflect-padded sRGB tile + alpha. Spec boundary: linear -> sRGB -> net.
    const rgb = new Float32Array(T * T * 3);
    const alpha = new Float32Array(T * T);
    for (let yy = 0; yy < T; yy++)
      for (let xx = 0; xx < T; xx++) {
        const sx = reflectIndex(t.ix + xx, w);
        const sy = reflectIndex(t.iy + yy, h);
        const k = (sy * w + sx) * c;
        const a = Math.max(0, Math.min(1, lin[k + 3]));
        for (let ch = 0; ch < 3; ch++) {
          const unprem = a > 0 ? lin[k + ch] / a : 0;
          rgb[(yy * T + xx) * 3 + ch] = linearToSrgb(unprem);
        }
        alpha[yy * T + xx] = a;
      }
    const rgbUp = await opts.predict(rgb, T);
    const aUp = bilinearScale(alpha, T, T, 1, S);
    const OT = T * S;
    for (let yy = 0; yy < OT; yy++)
      for (let xx = 0; xx < OT; xx++) {
        // Net sees sRGB: back to premultiplied linear for projection.
        const ox = t.ox * S + xx;
        const oy = t.oy * S + yy;
        if (ox < 0 || oy < 0 || ox >= W || oy >= H) continue;
        const a = Math.max(0, Math.min(1, aUp[yy * OT + xx]));
        const wt = O > 0 ? hannWeight(xx, yy, OT, OT) : 1;
        const k = oy * W + ox;
        for (let ch = 0; ch < 3; ch++)
          raw[k * c + ch] += srgbToLinear(rgbUp[(yy * OT + xx) * 3 + ch]) * a * wt;
        raw[k * c + 3] += a * wt;
        wsum[k] += wt;
      }
    onProgress({ band: i + 1, totalBands: tiles.length, stage: pass, backend });
    await new Promise((r) => setTimeout(r, 0)); // yield for abort + paint
  }
  for (let k = 0; k < W * H; k++) {
    if (wsum[k] > 0)
      for (let ch = 0; ch < c; ch++) raw[k * c + ch] /= wsum[k];
  }
  if (opts.core) {
    // C++ core owns projection + PNG: upload blended raw, project, read back.
    // Float carry (downloadRaw) keeps multi-pass exact; PNG only on last pass.
    const core = opts.core;
    const ctx = core.create(w, h, S, c);
    try {
      core.setInput(ctx, lin);
      core.submitFullRaw(ctx, raw, W, H);
      core.project(ctx);
      const residual = core.lastResidual(ctx);
      const buf = core.downloadRaw(ctx, W * H * c);
      if (opts.finalizePng) {
        const png = core.finishPng(ctx, W, H, c);
        return { buf, w: W, h: H, residual, png };
      }
      return { buf, w: W, h: H, residual };
    } finally {
      core.destroy(ctx);
    }
  }
  const residual = projectClamp(lin, raw, w, h, S, c, 3);
  return { buf: raw, w: W, h: H, residual };
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

  const bmp = await createImageBitmap(file, { colorSpaceConversion: "none" });
  // Float32 RGBA output = outPx * 16 B. Cap 32 MP output (~512 MB peak).
  const outPx = bmp.width * bmp.height * scale * scale;
  if (outPx > 32_000_000) {
    const mp = (outPx / 1_000_000).toFixed(1);
    bmp.close();
    throw new Error(`Output ${mp} MP exceeds 32 MP v1 limit. Use a smaller image.`);
  }

  let backend = "bilinear fallback";
  let tile: number = VICE_FALLBACK.tile;
  let overlap: number = VICE_FALLBACK.overlap;
  let factor: number = scale === 4 ? 2 : scale;
  let predict: Predictor = bilinearPredictorFor(factor);
  // 4x runs as 2x twice (box4 = box2 o box2, still exactly consistent).
  // Model is 2x-only; 3x has no model path and stays bilinear + projection.
  const passes = scale === 4 ? 2 : 1;
  if (opts.base && scale !== 3) {
    const assets = { base: opts.base };
    const session = await ensureSession(
      assets,
      onProgress,
      "model",
    );
    if (session) {
      backend = `ort-${session.ep} + ${VICE_MODEL.name}`;
      tile = VICE_MODEL.tile;
      overlap = VICE_MODEL.overlap;
      factor = VICE_MODEL.scale;
      predict = ortPredictor(session);
    } else if (sessionError) {
      backend = `bilinear fallback (model: ${sessionError.slice(0, 160)})`;
    }
  } else if (scale === 3) {
    backend = "bilinear 3x (no 3x model)";
  }

  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) {
    bmp.close();
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  let lin = straightSrgbToPremultLinear(img.data, cv.width, cv.height);
  let w = cv.width;
  let h = cv.height;

  let residual = 0;
  let png: Uint8Array | undefined;
  const core = opts.base ? await ensureCore(opts.base) : null;
  const engine = core ? `${backend} + vice-core-wasm` : backend;
  for (let p = 0; p < passes; p++) {
    const r = await upscaleOnce(lin, w, h, onProgress, engine, `pass ${p + 1}/${passes}`, {
      signal: opts.signal,
      tile,
      overlap,
      factor,
      predict,
      core,
      finalizePng: p === passes - 1,
    });
    lin = r.buf;
    w = r.w;
    h = r.h;
    residual = r.residual;
    if (r.png) png = r.png;
  }
  throwIfAborted(opts.signal);

  if (png) {
    const blob = new Blob([png.buffer as ArrayBuffer], { type: "image/png" });
    onProgress({ band: 1, totalBands: 1, stage: "done", backend: engine });
    return { blob, meta: { residual, backend: engine, outW: w, outH: h } };
  }
  // TS fallback path (no wasm core): quantize to PNG via canvas.
  const outCanvas = new OffscreenCanvas(w, h);
  const octx = outCanvas.getContext("2d");
  if (!octx) throw new Error("output context unavailable");
  const outImg = octx.createImageData(w, h);
  const c = 4;
  for (let i = 0; i < w * h; i++) {
    const a = Math.max(0, Math.min(1, lin[i * c + 3]));
    for (let ch = 0; ch < 3; ch++) {
      const unprem = a > 0 ? lin[i * c + ch] / a : 0;
      outImg.data[i * 4 + ch] = Math.round(linearToSrgb(unprem) * 255);
    }
    outImg.data[i * 4 + 3] = Math.round(a * 255);
  }
  octx.putImageData(outImg, 0, 0);
  const blob = await outCanvas.convertToBlob({ type: "image/png" });
  onProgress({ band: 1, totalBands: 1, stage: "done", backend });
  return { blob, meta: { residual, backend, outW: w, outH: h } };
}

// --- Worker-thread RPC bridge -------------------------------------------
// Main thread spawns this module via a prebundled public asset and talks
// through these messages (contract: ./types/vice). File/Blob cross the
// boundary by structured clone. Controllers live per jobId: the worker
// thread runs messages serially, so no cross-job race. Module scope stays
// free of job state (see top note).

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
      // Background pre-warm: hide cold ORT init inside user think-time.
      // Failure cached as unavailable; the run falls back to bilinear.
      const noop = () => {};
      ensureSession({ base: msg.base }, noop, "model").catch(noop);
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
      { signal: ctrl.signal, base: msg.base },
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
  // Boot handshake: proves the thread parsed, registered, and can post back.
  // Client waits for this with a timeout; silence means broken worker build.
  scope.postMessage({ type: "ready", jobId: 0 });
}
