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

export interface WorkerRunRequest {
  type: "run";
  jobId: number;
  file: File;
  scale: ViceScale;
  base: string;
  chained4x?: boolean;
  streamThresholdPx?: number;
  saveToDisk?: boolean;
  fourXDetail?: boolean;
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
  | WorkerDoneEvent
  | WorkerFailEvent
  | WorkerReadyEvent;
