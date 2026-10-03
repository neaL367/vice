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

const workerReadyMap = new WeakMap<Worker, Promise<void>>();

export function spawnViceWorker(): Worker | null {
  try {
    if (typeof document === "undefined") return null;
    const worker = new Worker(new URL("vice-worker.js", document.baseURI), {
      type: "module",
    });

    // Synchronously listen for boot handshake so the event is never missed.
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

// Boot handshake: resolves when the thread posts ready, rejects on error
// or silence. Uses the promise captured at spawn time to avoid race conditions.
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
  chained4x?: boolean,
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
    const req: ViceIncoming = { type: "run", jobId, file, scale, base, chained4x };
    worker.postMessage(req);
  });
}

export function cancelWorkerJob(worker: Worker, jobId: number): void {
  const msg: ViceIncoming = { type: "cancel", jobId };
  worker.postMessage(msg);
}

// Fire-and-forget ORT warmup. No response by design; run() observes the
// cached session (or its cached failure) when the user starts the job.
export function warmViceWorker(worker: Worker, base: string): void {
  const msg: ViceIncoming = { type: "warm", jobId: 0, base };
  worker.postMessage(msg);
}

