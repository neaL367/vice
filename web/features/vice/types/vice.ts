// Vice feature contract: every type shared by 2+ files in features/vice/.
// Pure types only — no runtime code, erased at build. Single import surface
// for the pipeline scale, job state, and worker-thread RPC messages.

export type ViceScale = 2 | 3 | 4;

export interface ViceFile {
  file: File;
  previewUrl: string;
}

export interface ViceResult {
  id: number;
  name: string;
  previewUrl: string;
  blob: Blob;
  blobUrl: string;
  outW: number;
  outH: number;
  residual: number;
  backend: string;
  scale: ViceScale;
  hasIcc?: boolean;
  chained4x?: boolean;
  durationMs: number;
  savedToDisk?: boolean; // blob is a small preview; full PNG already on disk
  fileName?: string;
  fileBytes?: number;
  threads?: number;
}

export interface ViceProgress {
  band: number;
  totalBands: number;
  stage: string;
  backend: string;
}

export interface ViceResultMeta {
  residual: number;
  backend: string;
  outW: number;
  outH: number;
  hasIcc?: boolean;
  chained4x?: boolean;
  durationMs: number;
  savedToDisk?: boolean; // infinite path: blob is a small preview, file is on disk
  fileBytes?: number; // infinite path: encoded bytes written
  threads?: number; // slab workers that rendered the job (1 = inline/sequential)
}

// Chunk sink for the infinite (save-to-disk) path. Implemented inline by the
// main thread (FileSystemWritableFileStream) or bridged over worker RPC
// (pngchunk/pngack). Never crosses postMessage itself.
export interface VicePngSink {
  write(chunk: Uint8Array): Promise<void>;
}

export interface ViceRunOptions {
  signal?: AbortSignal;
  base?: string; // page base URL (trailing slash). Absent -> bilinear only.
  chained4x?: boolean; // if scale is 4, run as 2x twice
  streamThresholdPx?: number; // test hook: force streaming above this output px
  sink?: VicePngSink; // present -> infinite path: stream PNG chunks, no Blob
  preferSave?: "blob" | "file" | "folder";
  fileCount?: number;
  onStripPng?: (png: Uint8Array, index: number, total: number) => Promise<void>;
}

// --- Worker-thread RPC ----------------------------------------------------
// File/Blob cross the boundary by structured clone.

export interface ViceRunMsg {
  type: "run";
  jobId: number;
  file: File;
  scale: ViceScale;
  base: string; // page base URL, trailing slash. Asset root for model + ORT.
  chained4x?: boolean;
  streamThresholdPx?: number;
  saveToDisk?: boolean; // infinite path: worker emits pngchunk, awaits pngack
  preferSave?: "blob" | "file" | "folder";
  fileCount?: number;
  device?: {
    logicalCores: number;
    deviceMemoryGB: number | null;
    opfs: boolean;
    fileSystemAccess: boolean;
    storageFreeBytes: number | null;
  };
}
export interface ViceCancelMsg {
  type: "cancel";
  jobId: number;
}
export interface ViceWarmMsg {
  type: "warm";
  jobId: 0;
  base: string;
}
export type ViceIncoming = ViceRunMsg | ViceCancelMsg | ViceWarmMsg | ViceAckMsg;

export interface ViceProgressMsg {
  type: "progress";
  jobId: number;
  progress: ViceProgress;
}
export interface ViceChunkMsg {
  type: "pngchunk";
  jobId: number;
  chunk: Uint8Array; // transferable: posted with [chunk.buffer]
}
export interface ViceStripMsg {
  type: "strippng";
  jobId: number;
  index: number;
  total: number;
  png: Uint8Array; // transferable: posted with [png.buffer]
}
export interface ViceAckMsg {
  type: "pngack";
  jobId: number;
}
export interface ViceDoneMsg {
  type: "done";
  jobId: number;
  blob: Blob;
  meta: ViceResultMeta;
}
export interface ViceFailMsg {
  type: "fail";
  jobId: number;
  message: string;
  aborted: boolean;
}
export interface ViceReadyMsg {
  type: "ready";
  jobId: 0;
}
export type ViceOutgoing =
  | ViceProgressMsg
  | ViceChunkMsg
  | ViceStripMsg
  | ViceDoneMsg
  | ViceFailMsg
  | ViceReadyMsg;
