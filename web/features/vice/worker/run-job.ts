// Job coordinator: coordinates decode, unified execution, and export delivery.

import type {
  ExportTarget,
  RenderResultMeta,
} from "../contracts/render-contracts";
import type { ViceProgress, ViceRunOptions, ViceScale } from "../types/vice";
import { decodeInputImage } from "./decode-input";
import { loadWasmModule, type ViceCoreInstance } from "../engine/wasm-module";
import { WasmMemory } from "../engine/wasm-memory";
import { getThreadWorkers } from "../engine/capabilities";
import { UnifiedRenderer } from "../renderers/unified-renderer";

let coreCache: {
  key: string;
  promise: Promise<{ instance: ViceCoreInstance; threaded: boolean } | null>;
} | null = null;

export function ensureCore(
  base: string,
): Promise<{ instance: ViceCoreInstance; threaded: boolean } | null> {
  if (!coreCache || coreCache.key !== base) {
    coreCache = { key: base, promise: loadWasmModule(base).catch(() => null) };
  }
  return coreCache.promise;
}

export async function runViceJobInternal(
  file: File,
  scale: ViceScale,
  target: ExportTarget,
  onProgress: (p: ViceProgress) => void,
  opts: ViceRunOptions = {},
): Promise<{ blob: Blob; meta: RenderResultMeta }> {
  const signal = opts.signal;
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");

  // 1. Decode input image
  const decoded = await decodeInputImage(file, signal);

  try {
    // 2. Load engine
    const loadedCore = opts.base ? await ensureCore(opts.base) : null;
    const core = loadedCore?.instance ?? null;

    if (!core) {
      throw new Error(
        "Vice requires WebAssembly to upscale images. Native engine not available.",
      );
    }

    const outPx = decoded.width * decoded.height * scale * scale;
    const streamCapPx = opts.streamThresholdPx ?? 64_000_000;
    if (outPx > streamCapPx && target.kind === "blob") {
      const mp = (outPx / 1_000_000).toFixed(1);
      const capMp = (streamCapPx / 1_000_000).toFixed(0);
      throw new Error(
        `Output ${mp} MP exceeds browser memory limit (${capMp} MP). Use Save to Disk for direct streaming.`,
      );
    }

    const mem = new WasmMemory(core);
    const threadWorkers = getThreadWorkers(core);

    let resultBlob: Blob | undefined;
    let resultMeta: RenderResultMeta | undefined;

    // 3. Direct unified streaming execution
    const renderer = new UnifiedRenderer();
    const stream = renderer.run(
      decoded,
      { scale, chained4x: opts.chained4x },
      target,
      {
        mem,
        signal,
        threadWorkers,
      },
    );

    for await (const event of stream) {
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
      if (event.type === "progress") {
        onProgress({
          band: event.completedRows,
          totalBands: event.totalRows,
          stage: event.stage ?? "Rendering…",
          backend: event.backend ?? "Lanczos-3",
        });
      } else if (event.type === "complete") {
        resultBlob = event.blob;
        resultMeta = event.result;
      } else if (event.type === "failure") {
        throw event.error;
      }
    }

    if (!resultMeta) {
      throw new Error("Render pipeline completed without producing a result");
    }

    return {
      blob: resultBlob ?? new Blob([], { type: "image/png" }),
      meta: resultMeta,
    };
  } finally {
    decoded.close();
  }
}
