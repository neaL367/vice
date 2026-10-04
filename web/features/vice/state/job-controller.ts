// JobController: imperative execution controller.
// Owns worker lifecycle, cancellation, job queue, save picker/file sinks, and fallback.

import type {
  ViceFile,
  ViceProgress,
  ViceResult,
  ViceResultMeta,
  ViceScale,
} from "../types/vice";
import {
  cancelWorkerJob,
  runViceJob,
  spawnViceWorker,
  waitForWorkerReady,
  warmViceWorker,
} from "../vice-client";
import { FileSystemSink } from "../export/file-system-sink";

export interface JobCallbacks {
  onProgress(progress: string): void;
  onResult(result: ViceResult): void;
  onFinish(): void;
  onError(error: string, cancelled?: boolean): void;
  trackUrl(url: string): string;
}

export interface JobTuningOptions {
  chained4x?: boolean;
}

interface SaveFileHandle {
  createWritable(): Promise<{
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }>;
}

interface DirHandle {
  getFileHandle(
    name: string,
    opts: { create: boolean },
  ): Promise<{
    createWritable(): Promise<{
      write(chunk: Uint8Array): Promise<void>;
      close(): Promise<void>;
      abort(reason?: unknown): Promise<void>;
    }>;
  }>;
}

export function canSaveToDisk(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker ===
      "function"
  );
}

export function canPickDirectory(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      "function"
  );
}

async function pickSaveFile(suggestedName: string): Promise<SaveFileHandle> {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<SaveFileHandle>;
  };
  if (!w.showSaveFilePicker) throw new Error("Save-to-disk is not supported by this browser.");
  return w.showSaveFilePicker({
    suggestedName,
    types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
  });
}

async function pickDirectory(): Promise<DirHandle> {
  const w = window as unknown as {
    showDirectoryPicker?: (opts: unknown) => Promise<DirHandle>;
  };
  if (!w.showDirectoryPicker) throw new Error("Folder save is not supported by this browser.");
  return w.showDirectoryPicker({ mode: "readwrite" });
}

function stageLabel(stage: string): string | null {
  if (stage === "done") return "Done";
  return null;
}

export class JobController {
  private worker: Worker | null = null;
  private workerReady = false;
  private workerBroken = false;
  private currentAbort: AbortController | null = null;
  private jobIdCounter = 0;
  private resultIdCounter = 0;
  private base = "";
  private isRunning = false;

  constructor() {
    if (typeof document !== "undefined") {
      this.base = new URL(".", document.baseURI).href;
    }
  }

  get running(): boolean {
    return this.isRunning;
  }

  ensureWorker(): Worker | null {
    if (!this.base && typeof document !== "undefined") {
      this.base = new URL(".", document.baseURI).href;
    }
    if (!this.worker && !this.workerBroken) {
      this.worker = spawnViceWorker();
      if (this.worker) {
        this.worker.addEventListener("error", () => this.killWorker());
      }
    }
    return this.worker;
  }

  killWorker(): void {
    try {
      this.worker?.terminate();
    } catch {
      // already dead
    }
    this.worker = null;
    this.workerReady = false;
    this.workerBroken = true;
  }

  async warm(): Promise<void> {
    const w = this.ensureWorker();
    if (!w) return;
    try {
      if (!this.workerReady) {
        await waitForWorkerReady(w);
        this.workerReady = true;
      }
      warmViceWorker(w, this.base);
    } catch {
      // Warm failure is advisory
    }
  }

  cancel(): void {
    if (this.worker && this.isRunning) {
      cancelWorkerJob(this.worker, this.jobIdCounter);
    }
    this.currentAbort?.abort();
  }

  terminate(): void {
    this.cancel();
    this.killWorker();
  }

