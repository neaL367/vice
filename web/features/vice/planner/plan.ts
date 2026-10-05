// planRender: decide ONCE, then execute without branching. Pure function of
// (probe, request, device facts, estimator): fully table-testable, no I/O.
// Wiring into JobController lands with the coordinator (P6); until then the
// table tests below are the gate.

import type { ImageProbe } from "./probe";
import { ProbeError } from "./probe";

export type DeviceFacts = Readonly<{
  logicalCores: number;
  deviceMemoryGB: number | null; // null = unknown (non-Chromium)
  opfs: boolean;
  fileSystemAccess: boolean;
  storageFreeBytes: number | null;
}>;

export type SinkKind = "opfs" | "user-file" | "folder" | "blob" | "strips";

export type RenderPlan = Readonly<{
  workers: number; // K slab workers (1 = sequential bands, same bytes)
  geometry: Readonly<{
    scale: 2 | 3 | 4;
    bandRows: 64;
    slabBands: 8;
    outW: number;
    outH: number;
  }>;
  policy: "direct" | "clean"; // "clean" only at 4x (fused mode 1)
  sink: Readonly<{ kind: SinkKind }>;
  budget: Readonly<{ estimatedPeakBytes: number; ceilingBytes: number }>;
  reasons: readonly string[];
}>;

export type PlanErrorKind = "too-large" | "no-sink" | "over-budget" | "bad-input";

export class PlanError extends Error {
  constructor(
    readonly kind: PlanErrorKind,
    message: string,
    readonly suggestedAction?: string,
  ) {
    super(message);
    this.name = "PlanError";
  }
}

export type JobRequest = Readonly<{
  scale: 2 | 3 | 4;
  chained4x: boolean;
  fileCount: number;
  preferSave: "blob" | "file" | "folder";
}>;

export type BlobCapFn = (outMP: number) => boolean; // true = over cap

/** Peak estimator injected by the caller (P6 wires the WASM call). */
export type EstimateFn = (
  inW: number,
  inH: number,
  scale: number,
  channels: number,
  bandRows: number,
  fused: number,
) => number;

// Per-worker WASM instance floor (assumption until G6 measures phones).
const PER_WORKER_FLOOR = 256 * 2 ** 20;
const MAX_WORKERS = 8;

function ceilingBytes(device: DeviceFacts): number {
  if (device.deviceMemoryGB == null) return 2 ** 30;
  return Math.min(2 * 2 ** 30, Math.max(1, Math.floor(device.deviceMemoryGB)) * (256 * 2 ** 20));
}

export function planRender(
  probe: ImageProbe,
  job: JobRequest,
  device: DeviceFacts,
  estimate: EstimateFn,
  blobOverCap: BlobCapFn,
): RenderPlan {
  const reasons: string[] = [];
  if (!probe || probe.w <= 0 || probe.h <= 0) {
    throw new PlanError("bad-input", "probe has no dimensions", "Pick a PNG, JPEG, or WebP file.");
  }
  const outW = probe.w * job.scale;
  const outH = probe.h * job.scale;
  const outMP = (outW * outH) / 1_000_000;

  const policy: "direct" | "clean" = job.chained4x && job.scale === 4 ? "clean" : "direct";
  if (policy === "clean") reasons.push("4x chained: clean fused second pass");
  const fused = policy === "clean" ? 1 : 0;

  const estimatedPeakBytes = estimate(probe.w, probe.h, job.scale, 4, 64, fused);
  const ceiling = ceilingBytes(device);
  if (!(estimatedPeakBytes > 0)) {
    throw new PlanError("bad-input", "estimator refused geometry", "Try a smaller image.");
  }
  if (estimatedPeakBytes > ceiling) {
    throw new PlanError(
      "over-budget",
      `estimated peak ${(estimatedPeakBytes / 2 ** 20).toFixed(0)} MB exceeds ${(ceiling / 2 ** 20).toFixed(0)} MB ceiling`,
      "Use a smaller scale or a device with more memory.",
    );
  }
  if (device.storageFreeBytes != null && estimatedPeakBytes > device.storageFreeBytes) {
    throw new PlanError(
      "over-budget",
      "estimated peak exceeds free storage",
      "Free disk space and retry.",
    );
  }

  // Ordered cascade: explicit request first, then Blob under cap, then OPFS,
  // then strips (always available) — never a dead end, never silent OOM.
  let sink: SinkKind;
  if (job.preferSave === "folder" || job.fileCount > 1) {
    if (!device.fileSystemAccess) {
      throw new PlanError(
        "no-sink",
        "folder export needs File System Access (Chrome/Edge desktop)",
        "Export files one at a time, or switch browsers.",
      );
    }
    sink = "folder";
    reasons.push("folder requested: one PNG stream per file, uncapped");
  } else if (job.preferSave === "file") {
    if (!device.fileSystemAccess) {
      throw new PlanError(
        "no-sink",
        "save-to-disk needs File System Access (Chrome/Edge desktop)",
        "Use in-browser download, or switch browsers.",
      );
    }
    sink = "user-file";
    reasons.push("save-to-disk: streams straight to disk, uncapped");
  } else if (!blobOverCap(outMP)) {
    sink = "blob";
    reasons.push(`${outMP.toFixed(1)} MP within Blob cap`);
  } else if (device.opfs) {
    sink = "opfs";
    reasons.push("over Blob cap: OPFS temp file, disk-backed");
  } else {
    sink = "strips";
    reasons.push("over Blob cap, no OPFS: strip PNGs, no dead end");
  }

  const cores = Math.max(1, Math.floor(device.logicalCores) || 1);
  const byBudget = Math.max(1, Math.floor(ceiling / PER_WORKER_FLOOR));
  const workers = Math.max(1, Math.min(MAX_WORKERS, cores, byBudget));
  reasons.push(`K=${workers} (cores ${cores}, 256 MB/worker floor assumption)`);

  return {
    workers,
    geometry: { scale: job.scale, bandRows: 64, slabBands: 8, outW, outH },
    policy,
    sink: { kind: sink },
    budget: { estimatedPeakBytes, ceilingBytes: ceiling },
    reasons,
  };
}

export { ProbeError };
