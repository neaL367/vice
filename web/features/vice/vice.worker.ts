// vice.worker.ts — entry point for Vice worker bundle and inline execution facade.
// Boots the thin worker RPC router and exports runViceUpscale for inline fallback.

import "./worker/entry";
import type { ExportTarget } from "./contracts/render-contracts";
import type {
  ViceProgress,
  ViceResultMeta,
  ViceRunOptions,
  ViceScale,
} from "./types/vice";
import { runCoordinatedJob } from "./worker/coordinate";
import type { DeviceFacts } from "./planner/plan";

export async function runViceUpscale(
  file: File,
  scale: ViceScale,
  onProgress: (p: ViceProgress) => void,
  opts: ViceRunOptions = {},
): Promise<{ blob: Blob; meta: ViceResultMeta }> {
  let target: ExportTarget = { kind: "blob" };
  if (opts.sink) {
    target = {
      kind: "file",
      sink: {
        write: (chunk) => opts.sink!.write(chunk),
        close: async () => {},
        abort: async () => {},
      },
    };
  }
  const device: DeviceFacts = {
    logicalCores:
      typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
        ? navigator.hardwareConcurrency
        : 4,
    deviceMemoryGB: null,
    opfs: false,
    fileSystemAccess: false,
    storageFreeBytes: null,
  };
  return runCoordinatedJob({
    file,
    scale,
    chained4x: opts.chained4x,
    preferSave: opts.sink ? "file" : "blob",
    fileCount: 1,
    device,
    base: opts.base ?? "",
    target,
    streamThresholdPx: opts.streamThresholdPx,
    onProgress,
    onStripPng: opts.onStripPng,
    signal: opts.signal,
  });
}