  async runBatch(
    files: ViceFile[],
    scale: ViceScale,
    tuning: JobTuningOptions,
    cb: JobCallbacks,
  ): Promise<void> {
    if (this.isRunning || files.length === 0) return;
    this.isRunning = true;
    const abortCtrl = new AbortController();
    this.currentAbort = abortCtrl;

    try {
      let w = this.ensureWorker();
      if (w && !this.workerReady) {
        try {
          await waitForWorkerReady(w);
          this.workerReady = true;
        } catch {
          this.killWorker();
          w = null;
        }
      }

      for (let i = 0; i < files.length; i++) {
        if (abortCtrl.signal.aborted) throw new DOMException("cancelled", "AbortError");
        w = this.ensureWorker();
        const vf = files[i];
        const tag = files.length > 1 ? `file ${i + 1}/${files.length} ` : "";
        cb.onProgress(`${tag}starting…`);

        const onProg = (p: ViceProgress) => {
          const label = stageLabel(p.stage) ?? `${p.stage}: ${p.band}/${p.totalBands}`;
          cb.onProgress(`${tag}${label}`);
        };

        const { blob, meta } = await this.runOne(vf.file, scale, tuning, w, onProg, abortCtrl.signal);
        const id = ++this.resultIdCounter;
        cb.onResult({
          id,
          name: vf.file.name,
          previewUrl: vf.previewUrl,
          blob,
          blobUrl: cb.trackUrl(URL.createObjectURL(blob)),
          outW: meta.outW,
          outH: meta.outH,
          residual: meta.residual,
          backend: meta.backend,
          scale,
          hasIcc: meta.hasIcc,
          chained4x: meta.chained4x,
          durationMs: meta.durationMs,
        });
      }
      cb.onFinish();
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      cb.onError(e instanceof Error ? e.message : "Upscale failed", isAbort);
    } finally {
      this.currentAbort = null;
      this.isRunning = false;
    }
  }

  async runToFile(
    file: ViceFile,
    scale: ViceScale,
    tuning: JobTuningOptions,
    cb: JobCallbacks,
  ): Promise<void> {
    if (this.isRunning) return;
    if (!canSaveToDisk()) {
      cb.onError("Large exports require Chrome/Edge desktop or Vice Desktop.");
      return;
    }

    this.isRunning = true;
    const abortCtrl = new AbortController();
    this.currentAbort = abortCtrl;
    const stem = file.file.name.replace(/\.[^.]*$/, "") || "image";
    const fileName = `${stem}-vice${scale}x.png`;

    try {
      const handle = await pickSaveFile(fileName);
      const writable = await handle.createWritable();
      const fileSink = new FileSystemSink(writable);

      cb.onProgress("starting…");
      const onProg = (p: ViceProgress) => {
        const label = stageLabel(p.stage) ?? `${p.stage}: ${p.band}/${p.totalBands}`;
        cb.onProgress(label);
      };

      let w = this.ensureWorker();
      if (w && !this.workerReady) {
        try {
          await waitForWorkerReady(w);
          this.workerReady = true;
        } catch {
          this.killWorker();
          w = null;
        }
      }

      let blob: Blob;
      let meta: ViceResultMeta;
      try {
        if (w) {
          const jobId = ++this.jobIdCounter;
          ({ blob, meta } = await runViceJob(w, jobId, file.file, scale, this.base, onProg, {
            ...tuning,
            sinkWrite: (chunk) => fileSink.write(chunk),
          }));
        } else {
          const mod = await import("../vice.worker");
          ({ blob, meta } = await mod.runViceUpscale(file.file, scale, onProg, {
            ...tuning,
            signal: abortCtrl.signal,
            base: this.base,
            sink: { write: (chunk) => fileSink.write(chunk) },
          }));
        }
        await fileSink.close();
      } catch (e) {
        await fileSink.abort(e);
        throw e;
      }

      const id = ++this.resultIdCounter;
      cb.onResult({
        id,
        name: file.file.name,
        previewUrl: file.previewUrl,
        blob,
        blobUrl: cb.trackUrl(URL.createObjectURL(blob)),
        outW: meta.outW,
        outH: meta.outH,
        residual: meta.residual,
        backend: meta.backend,
        scale,
        hasIcc: meta.hasIcc,
        chained4x: meta.chained4x,
        durationMs: meta.durationMs,
        savedToDisk: true,
        fileName,
        fileBytes: meta.fileBytes,
        threads: meta.threads,
      });
      cb.onFinish();
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      cb.onError(e instanceof Error ? e.message : "Save-to-disk export failed", isAbort);
    } finally {
      this.currentAbort = null;
      this.isRunning = false;
    }
  }

