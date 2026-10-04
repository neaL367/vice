// UnifiedRenderer: Single high-performance streaming execution engine for all Vice renders.
// Replaces disparate full/stream/fused/fallback renderers with one streaming pipeline.
// Operates out-of-core with bounded memory, handling small images to gigapixels
// targeting Blobs, Files, or Directory folders.

import type { DecodedImage } from "../worker/decode-input";
import type {
  ChunkSink,
  ExportTarget,
  RenderEvent,
  RenderConfig,
} from "../contracts/render-contracts";
import type { WasmMemory } from "../engine/wasm-memory";
import { NativeStreamContext } from "../engine/stream-renderer";
import { NativePngWriter } from "../engine/png-writer";
import { PreviewAccumulator } from "../worker/emit-preview";
import { BlobSink } from "../export/blob-sink";

export interface RenderContext {
  mem?: WasmMemory;
  signal?: AbortSignal;
  threadWorkers?: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
}

export class UnifiedRenderer {
  async *run(
    input: DecodedImage,
    config: RenderConfig,
    target: ExportTarget,
    ctx?: RenderContext,
  ): AsyncIterable<RenderEvent> {
    if (!ctx?.mem) {
      throw new Error("Vice requires WebAssembly to upscale images. Native engine not available.");
    }

    const mem = ctx.mem;
    const signal = ctx.signal;
    const scale = config.scale;
    const w = input.width;
    const h = input.height;
    const W = w * scale;
    const H = h * scale;
    const BAND = 64;
    const CHUNK = 256;
    const isSaveToDisk = target.kind === "file" || target.kind === "folder";

    const isFused = scale === 4 && !!config.chained4x;

    const backend = isFused
      ? "Lanczos-3 stream 2×2×"
      : isSaveToDisk
        ? "Lanczos-3 stream"
        : "Lanczos-3";

    const startTime = performance.now();

    yield {
      type: "progress",
      completedRows: 0,
      totalRows: H,
      stage: "Streaming…",
      backend,
    };
    throwIfAborted(signal);

    const outCh = input.hasAlpha ? 4 : 3;
    const sctx = NativeStreamContext.create(mem, w, h, scale, 4, BAND);
    if (isFused) {
      sctx.setFusedMode("clean");
    }

    const bandPtr = mem.malloc(BAND * W * 4);
    const pst = NativePngWriter.open(mem, W, H, 4, outCh, input.icc ?? undefined);

    let sink: ChunkSink;
    let blobSink: BlobSink | null = null;
    let fileName: string | undefined;

    if (target.kind === "file") {
      sink = target.sink;
      fileName = target.suggestedName;
    } else if (target.kind === "folder") {
      fileName = target.suggestedName || `image-vice${scale}x.png`;
      sink = await target.sinkFactory(fileName);
    } else {
      blobSink = new BlobSink();
      sink = blobSink;
    }

    const previewAcc = isSaveToDisk ? new PreviewAccumulator(W, H) : null;
    let emitted = 0;
    let fileBytes = 0;

    const drainToSink = async () => {
      for (;;) {
        const chunk = pst.drain();
        if (chunk.length === 0) break;
        fileBytes += chunk.length;
        await sink.write(chunk);
        throwIfAborted(signal);
      }
    };

    try {
      if (input.icc) sctx.setIccProfile(input.icc);

      let pushed = 0;
      while (pushed < h) {
        const rows = Math.min(CHUNK, h - pushed);
        const stripLin = input.getLinearStrip(pushed, rows);
        sctx.pushInputRows(stripLin, rows);
        pushed += rows;
        throwIfAborted(signal);

        while (sctx.hasNextBand()) {
          const { rc, rows: bandRows } = sctx.pullBand(bandPtr, BAND);
          if (previewAcc) {
            const bytes = mem.readBytes(bandPtr, bandRows * W * 4);
            previewAcc.feedBand(bytes, emitted, bandRows);
          }
          pst.writeRows(bandPtr, bandRows);
          emitted += bandRows;
          await drainToSink();
          if (emitted % 512 === 0 || rc === 1) {
            yield {
              type: "progress",
              completedRows: Math.min(emitted, H),
              totalRows: H,
              stage: "Streaming…",
              backend,
            };
          }
          throwIfAborted(signal);
          if (rc === 1) break;
        }
      }

      while (emitted < H) {
        if (!sctx.hasNextBand()) {
          throw new Error("stream stalled: input exhausted with rows unemitted");
        }
        const { rc, rows: bandRows } = sctx.pullBand(bandPtr, BAND);
        if (previewAcc) {
          const bytes = mem.readBytes(bandPtr, bandRows * W * 4);
          previewAcc.feedBand(bytes, emitted, bandRows);
        }
        pst.writeRows(bandPtr, bandRows);
        emitted += bandRows;
        await drainToSink();
        if (emitted % 512 === 0 || rc === 1) {
          yield {
            type: "progress",
            completedRows: Math.min(emitted, H),
            totalRows: H,
            stage: "Streaming…",
            backend,
          };
        }
        throwIfAborted(signal);
      }

      const residual = sctx.lastResidual();

      yield {
        type: "progress",
        completedRows: H,
        totalRows: H,
        stage: "Finalizing PNG…",
        backend,
      };

      pst.close();
      await drainToSink();
      await sink.close();

      const durationMs = Math.round(performance.now() - startTime);

      const result = {
        residual,
        backend,
        outW: W,
        outH: H,
        hasIcc: !!input.icc,
        chained4x: isFused,
        durationMs,
        savedToDisk: isSaveToDisk,
        fileName,
        fileBytes,
        threads: ctx.threadWorkers,
      };

      if (blobSink) {
        yield {
          type: "complete",
          blob: blobSink.getBlob(),
          result,
        };
      } else {
        const dummyBlob = new Blob([], { type: "image/png" });
        yield {
          type: "complete",
          blob: dummyBlob,
          result,
        };
      }
    } catch (err) {
      try {
        await sink.abort(err);
      } catch {
        // ignore secondary abort failures
      }
      throw err;
    } finally {
      mem.free(bandPtr);
      pst.destroy();
      sctx.destroy();
    }
  }
}
