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
export type ViceIncoming = ViceRunMsg | ViceCancelMsg | ViceWarmMsg;

export interface ViceProgressMsg {
  type: "progress";
  jobId: number;
  progress: ViceProgress;
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
  | ViceDoneMsg
  | ViceFailMsg
  | ViceReadyMsg;
