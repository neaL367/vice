// Sub-worker transport: one plain Worker per bucket, share-nothing.
// Each worker loads its own single-thread WASM core (no SAB, no COOP/COEP).
// Input strips are sliced by the coordinator and transferred (neutered on
// send); segments come back transferred the same way.

import type { Slab } from "../slabs/geometry";
import { slabInputWindow, type SlabRunner, type SlabSegment } from "./render-slab";
import type { SlabIncoming, SlabOutgoing } from "./slab-protocol";

export interface SubworkerSpec {
  workerUrl: string;
  base: string;
  inW: number;
  inH: number;
  hasAlpha: boolean;
  icc: number[] | null;
  scale: 2 | 3 | 4;
  fused: 0 | 1 | 2;
  haloTop: number;
  haloBottom: number;
  getStrip: (y0: number, rows: number) => Float32Array;
  signal?: AbortSignal;
}

/** Spawn one worker; resolves when its ready handshake completes. */
export function spawnSubworker(
  workerUrl: string,
  base: string,
  signal?: AbortSignal,
): Promise<Worker> {
  const worker = new Worker(workerUrl, { type: "module" });
  return new Promise<Worker>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      try {
        worker.terminate();
      } catch {
        // Already gone.
      }
      reject(new Error("slab worker boot timeout"));
    }, 15000);
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal?.removeEventListener("abort", abort);
    };
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as SlabOutgoing;
      if (msg.type === "ready") {
        cleanup();
        resolve(worker);
      }
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || "slab worker failed to boot"));
    };
    const abort = () => {
      cleanup();
      try {
        worker.terminate();
      } catch {
        // Already gone.
      }
      reject(new DOMException("cancelled", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ type: "warm", base } satisfies SlabIncoming);
  });
}

let renderId = 0;

/** Runner bound to one live sub-worker: slabs run sequentially on it. */
export function subworkerRunner(worker: Worker, spec: SubworkerSpec): SlabRunner {
  const pending = new Map<number, { resolve: (v: SlabSegment) => void; reject: (e: unknown) => void }>();
  const onMessage = (e: MessageEvent) => {
    const msg = e.data as SlabOutgoing;
    if (msg.type !== "segment" || !("id" in msg)) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if ("error" in msg && typeof msg.error === "string") {
      p.reject(new Error(msg.error));
    } else {
      p.resolve(msg as SlabSegment);
    }
  };
  const onError = (e: ErrorEvent) => {
    const err = new Error(e.message || "slab worker died");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  spec.signal?.addEventListener(
    "abort",
    () => {
      try {
        worker.terminate();
      } catch {
        // Already gone.
      }
      for (const p of pending.values()) p.reject(new DOMException("cancelled", "AbortError"));
      pending.clear();
    },
    { once: true },
  );

  return (slab: Slab, isLast: boolean): Promise<SlabSegment> => {
    if (spec.signal?.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
    const { inY0 } = slabInputWindow(slab, spec.scale, spec.haloTop);
    const ownedIn1 = Math.ceil((slab.outY0 + slab.outRows) / spec.scale);
    const winY1 = Math.min(spec.inH, ownedIn1 + spec.haloBottom);
    const strip = spec.getStrip(inY0, winY1 - inY0);
    const id = renderId++;
    const done = new Promise<SlabSegment>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    // Full dims for global math; pushes capped at the window end.
    const fullH = spec.inH;
    worker.postMessage(
      {
        type: "render",
        id,
        base: spec.base,
        slab,
        scale: spec.scale,
        fused: spec.fused,
        isLast,
        input: {
          width: spec.inW,
          height: fullH,
          pushCap: winY1,
          hasAlpha: spec.hasAlpha,
          icc: spec.icc,
          stripY0: inY0,
          strip: strip.buffer as ArrayBuffer,
        },
      } satisfies SlabIncoming,
      [strip.buffer as ArrayBuffer],
    );
    return done;
  };
}
