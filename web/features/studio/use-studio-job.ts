"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Job, Scale, StudioImage } from "./model";
import { HALO, TILE, needsTiling } from "../../lib/engine";

interface WorkerDone {
  type: "done";
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  w: number;
  h: number;
  residual: number;
  ms: number;
}

const POOL_SIZE =
  typeof navigator !== "undefined"
    ? Math.min(Math.max(1, navigator.hardwareConcurrency || 4), 8)
    : 4;

function createWorkerPool(): Worker[] {
  const pool: Worker[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(
      new Worker(new URL("../../workers/vice.worker.ts", import.meta.url)),
    );
  }
  return pool;
}

export function useStudioJob() {
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const workersRef = useRef<Worker[]>([]);
  const idRef = useRef(0);
  const mountedRef = useRef(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    mountedRef.current = true;
    workersRef.current = createWorkerPool();
    return () => {
      mountedRef.current = false;
      for (const w of workersRef.current) w.terminate();
      workersRef.current = [];
    };
  }, []);

  function openImage(input: StudioImage, name: string) {
    startTransition(() => {
      setJob({ kind: "ready", input, name, frames: null });
    });
  }

  function openBurst(images: { image: StudioImage; name: string }[]) {
    const first = images[0];
    for (const { image } of images)
      if (image.w !== first.image.w || image.h !== first.image.h)
        throw new Error("Burst frames must share dimensions.");
    startTransition(() => {
      setJob({
        kind: "ready",
        input: first.image,
        name: first.name,
        frames: images.map((x) => x.image),
      });
    });
  }

  function reset() {
    setJob({ kind: "idle" });
  }

  async function upscale(scale: Scale) {
    const cur = curRef.current;
    if (!cur || cur.kind === "working") return;
    const input =
      cur.kind === "done" || cur.kind === "ready" || cur.kind === "error"
        ? cur.input
        : null;
    if (!input) return;
    const name = cur.kind === "idle" ? "" : cur.name;
    const frames =
      (cur.kind === "done" || cur.kind === "ready" || cur.kind === "error") && cur.frames
        ? cur.frames
        : null;
    setJob({ kind: "working", input, name, frames, scale, startedAt: Date.now(), progress: null });
    const id = ++idRef.current;
    if (workersRef.current.length === 0) {
      workersRef.current = createWorkerPool();
    }
    const workers = workersRef.current;

    try {
      let done: WorkerDone;
      if (scale !== 8 && !frames && needsTiling(input.w, input.h, scale)) {
        // Parallel multi-worker tiled execution across CPU cores
        const t0 = performance.now();
        const w = input.w;
        const h = input.h;
        const ow = w * scale;
        const oh = h * scale;
        const out = new Uint8ClampedArray(ow * oh * 4);

        const ranges = new Float64Array(8);
        for (let ch = 0; ch < 4; ch++) {
          let lo = 255;
          let hi = 0;
          for (let i = ch; i < input.data.length; i += 4) {
            const v = input.data[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          ranges[ch * 2] = lo;
          ranges[ch * 2 + 1] = hi;
        }

        const xBounds: number[] = [];
        for (let x = 0; x < w; x += TILE) xBounds.push(x);
        xBounds.push(w);
        const yBounds: number[] = [];
        for (let y = 0; y < h; y += TILE) yBounds.push(y);
        yBounds.push(h);

        interface TileTask {
          tileId: number;
          pixels: Uint8ClampedArray<ArrayBuffer>;
          pw: number;
          ph: number;
          vx0: number;
          vy0: number;
          vx1: number;
          vy1: number;
          px0: number;
          py0: number;
        }

        const tasks: TileTask[] = [];
        let nextTileId = 0;
        for (let cy = 0; cy < yBounds.length - 1; cy++) {
          for (let cx = 0; cx < xBounds.length - 1; cx++) {
            const vx0 = xBounds[cx];
            const vy0 = yBounds[cy];
            const vx1 = xBounds[cx + 1];
            const vy1 = yBounds[cy + 1];
            const px0 = Math.max(0, vx0 - HALO);
            const py0 = Math.max(0, vy0 - HALO);
            const px1 = Math.min(w, vx1 + HALO);
            const py1 = Math.min(h, vy1 + HALO);
            const pw = px1 - px0;
            const ph = py1 - py0;
            const tilePixels = new Uint8ClampedArray(pw * ph * 4);
            for (let y = 0; y < ph; y++) {
              const srcStart = ((py0 + y) * w + px0) * 4;
              const srcEnd = ((py0 + y) * w + px1) * 4;
              tilePixels.set(input.data.subarray(srcStart, srcEnd), y * pw * 4);
            }
            tasks.push({
              tileId: nextTileId++,
              pixels: tilePixels as Uint8ClampedArray<ArrayBuffer>,
              pw,
              ph,
              vx0,
              vy0,
              vx1,
              vy1,
              px0,
              py0,
            });
          }
        }

        const total = tasks.length;
        let doneCount = 0;
        let residual = 0;
        let taskIdx = 0;

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanupFns: (() => void)[] = [];
          const cleanup = () => {
            for (const fn of cleanupFns) fn();
            cleanupFns.length = 0;
          };

          const runNext = (wrk: Worker) => {
            if (settled) return;
            if (taskIdx < tasks.length) {
              const t = tasks[taskIdx++];
              wrk.postMessage(
                {
                  type: "tile",
                  id,
                  tileId: t.tileId,
                  pixels: t.pixels,
                  pw: t.pw,
                  ph: t.ph,
                  scale,
                  ranges,
                  vx0: t.vx0,
                  vy0: t.vy0,
                  vx1: t.vx1,
                  vy1: t.vy1,
                  px0: t.px0,
                  py0: t.py0,
                },
                { transfer: [t.pixels.buffer] },
              );
            }
          };

          for (const wrk of workers) {
            const handleMessage = (ev: MessageEvent) => {
              if (settled) return;
              const m = ev.data;
              if (m.id !== id) return;
              if (m.type === "error") {
                settled = true;
                cleanup();
                reject(new Error(m.message));
                return;
              }
              if (m.type !== "tileDone") return;

              const validW = (m.vx1 - m.vx0) * scale;
              const validH = (m.vy1 - m.vy0) * scale;
              const len = validW * 4;
              for (let y = 0; y < validH; y++) {
                const dstStart = (((m.vy0 * scale) + y) * ow + (m.vx0 * scale)) * 4;
                const srcStart = y * validW * 4;
                out.set(m.data.subarray(srcStart, srcStart + len), dstStart);
              }

              residual = Math.max(residual, m.residual);
              doneCount++;
              setJob((j) => (j.kind === "working" ? { ...j, progress: { done: doneCount, total } } : j));

              if (doneCount === total) {
                settled = true;
                cleanup();
                resolve();
                return;
              }

              runNext(wrk);
            };

            const handleError = (ev: ErrorEvent) => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(new Error(ev.message || "Worker error during tiling"));
            };

            wrk.addEventListener("message", handleMessage);
            wrk.addEventListener("error", handleError);
            cleanupFns.push(() => {
              wrk.removeEventListener("message", handleMessage);
              wrk.removeEventListener("error", handleError);
            });

            runNext(wrk);
          }
        });

        done = {
          type: "done",
          id,
          data: out as Uint8ClampedArray<ArrayBuffer>,
          w: ow,
          h: oh,
          residual,
          ms: performance.now() - t0,
        };
      } else {
        // Direct single-worker dispatch (burst or small image)
        const primaryWorker = workers[0];
        done = await new Promise((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            primaryWorker.removeEventListener("message", onMsg);
            primaryWorker.removeEventListener("error", onErr);
          };
          const onMsg = (ev: MessageEvent) => {
            if (settled) return;
            const m = ev.data;
            if (m.id !== id) return;
            if (m.type === "progress") {
              setJob((j) =>
                j.kind === "working" ? { ...j, progress: { done: m.done, total: m.total } } : j,
              );
              return;
            }
            settled = true;
            cleanup();
            if (m.type === "error") reject(new Error(m.message));
            else resolve(m as WorkerDone);
          };
          const onErr = (ev: ErrorEvent) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(ev.message || "Worker error during upscale"));
          };
          primaryWorker.addEventListener("message", onMsg);
          primaryWorker.addEventListener("error", onErr);
          if (frames && frames.length > 1) {
            const copies = frames.map((f) => new Uint8ClampedArray(f.data));
            primaryWorker.postMessage(
              { type: "burst", id, frames: copies, w: input.w, h: input.h, scale },
              { transfer: copies.map((c) => c.buffer) },
            );
          } else {
            const copy = new Uint8ClampedArray(input.data);
            primaryWorker.postMessage(
              { type: "run", id, pixels: copy, w: input.w, h: input.h, scale },
              { transfer: [copy.buffer] },
            );
          }
        });
      }

      startTransition(() => {
        if (!mountedRef.current) return;
        setJob({
          kind: "done",
          input,
          name,
          frames,
          scale,
          output: { data: done.data, w: done.w, h: done.h },
          residual: done.residual,
          ms: done.ms,
        });
      });
    } catch (e: unknown) {
      startTransition(() => {
        if (!mountedRef.current) return;
        setJob({
          kind: "error",
          input,
          name,
          frames,
          message: e instanceof Error ? e.message : "We couldn't process this image.",
        });
      });
    }
  }

  function cancel() {
    const cur = curRef.current;
    if (cur.kind !== "working") return;
    for (const w of workersRef.current) w.terminate();
    workersRef.current = createWorkerPool();
    startTransition(() => {
      setJob({
        kind: "ready",
        input: cur.input,
        name: cur.name,
        frames: cur.frames,
      });
    });
  }

  // Readable current job inside callbacks without stale closures.
  // Assigned in an effect (never during render) so upscale always sees
  // the latest job; events fire after effects, so this is always fresh.
  const curRef = useRef(job);
  useEffect(() => {
    curRef.current = job;
  }, [job]);

  return { job, openImage, openBurst, reset, upscale, cancel };
}

export async function decodeFile(
  f: File,
): Promise<{ image: StudioImage; name: string }> {
  const bmp = await createImageBitmap(f);
  try {
    const cap = 2048;
    const k = Math.min(1, cap / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    // Exact copy: getImageData buffers may be pooled/oversized, and ImageData
    // requires length === 4wh exactly. A view over a pooled buffer throws.
    const data = new Uint8ClampedArray(img.data);
    return {
      image: { data: data as Uint8ClampedArray<ArrayBuffer>, w, h },
      name: f.name,
    };
  } finally {
    bmp.close();
  }
}
