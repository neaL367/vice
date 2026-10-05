// Slab worker entry: share-nothing render host. Bundled to
// public/slab-worker.js; spawned by the coordinator (vice.worker).
// One WASM instance per worker, plain Workers only (no SAB, no COOP/COEP).

import { loadWasmModule, type ViceCoreInstance } from "../engine/wasm-module";
import { WasmMemory } from "../engine/wasm-memory";
import { renderSlab, type SlabInput } from "./render-slab";
import type {
  SlabIncoming,
  SlabOutgoing,
} from "./slab-protocol";

let corePromise: Promise<{ instance: ViceCoreInstance; threaded: boolean } | null> | null;

function ensureCore(base: string) {
  if (!corePromise) corePromise = loadWasmModule(base).catch(() => null);
  return corePromise;
}

function isWorkerScope(): boolean {
  return (
    typeof window === "undefined" &&
    typeof self !== "undefined" &&
    typeof (self as unknown as { postMessage?: unknown }).postMessage === "function"
  );
}

if (isWorkerScope()) {
  const scope = self as unknown as {
    addEventListener(type: "message", l: (e: MessageEvent<SlabIncoming>) => void): void;
    postMessage(msg: SlabOutgoing, transfer?: Transferable[]): void;
    close(): void;
  };

  scope.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "warm") {
      void ensureCore(msg.base).then(
        () => scope.postMessage({ type: "ready" }),
        (err: unknown) => scope.postMessage({ type: "fail", message: String(err) }),
      );
      return;
    }
    if (msg.type === "close") {
      scope.close();
      return;
    }
    void (async () => {
      try {
        const loaded = await ensureCore(msg.base);
        if (!loaded) throw new Error("slab worker: no WASM core");
        const mem = new WasmMemory(loaded.instance);
        const strip = new Float32Array(msg.input.strip);
        const input: SlabInput = {
          width: msg.input.width,
          height: msg.input.height,
          channels: 4,
          hasAlpha: msg.input.hasAlpha,
          icc: msg.input.icc ? new Uint8Array(msg.input.icc) : null,
          pushCap: msg.input.pushCap,
          getLinearStrip(y0: number, rows: number): Float32Array {
            const lo = y0 - msg.input.stripY0;
            if (lo < 0 || lo + rows > strip.length / (msg.input.width * 4)) {
              throw new Error(`slab input window miss [${y0}, ${y0 + rows})`);
            }
            return strip.slice(lo * msg.input.width * 4, (lo + rows) * msg.input.width * 4);
          },
        };
        const r = renderSlab(mem, input, msg.slab, msg.scale, msg.fused, msg.isLast);
        scope.postMessage(
          {
            type: "segment",
            id: msg.id,
            outY0: r.outY0,
            outRows: r.outRows,
            bytes: r.bytes,
            segment: r.segment,
            adler: r.adler,
            rawLen: r.rawLen,
            residual: r.residual,
          } satisfies SlabOutgoing,
          [r.bytes.buffer, r.segment.buffer],
        );
      } catch (err) {
        scope.postMessage({
          type: "segment",
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        } satisfies SlabOutgoing);
      }
    })();
  });
}
