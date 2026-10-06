"use client";

import { useEffect, useRef, useState } from "react";
import type { Job, StudioImage } from "./model";

interface WorkerDone {
  type: "done";
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  residual: number;
  ms: number;
}

// Owns the worker and the job lifecycle. Pixels live here; everything else
// receives slices. No global store, no context.
export function useStudioJob() {
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    workerRef.current = new Worker(new URL("../../workers/vice.worker.ts", import.meta.url));
    return () => workerRef.current?.terminate();
  }, []);

  function openImage(input: StudioImage, name: string) {
    setJob({ kind: "ready", input, name });
  }

  function reset() {
    setJob({ kind: "idle" });
  }

  async function upscale(scale: 2 | 3 | 4) {
    const cur = curRef.current;
    if (!cur || cur.kind === "working") return;
    const input = cur.kind === "done" || cur.kind === "ready" || cur.kind === "error" ? cur.input : null;
    if (!input) return;
    const name = cur.kind === "idle" ? "" : cur.name;
    setJob({ kind: "working", input, name, scale });
    const id = ++idRef.current;
    const worker = workerRef.current!;
    try {
      const done: WorkerDone = await new Promise((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          const m = ev.data;
          if (m.id !== id) return;
          worker.removeEventListener("message", onMsg);
          if (m.type === "error") reject(new Error(m.message));
          else resolve(m as WorkerDone);
        };
        worker.addEventListener("message", onMsg);
        const copy = new Uint8ClampedArray(input.data);
        worker.postMessage({ type: "run", id, pixels: copy, w: input.w, h: input.h, scale }, { transfer: [copy.buffer] });
      });
      setJob({
        kind: "done",
        input,
        name,
        scale,
        output: { data: done.data, w: done.w, h: done.h },
        residual: done.residual,
        ms: done.ms,
      });
    } catch (e) {
      setJob({ kind: "error", input, name, message: "We couldn't process this image." });
      void e;
    }
  }

  // Readable current job inside callbacks without stale closures.
  // Assigned in an effect (never during render) so upscale always sees
  // the latest job; events fire after effects, so this is always fresh.
  const curRef = useRef(job);
  useEffect(() => {
    curRef.current = job;
  }, [job]);

  return { job, openImage, reset, upscale };
}

export async function decodeFile(f: File): Promise<{ image: StudioImage; name: string }> {
  const bmp = await createImageBitmap(f);
  const cap = 2048;
  const k = Math.min(1, cap / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const off = new OffscreenCanvas(w, h);
  const ctx = off.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const data = new Uint8ClampedArray(img.data.buffer as ArrayBuffer);
  bmp.close();
  return { image: { data, w, h }, name: f.name };
}
