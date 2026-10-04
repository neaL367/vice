// Vice feature contract: every type shared by 2+ files in features/vice/.
// Pure types only — no runtime code, erased at build. Single import surface
// for the pipeline scale, job state, and worker-thread RPC messages.

export type ViceScale = 2 | 3 | 4;
export type VicePreset = "photo" | "smooth" | "pixel-art";

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
  preset?: VicePreset;
  dering?: number;
  sharpness?: number;
  shock?: number;
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
  preset?: VicePreset;
  dering?: number;
  sharpness?: number;
  shock?: number;
  durationMs: number;
  savedToDisk?: boolean; // infinite path: blob is a small preview, file is on disk
  fileBytes?: number; // infinite path: encoded bytes written
  threads?: number; // engine row workers (1 = single-threaded core)
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
  preset?: VicePreset;
  dering?: number;
  sharpness?: number;
  shock?: number;
  streamThresholdPx?: number; // test hook: force streaming above this output px
  sink?: VicePngSink; // present -> infinite path: stream PNG chunks, no Blob
  fourXDetail?: boolean; // infinite chained 4x: full tuning on both passes
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
  preset?: VicePreset;
  dering?: number;
  sharpness?: number;
  shock?: number;
  streamThresholdPx?: number;
  saveToDisk?: boolean; // infinite path: worker emits pngchunk, awaits pngack
  fourXDetail?: boolean;
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
  | ViceDoneMsg
  | ViceFailMsg
  | ViceReadyMsg;