  async runBatchToFolder(
    files: ViceFile[],
    scale: ViceScale,
    tuning: JobTuningOptions,
    cb: JobCallbacks,
  ): Promise<void> {
    if (this.isRunning || files.length < 2) return;
    if (!canPickDirectory()) {
      cb.onError("Folder export requires Chrome/Edge desktop or Vice Desktop.");
      return;
    }

    this.isRunning = true;
    const abortCtrl = new AbortController();
    this.currentAbort = abortCtrl;

    try {
      const dir = await pickDirectory();
      let w = this.ensureWorker();
      if (w && !this.workerReady) {
        try {
          await waitForWorkerReady(w);
          this.workerReady = true;
        } catch {
          this.killWorker();
          w = null;
        }
      }

      const inlineMod = w ? null : await import("../vice.worker");

      for (let i = 0; i < files.length; i++) {
        if (abortCtrl.signal.aborted) throw new DOMException("cancelled", "AbortError");
        const vf = files[i];
        const stem = vf.file.name.replace(/\.[^.]*$/, "") || "image";
        const fileName = `${stem}-vice${scale}x.png`;
        const tag = `file ${i + 1}/${files.length} `;
        cb.onProgress(`${tag}starting…`);

        const onProg = (p: ViceProgress) => {
          const label = stageLabel(p.stage) ?? `${p.stage}: ${p.band}/${p.totalBands}`;
          cb.onProgress(`${tag}${label}`);
        };

        const fh = await dir.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        const fileSink = new FileSystemSink(writable);

        let blob: Blob;
        let meta: ViceResultMeta;
        try {
          if (w) {
            const jobId = ++this.jobIdCounter;
            ({ blob, meta } = await runViceJob(w, jobId, vf.file, scale, this.base, onProg, {
              ...tuning,
              sinkWrite: (chunk) => fileSink.write(chunk),
            }));
          } else if (inlineMod) {
            ({ blob, meta } = await inlineMod.runViceUpscale(vf.file, scale, onProg, {
              ...tuning,
              signal: abortCtrl.signal,
              base: this.base,
              sink: { write: (chunk) => fileSink.write(chunk) },
            }));
          } else {
            throw new Error("No compute backend available");
          }
          await fileSink.close();
        } catch (e) {
          await fileSink.abort(e);
          throw e;
        }

        const id = ++this.resultIdCounter;
        cb.onResult({
          id,
          name: vf.file.name,
          previewUrl: vf.previewUrl,
          blob,
          blobUrl: cb.trackUrl(URL.createObjectURL(blob)),
          outW: meta.outW,
          outH: meta.outH,
          residual: meta.residual,
          backend: meta.backend,
          scale,
          hasIcc: meta.hasIcc,
          chained4x: meta.chained4x,
          durationMs: meta.durationMs,
          savedToDisk: true,
          fileName,
          fileBytes: meta.fileBytes,
          threads: meta.threads,
        });
      }
      cb.onFinish();
    } catch (e) {
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      cb.onError(e instanceof Error ? e.message : "Folder export failed", isAbort);
    } finally {
      this.currentAbort = null;
      this.isRunning = false;
    }
  }

  private async runOne(
    file: File,
    scale: ViceScale,
    tuning: JobTuningOptions,
    w: Worker | null,
    onProg: (p: ViceProgress) => void,
    signal: AbortSignal,
  ): Promise<{ blob: Blob; meta: ViceResultMeta }> {
    const jobId = ++this.jobIdCounter;
    try {
      return await runViceJob(w, jobId, file, scale, this.base, onProg, tuning);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      console.warn("[Vice] Primary job runner failed, falling back inline:", e);
      const mod = await import("../vice.worker");
      return await mod.runViceUpscale(file, scale, onProg, {
        signal,
        base: this.base,
        ...tuning,
      });
    }
  }
}
