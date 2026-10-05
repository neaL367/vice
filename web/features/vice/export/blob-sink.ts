// BlobSink: in-memory accumulator that constructs a Blob from chunks.

import type { ChunkSink } from "../contracts/render-contracts";

export class BlobSink implements ChunkSink {
  private readonly chunks: Uint8Array[] = [];
  private closed = false;
  private totalBytes = 0;
  private builtBlob: Blob | null = null;

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("BlobSink is closed");
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.builtBlob = new Blob(this.chunks as unknown as BlobPart[], { type: "image/png" });
  }

  async abort(): Promise<void> {
    this.closed = true;
    this.chunks.length = 0;
    this.totalBytes = 0;
    this.builtBlob = null;
  }

  getBlob(): Blob {
    if (!this.builtBlob) {
      this.builtBlob = new Blob(this.chunks as unknown as BlobPart[], { type: "image/png" });
    }
    return this.builtBlob;
  }

  getBytesWritten(): number {
    return this.totalBytes;
  }
}
