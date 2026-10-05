// Worker-thread client: spawn, run, cancel. Feature-local: only the vice
// hook uses it.
//
// The thread loads a prebundled asset (`public/vice-worker.js`, built from
// `workers/vice.worker.ts` by `bun run worker:build`). Deliberately NOT
// `new Worker(new URL(..., import.meta.url))`: Turbopack rewrites that into
// a classic-worker bootstrap that silently stalls on TS+ESM entries. A plain
// path keeps `{ type: "module" }` intact and the browser loads real ESM.
// Falls back inline when the asset is missing (dev without predev) or the
// thread can't spawn — CSP, old browser, SSR import (never constructed there).
import type {
  ViceIncoming,
  ViceOutgoing,
  ViceProgress,
  ViceResultMeta,
  ViceScale,
} from "./types/vice";
import type { DeviceFacts } from "./planner/plan";
import { opfsSupported } from "./export/opfs-sink";

export interface ViceJobOptions {
  chained4x?: boolean;
  streamThresholdPx?: number;
  preferSave?: "blob" | "file" | "folder";
  fileCount?: number;
  // Infinite path: chunks from the worker are written here (FileSystem
  // Writable), then acknowledged one at a time (backpressure: 1 in flight).
  sinkWrite?: (chunk: Uint8Array) => Promise<void>;
  // Strips fallback: per-slab PNGs arrive here for download.
  onStripPng?: (png: Uint8Array, index: number, total: number) => Promise<void>;
}

export function collectDeviceFacts(): DeviceFacts {
  const nav = (
    typeof navigator !== "undefined" ? navigator : {}
  ) as Navigator & { deviceMemory?: unknown };
  const dm = nav.deviceMemory;
  return {
    logicalCores:
      typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : 4,
    deviceMemoryGB: typeof dm === "number" && dm > 0 ? dm : null,
    opfs: opfsSupported(),
    fileSystemAccess:
      typeof window !== "undefined" &&
      typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker ===
        "function",
    storageFreeBytes: null, // estimated at save time, not probed up front
  };
}

const workerReadyMap = new WeakMap<Worker, Promise<void>>();

export function spawnViceWorker(): Worker | null {
  try {
    if (typeof document === "undefined") return null;
    const worker = new Worker(new URL("vice-worker.js", document.baseURI), {
      type: "module",
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Worker boot timeout"));
      }, 8000);
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      const onMessage = (e: MessageEvent<ViceOutgoing>) => {
        if (e.data.type === "ready") {
          cleanup();
          resolve();
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(new Error(e.message || "Worker failed to boot"));
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
    });

    workerReadyMap.set(worker, readyPromise);
    return worker;
  } catch {
    return null;
  }
}

export function waitForWorkerReady(worker: Worker, timeoutMs = 8000): Promise<void> {
  const existing = workerReadyMap.get(worker);
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Worker boot timeout"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = (e: MessageEvent<ViceOutgoing>) => {
      if (e.data.type === "ready") {
        cleanup();
        resolve();
      }
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || "Worker failed to boot"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

export function runOnWorkerThread(
  worker: Worker,
  jobId: number,
  file: File,
  scale: ViceScale,
  base: string,
  onProgress: (p: ViceProgress) => void,
  options?: ViceJobOptions,
): Promise<{ blob: Blob; meta: ViceResultMeta }> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    const onMessage = (e: MessageEvent<ViceOutgoing>) => {
      const msg = e.data;
      if (msg.type === "ready") return;
      if (msg.jobId !== jobId) return;
      if (msg.type === "progress") {
        onProgress(msg.progress);
      } else if (msg.type === "pngchunk") {
        // Backpressure relay: write, then ack exactly once. On write
        // failure ack anyway (unblocks the worker) and fail the job.
        void (async () => {
          try {
            if (!options?.sinkWrite) throw new Error("no chunk sink for save-to-disk job");
            await options.sinkWrite(msg.chunk);
            worker.postMessage({ type: "pngack", jobId });
          } catch (err) {
            try {
              worker.postMessage({ type: "pngack", jobId });
            } catch {
              // Worker already gone.
            }
            cleanup();
            reject(err instanceof Error ? err : new Error("chunk write failed"));
          }
        })();
      } else if (msg.type === "strippng") {
        void (async () => {
          try {
            if (!options?.onStripPng) throw new Error("no strip sink for strips job");
            await options.onStripPng(msg.png, msg.index, msg.total);
          } catch (err) {
            cleanup();
            reject(err instanceof Error ? err : new Error("strip write failed"));
          }
        })();
      } else if (msg.type === "done") {
        cleanup();
        resolve({ blob: msg.blob, meta: msg.meta });
      } else {
        cleanup();
        reject(
          msg.aborted
            ? new DOMException("cancelled", "AbortError")
            : new Error(msg.message),
        );
      }
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      console.error("[Vice Worker ErrorEvent]:", e.message, e);
      reject(new Error(e.message || "Worker failed"));
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(toRunRequest(jobId, file, scale, base, options));
  });
}

function toRunRequest(
  jobId: number,
  file: File,
  scale: ViceScale,
  base: string,
  options?: ViceJobOptions,
): ViceIncoming {
  return {
    type: "run",
    jobId,
    file,
    scale,
    base,
    chained4x: options?.chained4x,
    streamThresholdPx: options?.streamThresholdPx,
    saveToDisk: options?.sinkWrite ? true : undefined,
    preferSave: options?.preferSave ?? (options?.sinkWrite ? "file" : "blob"),
    fileCount: options?.fileCount ?? 1,
    device: collectDeviceFacts(),
  };
}

/**
 * Universal job runner:
 * 1. Primary: coordinator worker thread (slab workers, share-nothing).
 * 2. Inline: same coordinator, same thread (no Worker available).
 * WebGPU fallback is gone (deleted with the degraded label): without a
 * compute backend the job fails loudly instead of degrading pixels.
 */
export async function runViceJob(
  worker: Worker | null,
  jobId: number,
  file: File,
  scale: ViceScale,
  base: string,
  onProgress: (p: ViceProgress) => void,
  options?: ViceJobOptions,
): Promise<{ blob: Blob; meta: ViceResultMeta }> {
  if (worker) {
    return runOnWorkerThread(worker, jobId, file, scale, base, onProgress, options);
  }

  const mod = await import("./vice.worker");
  return mod.runViceUpscale(file, scale, onProgress, {
    signal: undefined,
    base,
    chained4x: options?.chained4x,
    streamThresholdPx: options?.streamThresholdPx,
    preferSave: options?.preferSave,
    fileCount: options?.fileCount,
    onStripPng: options?.onStripPng,
    ...(options?.sinkWrite ? { sink: { write: options.sinkWrite } } : {}),
  });
}

export function cancelWorkerJob(worker: Worker, jobId: number): void {
  const msg: ViceIncoming = { type: "cancel", jobId };
  worker.postMessage(msg);
}

export function warmViceWorker(worker: Worker, base: string): void {
  const msg: ViceIncoming = { type: "warm", jobId: 0, base };
  worker.postMessage(msg);
}
