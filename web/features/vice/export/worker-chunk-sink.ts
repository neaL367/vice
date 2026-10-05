// WorkerChunkSink: bridges chunk streaming across the Web Worker postMessage boundary
// with transferables and backpressure ACK.

import type { ChunkSink } from "../contracts/render-contracts";

export interface WorkerPoster {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export class WorkerChunkSink implements ChunkSink {
  private closed = false;
  private bytesWritten = 0;

  constructor(
    private readonly jobId: number,
    private readonly scope: WorkerPoster,
    private readonly waitForAck: (jobId: number) => Promise<void>,
    private readonly signal?: AbortSignal,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("WorkerChunkSink is closed");
    if (this.signal?.aborted) throw new DOMException("cancelled", "AbortError");

    const buf = chunk.buffer as ArrayBuffer;
    this.scope.postMessage(
      { type: "pngchunk", jobId: this.jobId, chunk },
      [buf],
    );
    this.bytesWritten += chunk.length;
    await this.waitForAck(this.jobId);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.closed = true;
  }

  getBytesWritten(): number {
    return this.bytesWritten;
  }
}
