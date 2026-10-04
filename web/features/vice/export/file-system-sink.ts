// FileSystemSink: streams chunks directly to a FileSystemWritableFileStream.

import type { ChunkSink } from "../contracts/render-contracts";

export interface WritableStreamLike {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export class FileSystemSink implements ChunkSink {
  private closed = false;
  private bytesWritten = 0;

  constructor(private readonly writable: WritableStreamLike) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("FileSystemSink is closed");
    await this.writable.write(chunk);
    this.bytesWritten += chunk.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writable.close();
  }

  async abort(reason?: unknown): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.writable.abort(reason);
    } catch {
      // Ignore abort failure if already aborted/closed
    }
  }

  getBytesWritten(): number {
    return this.bytesWritten;
  }
}
