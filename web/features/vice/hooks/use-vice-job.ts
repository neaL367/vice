"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type {
  ViceFile,
  ViceProgress,
  ViceResult,
  ViceResultMeta,
  ViceScale,
} from "../types/vice";
import {
  cancelWorkerJob,
  runOnWorkerThread,
  spawnViceWorker,
  waitForWorkerReady,
  warmViceWorker,
} from "../vice-client";

const MAX_FILES = 10;
const IMAGE_RE = /^image\/(png|jpeg|webp)$/;

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
  const [files, setFiles] = useState<ViceFile[]>([]);
  const [results, setResults] = useState<ViceResult[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [scale, setScale] = useState<ViceScale>(2);
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const urlsRef = useRef<string[]>([]);
  const zipUrlRef = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);
  const baseRef = useRef<string>("");
  const batchAbortRef = useRef<AbortController | null>(null);
  const inlineAbortRef = useRef<AbortController | null>(null);
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
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || !runningRef.current) return;
      const w = workerRef.current;
      if (w) cancelWorkerJob(w, jobIdRef.current);
      batchAbortRef.current?.abort();
      inlineAbortRef.current?.abort();
    };
    const onPageHide = () => revokeAll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      batchAbortRef.current?.abort();
      inlineAbortRef.current?.abort();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const ensureWorker = () => {
    if (!baseRef.current) baseRef.current = new URL(".", document.baseURI).href;
    let w = workerRef.current;
    if (!w && !workerBrokenRef.current) {
      w = spawnViceWorker();
      workerRef.current = w;
    }
    return w;
  };

  const pick = useCallback((incoming: File[] | FileList | undefined | null) => {
    if (!incoming) return;
    const list = [...incoming].slice(0, MAX_FILES);
    if (list.length === 0) return;
    if ([...incoming].length > MAX_FILES) {
      setError(`Only first ${MAX_FILES} files kept.`);
    } else {
      setError("");
    }
    const bad = list.find((f) => !IMAGE_RE.test(f.type));
    if (bad) {
      setError(`Unsupported type: ${bad.name}. PNG/JPEG/WebP only.`);
      return;
    }
    // Replace-all: drop previous URLs first (updaters stay pure).
    revokeAll();
    zipUrlRef.current = null;
    const next: ViceFile[] = list.map((file) => ({ file, previewUrl: track(URL.createObjectURL(file)) }));
    setFiles(next);
    setResults([]);
    setSelectedId(null);
    setZipUrl(null);
    // Warm the model while the user reads the UI; run() reuses the session.
    const w = ensureWorker();
    if (w) warmViceWorker(w, baseRef.current);
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current || files.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    setError("");
    const report = (s: string) => startTransition(() => setProgress(s));
    const batchCtrl = new AbortController();
    batchAbortRef.current = batchCtrl;

    const runOne = async (
      file: File,
      w: Worker | null,
      onProg: (p: ViceProgress) => void,
    ): Promise<{ blob: Blob; meta: ViceResultMeta }> => {
      if (!w) return runInline(file, onProg, batchCtrl.signal);
      const jobId = ++jobIdRef.current;
      try {
        await waitForWorkerReady(w);
        return await runOnWorkerThread(w, jobId, file, scale, baseRef.current, onProg);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        workerBrokenRef.current = true;
        w.terminate();
        if (workerRef.current === w) workerRef.current = null;
        return runInline(file, onProg, batchCtrl.signal);
      }
    };
    const runInline = async (
      file: File,
      onProg: (p: ViceProgress) => void,
      signal: AbortSignal,
    ): Promise<{ blob: Blob; meta: ViceResultMeta }> => {
      // Fallback chunk: same module, main thread. Never in initial bundle.
      const mod = await import("../vice.worker");
      inlineAbortRef.current = batchCtrl;
      try {
        return await mod.runViceUpscale(file, scale, onProg, {
          signal,
          base: baseRef.current,
        });
      } finally {
        inlineAbortRef.current = null;
      }
    };

    try {
      const w = ensureWorker();
      for (let i = 0; i < files.length; i++) {
        if (batchCtrl.signal.aborted) throw new DOMException("cancelled", "AbortError");
        const vf = files[i];
        const tag = files.length > 1 ? `file ${i + 1}/${files.length} ` : "";
        report(`${tag}starting…`);
        const onProg = (p: ViceProgress) =>
          report(`${tag}${p.stage}: ${p.band}/${p.totalBands}`);
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
          scale,
        };
        setResults((prev) => [...prev, r]);
        setSelectedId((sel) => (sel === null ? id : sel));
      }
      report("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") report("cancelled");
      else setError(e instanceof Error ? e.message : "Upscale failed");
    } finally {
      batchAbortRef.current = null;
      runningRef.current = false;
      setRunning(false);
    }
  }, [files, scale]);

  const cancel = useCallback(() => {
    const w = workerRef.current;
    if (w && runningRef.current) cancelWorkerJob(w, jobIdRef.current);
    batchAbortRef.current?.abort();
    inlineAbortRef.current?.abort();
  }, []);

  const downloadZip = useCallback(async () => {
    if (results.length < 2) return;
    const { BlobReader, BlobWriter, ZipWriter } = await import("@zip.js/zip.js");
    // Main-thread deflate: tiny PNGs, and no blob: worker under our CSP.
    const writer = new ZipWriter(new BlobWriter("application/zip"), {
      useWebWorkers: false,
    });
    for (const r of results) {
      const stem = r.name.replace(/\.[^.]*$/, "") || "image";
      await writer.add(`${stem}-vice${r.scale}x.png`, new BlobReader(r.blob));
    }
    const blob = await writer.close();
    if (zipUrlRef.current) URL.revokeObjectURL(zipUrlRef.current);
    const url = track(URL.createObjectURL(blob));
    zipUrlRef.current = url;
    setZipUrl(url);
  }, [results]);

  return {
    files,
    results,
    selectedId,
    setSelectedId,
    zipUrl,
    scale,
    setScale,
    progress,
    running,
    error,
    pick,
    run,
    cancel,
    downloadZip,
  };
}
