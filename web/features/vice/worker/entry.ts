// Worker entry point: thin postMessage routing boundary only.

import type {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from "./protocol";
import { ensureCore, runCoordinatedJob } from "./coordinate";
import { WorkerChunkSink } from "../export/worker-chunk-sink";
import type { ExportTarget } from "../contracts/render-contracts";
import type { DeviceFacts } from "../planner/plan";

function isWorkerScope(): boolean {
  return (
    typeof window === "undefined" &&
    typeof self !== "undefined" &&
    typeof (self as unknown as { postMessage?: unknown }).postMessage === "function"
  );
}

if (isWorkerScope()) {
  const controllers = new Map<number, AbortController>();
  const ackWaiters = new Map<number, { resolve: () => void; reject: (e: unknown) => void }>();
  const scope = self as unknown as {
    addEventListener(type: "message", l: (e: MessageEvent<WorkerIncomingMessage>) => void): void;
    postMessage(msg: WorkerOutgoingMessage, transfer?: Transferable[]): void;
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

    let target: ExportTarget = { kind: "blob" };
    if (msg.saveToDisk) {
      const sink = new WorkerChunkSink(
        msg.jobId,
        scope,
        (jobId) =>
          new Promise<void>((resolve, reject) => {
            if (ctrl.signal.aborted) {
              reject(new DOMException("cancelled", "AbortError"));
              return;
            }
            ackWaiters.set(jobId, { resolve, reject });
          }),
        ctrl.signal,
      );
      target = { kind: "file", sink };
    }

    const device: DeviceFacts = msg.device ?? {
      logicalCores: 4,
      deviceMemoryGB: null,
      opfs: false,
      fileSystemAccess: false,
      storageFreeBytes: null,
    };

    runCoordinatedJob({
      file: msg.file,
      scale: msg.scale,
      chained4x: msg.chained4x,
      preferSave: msg.saveToDisk ? "file" : msg.preferSave ?? "blob",
      fileCount: msg.fileCount ?? 1,
      device,
      base: msg.base,
      target,
      streamThresholdPx: msg.streamThresholdPx,
      onProgress: (progress) => scope.postMessage({ type: "progress", jobId: msg.jobId, progress }),
      onStripPng: async (png, index, total) => {
        scope.postMessage({ type: "strippng", jobId: msg.jobId, index, total, png }, [png.buffer]);
      },
      signal: ctrl.signal,
    }).then(
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
