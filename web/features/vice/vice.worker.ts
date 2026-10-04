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
import { runViceJobInternal } from "./worker/run-job";

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
  return runViceJobInternal(file, scale, target, onProgress, opts);
}
