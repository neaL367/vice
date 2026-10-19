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

const deviceMemoryGB = (nav: Navigator | undefined): number =>
  nav ? ((nav as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) : 8;

const POOL_SIZE = (() => {
  if (typeof navigator === "undefined") return 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = deviceMemoryGB(navigator);
  // Memory-bound cap: 2GB devices tolerate 2 workers, 4GB → 4, more → 8.
  const memCap = mem <= 2 ? 2 : mem <= 4 ? 4 : 8;
  return Math.min(Math.max(1, cores), 8, Math.max(1, memCap));
})();

function spawnOneWorker(): Worker {
  return new Worker(new URL("../../workers/vice.worker.ts", import.meta.url));
}

function createWorkerPool(): Worker[] {
  const pool: Worker[] = [];
  for (let i = 0; i < POOL_SIZE; i++) pool.push(spawnOneWorker());
  return pool;
}

export function useStudioJob() {
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const workersRef = useRef<Worker[]>([]);
  const idRef = useRef(0);
  const mountedRef = useRef(true);
  // Reject register for the in-flight upscale promise: cancel() settles it
  // BEFORE terminating the pool, so the big output/tile closures actually
  // unwind instead of parking worker memory forever.
  const rejectRef = useRef<((reason: Error) => void) | null>(null);
  const [, startTransition] = useTransition();

  function ensurePool(): Worker[] {
    if (workersRef.current.length === 0) workersRef.current = createWorkerPool();
    return workersRef.current;
  }

  useEffect(() => {
    mountedRef.current = true;
    // Warm the pool at mount, not at first job: offline usage must find the
    // pool already compiled, and spawn-on-load also pays script-compile cost
    // off the critical upscale path. Worker-internal importScripts chunks are
    // precached at SW install (see scripts/generate-sw-precache.mjs), so this
    // spawn cannot miss its module graph.
    ensurePool();
    return () => {
      mountedRef.current = false;
      rejectRef.current?.(new Error("unmounted"));
      rejectRef.current = null;
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
    const workers = ensurePool();

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
            rejectRef.current = null;
          };
          rejectRef.current = reject;

          // Self-healing dispatch: a worker that dies mid-job (e.g. boot-race
          // with the SW cache on an offline reload) gets its in-flight tile
          // requeued onto a respawned slot, within a respawn budget; past the
          // budget the job rejects. Requeues always go to the task tail —
          // other workers pick them up when they finish their current tile.
          let respawnBudget = workers.length * 2;
          const slotState = new Map<Worker, { tile: TileTask | null }>();

          const runNext = (wrk: Worker) => {
            if (settled) return;
            if (taskIdx < tasks.length) {
              const t = tasks[taskIdx++];
              slotState.get(wrk)!.tile = t;
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

          const attach = (wrk: Worker) => {
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
              slotState.get(wrk)!.tile = null;

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
              const sts = slotState.get(wrk);
              if (!sts) return;
              // The tile may still be undelivered (worker died before
              // reporting) — requeue it for another worker.
              if (sts.tile) {
                tasks.push(sts.tile);
                sts.tile = null;
              }
              wrk.removeEventListener("message", handleMessage);
              wrk.removeEventListener("error", handleError);
              if (respawnBudget-- > 0) {
                const nw = spawnOneWorker();
                const idx = workersRef.current.indexOf(wrk);
                if (idx >= 0) workersRef.current[idx] = nw;
                slotState.set(nw, { tile: null });
                attach(nw);
                runNext(nw);
                return;
              }
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
          };

          for (const wrk of workers) {
            slotState.set(wrk, { tile: null });
            attach(wrk);
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
            rejectRef.current = null;
          };
          rejectRef.current = reject;
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
      // cancel()/unmount reject with an owned message and already set the
      // right state; surfacing it again here would overwrite that state.
      if (e instanceof Error && (e.message === "cancelled" || e.message === "unmounted")) return;
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
    // Settle the pending promise FIRST (freeing the output/tile closures),
    // then drop the pool. Catch above swallows the owned reason.
    rejectRef.current?.(new Error("cancelled"));
    rejectRef.current = null;
    for (const w of workersRef.current) w.terminate();
    workersRef.current = createWorkerPool();
    startTransition(() => {
      setJob({
        kind: "ready",
        input: cur.input,
        name: cur.name,
        frames: cur.frames ?? null,
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
    const read = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D): Uint8ClampedArray =>
      new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data);
    let data: Uint8ClampedArray;
    if (typeof OffscreenCanvas === "function") {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bmp, 0, 0, w, h);
      data = read(ctx);
    } else {
      // Older Safari: no OffscreenCanvas — decode through a detached canvas.
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bmp, 0, 0, w, h);
      data = read(ctx);
    }
    return {
      image: { data: data as Uint8ClampedArray<ArrayBuffer>, w, h },
      name: f.name,
    };
  } finally {
    bmp.close();
  }
}
