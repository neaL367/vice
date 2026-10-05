// OPFS sink: ChunkSink over an Origin Private File System file.
// Disk-backed overflow for over-cap renders on any browser with OPFS
// (Chrome, Firefox, Safari incl. iOS — not Safari Private Browsing).
// Same ChunkSink contract as FileSystemSink; no File System Access needed.

import type { ChunkSink } from "../contracts/render-contracts";

interface OPFSWritable {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface OPFSFileHandle {
  createWritable(): Promise<OPFSWritable>;
}

interface OPFSDirectoryHandle {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<OPFSFileHandle>;
  removeEntry(name: string): Promise<void>;
}

function opfsRoot(): Promise<OPFSDirectoryHandle | null> {
  const nav = navigator as Navigator & {
    storage?: { getDirectory?: () => Promise<unknown> };
  };
  if (typeof nav.storage?.getDirectory !== "function") return Promise.resolve(null);
  return nav.storage.getDirectory() as Promise<OPFSDirectoryHandle | null>;
}

export function opfsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { storage?: unknown }).storage === "object" &&
    typeof (navigator as unknown as { storage: { getDirectory?: unknown } }).storage
      ?.getDirectory === "function"
  );
}

export class OpfsSink implements ChunkSink {
  private constructor(
    private readonly writable: OPFSWritable,
    readonly fileName: string,
  ) {}

  static async create(fileName: string): Promise<OpfsSink> {
    const root = await opfsRoot();
    if (!root) throw new Error("OPFS is not supported by this browser.");
    const handle = await root.getFileHandle(`vice-${fileName}`, { create: true });
    const writable = await handle.createWritable();
    return new OpfsSink(writable, fileName);
  }

  /** Best-effort temp cleanup (completion, cancel, boot sweep). */
  static async remove(fileName: string): Promise<void> {
    const root = await opfsRoot();
    if (!root) return;
    await root.removeEntry(`vice-${fileName}`).catch(() => {});
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.writable.write(chunk);
  }

  async close(): Promise<void> {
    await this.writable.close();
  }

  async abort(reason?: unknown): Promise<void> {
    await this.writable.abort(reason).catch(() => {});
    await OpfsSink.remove(this.fileName);
  }
}
