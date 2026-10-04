"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import type {
  ViceFile,
  VicePreset,
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
import { initialState, viceJobReducer } from "./vice-job-reducer";

const MAX_FILES = 10;
const IMAGE_RE = /^image\/(png|jpeg|webp)$/;

interface SaveFileHandle {
  createWritable(): Promise<{
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

function canSaveToDisk(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker ===
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

function stageLabel(stage: string): string | null {
  if (stage === "done") return "Done";
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// Batch job queue: files upscale sequentially, one at a time (spec sec 8),
// results accumulate and zip on demand. Object URLs live in a tracked list
// revoked on replace-all only — never in effect cleanup. Cleanup fires on
// Activity hide (Cache Components preserves routes hidden instead of
// unmounting), so revoking there would blank results on back-navigation.
//
// Threading: worker thread first (spec sec 8: worker owns the pipeline),
// inline main-thread import as fallback when spawn fails. A running batch
// cancels on page hide; the idle thread terminates in effect cleanup and
// respawns lazily on next run, releasing GPU buffers while hidden.
export function useViceJob() {
  const [state, dispatch] = useReducer(viceJobReducer, initialState);

  // Escape Hatches (refs for external systems & non-rendering imperative handles)
  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);
  const baseRef = useRef<string>("");
  const batchAbortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef(0);
  const resultIdRef = useRef(0);
  const runningRef = useRef(false);

  const track = (url: string) => {
    urlsRef.current.push(url);
    return url;
  };

  const revokeAll = () => {
    for (const u of urlsRef.current) URL.revokeObjectURL(u);
    urlsRef.current = [];
  };

  useEffect(() => {
    const onPageHide = () => revokeAll();

    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      batchAbortRef.current?.abort();
      workerRef.current?.terminate();
      workerRef.current = null;
      readyRef.current = null;
    };
  }, []);

  const killWorker = useCallback(() => {
    // The thread itself died (ErrorEvent), not just a job: terminate, drop
    // handles, and stop spawning it again so later jobs go straight to the
    // inline fallback instead of posting into a corpse and hanging.
    try {
      workerRef.current?.terminate();
    } catch {
      // Already dead.
    }
    workerRef.current = null;
    readyRef.current = null;
    workerBrokenRef.current = true;
  }, []);

  const ensureWorker = useCallback(() => {
    if (!baseRef.current) baseRef.current = new URL(".", document.baseURI).href;
    let w = workerRef.current;
    if (!w && !workerBrokenRef.current) {
      w = spawnViceWorker();
      if (w) {
        // Persistent death watch: the boot-time listener inside
        // spawnViceWorker is removed after ready; this one stays.
        w.addEventListener("error", killWorker);
        workerRef.current = w;
      }
    }
    return w;
  }, [killWorker]);

  const pick = useCallback((incoming: File[] | FileList | undefined | null) => {
    if (!incoming) return;
    if (runningRef.current) {
      dispatch({
        type: "SET_ERROR",
        error: "Finish or cancel the current batch before picking new files.",
      });
      return;
    }
    const list = [...incoming].slice(0, MAX_FILES);
    if (list.length === 0) return;

    let warning = "";
    if ([...incoming].length > MAX_FILES) {
      warning = `Only first ${MAX_FILES} files kept.`;
    }

    const bad = list.find((f) => !IMAGE_RE.test(f.type));
    if (bad) {
      dispatch({
        type: "SET_ERROR",
        error: `Unsupported type: ${bad.name}. PNG/JPEG/WebP only.`,
      });
      return;
    }

    // New file set: give the worker one more chance (its asset may have
    // appeared since, e.g. dev ran worker:build after a 404 boot).
    workerBrokenRef.current = false;

    // Replace-all: revoke previous URLs first outside the render cycle
    revokeAll();
    zipUrlRef.current = null;
    const next: ViceFile[] = list.map((file) => ({
      file,
      previewUrl: track(URL.createObjectURL(file)),
    }));

    startTransition(() => {
      dispatch({ type: "PICK_FILES", files: next, error: warning });
    });

    // Warm the model while the user reads the UI; run() reuses the session.
    // Boot failure here is advisory only: run() performs its own waited
    // boot and marks the worker broken before falling back inline.
    const w = ensureWorker();
    if (w) {
      void (async () => {
        try {
          if (w !== readyRef.current) {
            await waitForWorkerReady(w);
            if (workerRef.current === w) readyRef.current = w;
          }
          warmViceWorker(w, baseRef.current);
        } catch {
          // run() retries with its own wait, then falls back inline.
        }
      })();
    }
  }, [ensureWorker]);

  const removeFile = useCallback((previewUrl: string) => {
    if (runningRef.current) return;
    const target = urlsRef.current.indexOf(previewUrl);
    if (target >= 0) {
      URL.revokeObjectURL(previewUrl);
      urlsRef.current.splice(target, 1);
    }
    startTransition(() => {
      dispatch({ type: "REMOVE_FILE", previewUrl });
    });
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current || state.files.length === 0) return;
    runningRef.current = true;
    dispatch({ type: "START_RUN" });

    // startTransition keeps high-frequency tile updates from locking urgent UI interactions
    const report = (s: string) =>
      startTransition(() => dispatch({ type: "SET_PROGRESS", progress: s }));

    const batchCtrl = new AbortController();
    batchAbortRef.current = batchCtrl;

    const runOne = async (
      file: File,
      w: Worker | null,
      onProg: (p: ViceProgress) => void,
    ): Promise<{ blob: Blob; meta: ViceResultMeta }> => {
      const jobId = ++jobIdRef.current;
      const opts = {
        chained4x: state.chained4x,
        preset: state.preset,
        dering: state.dering,
        sharpness: state.sharpness,
        shock: state.shock,
      };
      try {
        return await runViceJob(w, jobId, file, state.scale, baseRef.current, onProg, opts);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        console.warn("[Vice] Primary job runner failed, falling back inline:", e);
        return runInline(file, onProg, batchCtrl.signal);
      }
    };

    const runInline = async (
      file: File,
      onProg: (p: ViceProgress) => void,
      signal: AbortSignal,
    ): Promise<{ blob: Blob; meta: ViceResultMeta }> => {
      const mod = await import("../vice.worker");
      return await mod.runViceUpscale(file, state.scale, onProg, {
        signal,
        base: baseRef.current,
        chained4x: state.chained4x,
        preset: state.preset,
        dering: state.dering,
        sharpness: state.sharpness,
        shock: state.shock,
      });
    };

    try {
      // Waited boot: a worker that never signals ready is broken, not slow.
      // Mark it before the batch so no job posts into a dead thread.
      let w = ensureWorker();
      if (w && w !== readyRef.current) {
        try {
          await waitForWorkerReady(w);
          if (workerRef.current === w) readyRef.current = w;
        } catch {
          killWorker();
          w = null;
        }
      }
      for (let i = 0; i < state.files.length; i++) {
        if (batchCtrl.signal.aborted) throw new DOMException("cancelled", "AbortError");
        // Re-resolve per file: the thread may have died mid-batch (the
        // death watch marks it broken), in which case go inline directly.
        w = ensureWorker();
        const vf = state.files[i];
        const tag = state.files.length > 1 ? `file ${i + 1}/${state.files.length} ` : "";
        report(`${tag}starting…`);
        const onProg = (p: ViceProgress) => {
          const label = stageLabel(p.stage) ?? `${p.stage}: ${p.band}/${p.totalBands}`;
          report(`${tag}${label}`);
        };
        const { blob, meta } = await runOne(vf.file, w, onProg);
        const id = ++resultIdRef.current;
        const r: ViceResult = {
          id,
          name: vf.file.name,
          previewUrl: vf.previewUrl,
          blob,
          blobUrl: track(URL.createObjectURL(blob)),
          outW: meta.outW,
          outH: meta.outH,
          residual: meta.residual,
          backend: meta.backend,
          scale: state.scale,
          hasIcc: meta.hasIcc,
          chained4x: meta.chained4x,
          durationMs: meta.durationMs,
        };
        startTransition(() => {
          dispatch({ type: "ADD_RESULT", result: r });
        });
      }
      startTransition(() => {
        dispatch({ type: "FINISH_RUN" });
      });
    } catch (e) {
      console.error("[Vice] Job failed:", e);
      if (e instanceof DOMException && e.name === "AbortError") {
        startTransition(() => {
          dispatch({ type: "FAIL_RUN", progress: "cancelled" });
        });
      } else {
        startTransition(() => {
          dispatch({
            type: "FAIL_RUN",
            error: e instanceof Error ? e.message : "Upscale failed",
          });
        });
      }
    } finally {
      batchAbortRef.current = null;
      runningRef.current = false;
    }
  }, [state.files, state.scale, state.chained4x, state.preset, state.dering, state.sharpness, state.shock, killWorker, ensureWorker]);

  // Infinite (save-to-disk) export: no output MP cap. Single file only — one
  // picker per user gesture. The full PNG streams to disk in chunks; the
  // result entry carries a small preview plus the saved file's name/size.
  const runToFile = useCallback(async () => {
    if (runningRef.current || state.files.length !== 1) return;
    if (!canSaveToDisk()) {
      dispatch({
        type: "SET_ERROR",
        error: "Large exports require Chrome/Edge desktop or Vice Desktop.",
      });
      return;
    }
    runningRef.current = true;
    dispatch({ type: "START_RUN" });
    const report = (s: string) =>
      startTransition(() => dispatch({ type: "SET_PROGRESS", progress: s }));
    const batchCtrl = new AbortController();
    batchAbortRef.current = batchCtrl;
    const jobId = ++jobIdRef.current;
    const vf = state.files[0];
    const stem = vf.file.name.replace(/\.[^.]*$/, "") || "image";
    const fileName = `${stem}-vice${state.scale}x.png`;
    try {
      const handle = await pickSaveFile(fileName);
      const writable = await handle.createWritable();
      report("starting…");
      const onProg = (p: ViceProgress) => {
        const label = stageLabel(p.stage) ?? `${p.stage}: ${p.band}/${p.totalBands}`;
        report(label);
      };
      const opts = {
        chained4x: state.chained4x,
        preset: state.preset,
        dering: state.dering,
        sharpness: state.sharpness,
        shock: state.shock,
      };
      let w = ensureWorker();
      if (w && w !== readyRef.current) {
        try {
          await waitForWorkerReady(w);
          if (workerRef.current === w) readyRef.current = w;
        } catch {
          killWorker();
          w = null;
        }
      }
      let blob: Blob;
      let meta: ViceResultMeta;
      const sinkWrite = async (chunk: Uint8Array) => {
        await writable.write(chunk);
      };
      try {
        if (w) {
          ({ blob, meta } = await runViceJob(w, jobId, vf.file, state.scale, baseRef.current, onProg, {
            ...opts,
            sinkWrite,
          }));
        } else {
          // Inline fallback: same engine on the main thread (spec fallback).
          const mod = await import("../vice.worker");
          ({ blob, meta } = await mod.runViceUpscale(vf.file, state.scale, onProg, {
            ...opts,
            signal: batchCtrl.signal,
            base: baseRef.current,
            sink: { write: sinkWrite },
          }));
        }
        await writable.close();
      } catch (e) {
        try {
          await writable.abort();
        } catch {
          // Already closed/failed; the original error matters.
        }
        throw e;
      }
      const id = ++resultIdRef.current;
      const r: ViceResult = {
        id,
        name: vf.file.name,
        previewUrl: vf.previewUrl,
        blob,
        blobUrl: track(URL.createObjectURL(blob)),
        outW: meta.outW,
        outH: meta.outH,
        residual: meta.residual,
        backend: meta.backend,
        scale: state.scale,
        hasIcc: meta.hasIcc,
        chained4x: meta.chained4x,
        durationMs: meta.durationMs,
        savedToDisk: true,
        fileName,
        fileBytes: meta.fileBytes,
      };
      startTransition(() => {
        dispatch({ type: "ADD_RESULT", result: r });
        dispatch({ type: "FINISH_RUN" });
      });
    } catch (e) {
      console.error("[Vice] Save-to-disk job failed:", e);
      if (e instanceof DOMException && e.name === "AbortError") {
        startTransition(() => {
          dispatch({ type: "FAIL_RUN", progress: "cancelled" });
        });
      } else {
        startTransition(() => {
          dispatch({
            type: "FAIL_RUN",
            error: e instanceof Error ? e.message : "Save-to-disk export failed",
          });
        });
      }
    } finally {
      batchAbortRef.current = null;
      runningRef.current = false;
    }
  }, [state.files, state.scale, state.chained4x, state.preset, state.dering, state.sharpness, state.shock, killWorker, ensureWorker]);

  const cancel = useCallback(() => {
    const w = workerRef.current;
    if (w && runningRef.current) cancelWorkerJob(w, jobIdRef.current);
    batchAbortRef.current?.abort();
  }, []);

  const downloadZip = useCallback(async () => {
    // Save-to-disk results carry preview blobs only; never zip those.
    const zippable = state.results.filter((r) => !r.savedToDisk);
    if (zippable.length < 2) return;
    const { BlobReader, BlobWriter, ZipWriter } = await import("@zip.js/zip.js");
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      useWebWorkers: false,
    });
    for (const r of zippable) {
      const stem = r.name.replace(/\.[^.]*$/, "") || "image";
      await writer.add(`${stem}-vice${r.scale}x.png`, new BlobReader(r.blob));
    }
    const blob = await writer.close();
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    const url = track(URL.createObjectURL(blob));
    zipUrlRef.current = url;
    dispatch({ type: "SET_ZIP_URL", url });
  }, [state.results]);

  const setScale = useCallback((scale: ViceScale) => {
    dispatch({ type: "SET_SCALE", scale });
  }, []);

  const setChained4x = useCallback((chained4x: boolean) => {
    dispatch({ type: "SET_CHAINED_4X", chained4x });
  }, []);

  const setSelectedId = useCallback((id: number | null) => {
    startTransition(() => {
      dispatch({ type: "SET_SELECTED_ID", id });
    });
  }, []);

  const setPreset = useCallback((preset: VicePreset) => {
    startTransition(() => {
      dispatch({ type: "SET_PRESET", preset });
    });
  }, []);

  const setDering = useCallback((dering: number) => {
    startTransition(() => {
      dispatch({ type: "SET_DERING", dering });
    });
  }, []);

  const setSharpness = useCallback((sharpness: number) => {
    startTransition(() => {
      dispatch({ type: "SET_SHARPNESS", sharpness });
    });
  }, []);

  const setShock = useCallback((shock: number) => {
    startTransition(() => {
      dispatch({ type: "SET_SHOCK", shock });
    });
  }, []);

  return {
    files: state.files,
    results: state.results,
    selectedId: state.selectedId,
    setSelectedId,
    zipUrl: state.zipUrl,
    scale: state.scale,
    setScale,
    chained4x: state.chained4x,
    setChained4x,
    preset: state.preset,
    setPreset,
    dering: state.dering,
    setDering,
    sharpness: state.sharpness,
    setSharpness,
    shock: state.shock,
    setShock,
    progress: state.progress,
    running: state.running,
    error: state.error,
    pick,
    removeFile,
    run,
    runToFile,
    canSaveToDisk: canSaveToDisk(),
    cancel,
    downloadZip,
  };
}
