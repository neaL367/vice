// Explicit domain contracts for Vice rendering, independent of browser/React code.

export type Scale = 2 | 3 | 4;

export interface ChunkSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export type SinkFactory = (name: string) => Promise<ChunkSink>;

export type ExportTarget =
  | { kind: "blob" }
  | { kind: "file"; sink: ChunkSink; suggestedName?: string }
  | { kind: "folder"; sinkFactory: SinkFactory; suggestedName?: string };

export interface RenderConfig {
  scale: Scale;
  chained4x?: boolean;
}

export interface RenderResultMeta {
  residual: number;
  backend: string;
  outW: number;
  outH: number;
  hasIcc?: boolean;
  chained4x?: boolean;
  durationMs: number;
  savedToDisk?: boolean;
  fileName?: string;
  fileBytes?: number;
  threads?: number;
}

export type RenderEvent =
  | {
      type: "progress";
      completedRows: number;
      totalRows: number;
      stage?: string;
      backend?: string;
    }
  | { type: "preview"; bitmap?: ImageBitmap; blob?: Blob }
  | { type: "complete"; result: RenderResultMeta; blob?: Blob }
  | { type: "failure"; error: Error };
