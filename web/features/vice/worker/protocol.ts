// Versioned protocol contracts for Web Worker RPC boundary.

import type {
  ExportTarget,
  Scale,
} from "../contracts/render-contracts";
import type {
  ViceProgress,
  ViceResultMeta,
  ViceScale,
} from "../types/vice";
import type { DeviceFacts } from "../planner/plan";

export interface WorkerRunRequest {
  type: "run";
  jobId: number;
  file: File;
  scale: ViceScale;
  base: string;
  chained4x?: boolean;
  streamThresholdPx?: number;
  saveToDisk?: boolean;
  preferSave?: "blob" | "file" | "folder";
  fileCount?: number;
  device?: DeviceFacts;
}

export interface WorkerCancelRequest {
  type: "cancel";
  jobId: number;
}

export interface WorkerWarmRequest {
  type: "warm";
  jobId: 0;
  base: string;
}

export interface WorkerAckRequest {
  type: "pngack";
  jobId: number;
}

export type WorkerIncomingMessage =
  | WorkerRunRequest
  | WorkerCancelRequest
  | WorkerWarmRequest
  | WorkerAckRequest;

export interface WorkerProgressEvent {
  type: "progress";
  jobId: number;
  progress: ViceProgress;
}

export interface WorkerChunkEvent {
  type: "pngchunk";
  jobId: number;
  chunk: Uint8Array;
}

export interface WorkerStripEvent {
  type: "strippng";
  jobId: number;
  index: number;
  total: number;
  png: Uint8Array;
}

export interface WorkerDoneEvent {
  type: "done";
  jobId: number;
  blob: Blob;
  meta: ViceResultMeta;
}

export interface WorkerFailEvent {
  type: "fail";
  jobId: number;
  message: string;
  aborted: boolean;
}

export interface WorkerReadyEvent {
  type: "ready";
  jobId: 0;
}

export type WorkerOutgoingMessage =
  | WorkerProgressEvent
  | WorkerChunkEvent
  | WorkerStripEvent
  | WorkerDoneEvent
  | WorkerFailEvent
  | WorkerReadyEvent;
