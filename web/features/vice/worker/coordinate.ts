// Coordinator: decode once, fan out fixed slabs, assemble in order.
// Runs inside vice.worker (decode + fan-out + assembly) with pluggable
// transports: real sub-Workers (share-nothing) or inline (K==1, tests,
// fallback). Same bytes either way: slab geometry never depends on K.

import type { ChunkSink, ExportTarget, RenderResultMeta } from "../contracts/render-contracts";
import type { ViceProgress, ViceScale } from "../types/vice";
import { decodeInputImage, type DecodedImage } from "./decode-input";
import { loadWasmModule, type ViceCoreInstance } from "../engine/wasm-module";
import { WasmMemory } from "../engine/wasm-memory";
import { planSlabs, assignSlabs, type Slab } from "../slabs/geometry";
import { renderSlab, type SlabInput, type SlabRunner, type SlabSegment } from "./render-slab";
import {
  fileHeader,
  idatChunk,
  adlerTrailer,
  iendChunk,
  receiptChunk,
  ZLIB_HEADER,
  type Receipt,
} from "../slabs/assemble";
import { adlerCombine } from "../slabs/crc";
import { EXPECTED_ABI_VERSION } from "../engine/wasm-module";
import { BlobSink } from "../export/blob-sink";
import { OpfsSink } from "../export/opfs-sink";
import { PreviewAccumulator } from "./emit-preview";
import { sanitizeStem } from "../planner/names";
import { planRender, type DeviceFacts } from "../planner/plan";
import { probeImage } from "../planner/probe";
import { maxStreamPixels } from "../../../lib/limits";

let coreCache: {
  key: string;
  promise: Promise<{ instance: ViceCoreInstance; threaded: boolean } | null>;
} | null = null;

export function ensureCore(
  base: string,
): Promise<{ instance: ViceCoreInstance; threaded: boolean } | null> {
  if (!coreCache || coreCache.key !== base) {
    coreCache = { key: base, promise: loadWasmModule(base).catch(() => null) };
  }
  return coreCache.promise;
}

export interface CoordinateOptions {
  file: File;
  scale: ViceScale;
  chained4x?: boolean;
  preferSave: "blob" | "file" | "folder";
  fileCount: number;
  device: DeviceFacts;
  base: string;
  target: ExportTarget;
  streamThresholdPx?: number;
  onProgress: (p: ViceProgress) => void;
  onStripPng?: (png: Uint8Array, index: number, total: number) => Promise<void>;
  signal?: AbortSignal;
  /** Per-bucket transports (real sub-workers). Null/missing bucket runs inline. */
  makeRunner?: (bucket: Slab[], index: number) => SlabRunner | Promise<SlabRunner> | null;
  /** Decode override (tests inject DOM-free fixtures). */
  decode?: (file: File, signal?: AbortSignal) => Promise<DecodedImage>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
}

export async function runCoordinatedJob(
  opts: CoordinateOptions,
): Promise<{ blob: Blob; meta: RenderResultMeta }> {
  const { file, scale, signal } = opts;
  const t0 = performance.now();
  throwIfAborted(signal);

  const probe = probeImage(new Uint8Array(await file.arrayBuffer()));
  const loadedCore = opts.base ? await ensureCore(opts.base) : null;
  const core = loadedCore?.instance ?? null;
  if (!core) {
    throw new Error("Vice requires WebAssembly to upscale images. Native engine not available.");
  }
  const mem = new WasmMemory(core);
  const estimate = (w: number, h: number, s: number, c: number, b: number, f: number): number => {
    const fn = mem.instance._vice_stream_memory_bytes;
    if (!fn) throw new Error("stale WASM core: vice_stream_memory_bytes missing");
    return fn(w, h, s, c, b, f);
  };
  const outW = probe.w * scale;
  const outH = probe.h * scale;
  const outMP = (outW * outH) / 1_000_000;
  const blobCapPx = opts.streamThresholdPx ?? maxStreamPixels();
  const plan = planRender(
    probe,
    { scale, chained4x: !!opts.chained4x, fileCount: opts.fileCount, preferSave: opts.preferSave },
    opts.device,
    estimate,
    () => outMP * 1_000_000 > blobCapPx,
  );

  const decoded = await (opts.decode ?? decodeInputImage)(file, signal);
  try {
    const fused = plan.policy === "clean" ? 1 : 0;
    const geometry = planSlabs(outW, outH, scale);
    const buckets = assignSlabs(geometry.slabs, plan.workers);
    const outCh = decoded.hasAlpha ? 4 : 3;
    const isSaveToDisk = opts.target.kind !== "blob";
    const backend =
      plan.policy === "clean" ? "Lanczos-3 stream 2×2×" : isSaveToDisk ? "Lanczos-3 stream" : "Lanczos-3";

    const slabInput: SlabInput = {
      width: decoded.width,
      height: decoded.height,
      channels: 4,
      hasAlpha: decoded.hasAlpha,
      icc: decoded.icc,
      getLinearStrip: (y0, rows) => decoded.getLinearStrip(y0, rows),
    };
    const runners: SlabRunner[] = [];
    for (let i = 0; i < buckets.length; i++) {
      const via = await opts.makeRunner?.(buckets[i], i);
      if (via) {
        runners.push(via);
      } else {
        runners.push(async (slab: Slab, isLast: boolean, sig?: AbortSignal) =>
          renderSlab(mem, slabInput, slab, scale, fused as 0 | 1 | 2, isLast, sig ?? signal),
        );
      }
    }
    const actualWorkers = runners.length;

    const preview = new PreviewAccumulator(outW, outH);
    const report = (completedRows: number, stage = "Rendering…") => {
      opts.onProgress({ band: completedRows, totalBands: outH, stage, backend });
    };

    // Ordered emission state.
    let nextY = 0;
    let completedRows = 0;
    let residual = 0;
    let fileBytes = 0;
    let adler = 1;

    // Sink routing. Blob/file stream framed bytes; strips post per-slab
    // PNGs to main; opfs temp lives in-worker (export-later is P7).
    const wantStrips = plan.sink.kind === "strips";
    const wantOpfs = plan.sink.kind === "opfs";
    let chunkSink: ChunkSink | null = null;
    let blobSink: BlobSink | null = null;
    let opfsSink: OpfsSink | null = null;
    const stem = sanitizeStem(file.name.replace(/\.[^.]*$/, "") || "image") + `-vice${scale}x`;
    if (!wantStrips) {
      if (opts.target.kind === "file") {
        chunkSink = opts.target.sink;
      } else if (wantOpfs) {
        opfsSink = await OpfsSink.create(stem + ".png");
        chunkSink = opfsSink;
      } else {
        blobSink = new BlobSink();
        chunkSink = blobSink;
      }
      if (plan.sink.kind === "folder" && opts.target.kind !== "file") {
        throw new Error("folder plan needs a file target");
      }
      await chunkSink.write(await fileHeader(outW, outH, outCh, decoded.icc));
      const zh = idatChunk(ZLIB_HEADER);
      await chunkSink.write(zh.bytes);
      fileBytes += zh.bytes.length;
    }

    const emitOne = async (seg: SlabSegment): Promise<void> => {
      preview.feedBand(seg.bytes, seg.outY0, seg.outRows);
      if (wantStrips) {
        if (!opts.onStripPng) throw new Error("strips plan needs onStripPng");
        const head = await fileHeader(outW, seg.outRows, outCh, decoded.icc);
        const body = idatChunk(
          new Uint8Array([...ZLIB_HEADER, ...seg.segment, ...adlerTrailer(seg.adler)]),
        );
        const index = geometry.slabs.findIndex((s) => s.outY0 === seg.outY0);
        const receipt: Receipt = {
          v: 1,
          algo: 2,
          abi: EXPECTED_ABI_VERSION,
          scale,
          policy: plan.policy,
          operator: "box-encoded-exact",
          bandRows: 64,
          slabBands: 8,
          in: { w: probe.w, h: probe.h },
          out: { w: outW, h: outH },
          slab: index,
          slabs: geometry.slabs.length,
        };
        const tail = new Uint8Array([...receiptChunk(receipt), ...iendChunk()]);
        const png = new Uint8Array(head.length + body.bytes.length + tail.length);
        png.set(head, 0);
        png.set(body.bytes, head.length);
        png.set(tail, head.length + body.bytes.length);
        await opts.onStripPng(png, index, geometry.slabs.length);
        fileBytes += png.length;
        return;
      }
      if (!chunkSink) throw new Error("no sink");
      const framed = idatChunk(seg.segment);
      await chunkSink.write(framed.bytes);
      fileBytes += framed.bytes.length;
      adler = adlerCombine(adler, seg.adler, seg.rawLen);
    };

    const runBucket = async (bucket: Slab[], runner: SlabRunner): Promise<void> => {
      for (const slab of bucket) {
        throwIfAborted(signal);
        // Standalone strip PNGs need FINISH-terminated segments each.
        const isLast = wantStrips ? true : slab.index === geometry.slabs.length - 1;
        const r = await runner(slab, isLast, signal);
        completedRows += slab.outRows;
        report(completedRows);
        await drainQueue(r);
      }
    };

    // Owned bytes ride with segments; drain in slab order.
    const queue = new Map<number, SlabSegment>();
    const drainQueue = async (fresh: SlabSegment): Promise<void> => {
      queue.set(fresh.outY0, fresh);
      for (;;) {
        const next = queue.get(nextY);
        if (!next) break;
        queue.delete(nextY);
        if (next.residual > residual) residual = next.residual;
        await emitOne(next);
        nextY += next.outRows;
      }
    };

    await Promise.all(buckets.map((bucket, i) => runBucket(bucket, runners[i])));
    if (nextY !== outH) throw new Error(`short render ${nextY}/${outH}`);
    throwIfAborted(signal);

    const wantPreview = wantStrips || opfsSink || (chunkSink && !blobSink);
    let blob: Blob;
    const durationMs = Math.round(performance.now() - t0);
    if (chunkSink && !wantStrips) {
      const receipt: Receipt = {
        v: 1,
        algo: 2,
        abi: EXPECTED_ABI_VERSION,
        scale,
        policy: plan.policy,
        operator: "box-encoded-exact",
        bandRows: 64,
        slabBands: 8,
        in: { w: probe.w, h: probe.h },
        out: { w: outW, h: outH },
      };
      const tr = idatChunk(adlerTrailer(adler));
      await chunkSink.write(tr.bytes);
      fileBytes += tr.bytes.length;
      await chunkSink.write(receiptChunk(receipt));
      await chunkSink.write(iendChunk());
      await chunkSink.close();
    }
    if (wantPreview) {
      // File/opfs/strips targets: small preview blob (was: empty dummy blob).
      blob = await preview.toBlob();
    } else if (blobSink) {
      // Snapshot AFTER the trailer: getBlob freezes accumulated chunks.
      blob = blobSink.getBlob();
    } else {
      throw new Error("no result blob");
    }
    if (opfsSink) {
      // Kept on disk; main shows the saved row from meta below (P7: export).
    }

    const savedToDisk = !!opfsSink || (opts.target.kind === "file" && !wantStrips);
    return {
      blob,
      meta: {
        residual,
        backend,
        outW,
        outH,
        hasIcc: !!decoded.icc,
        chained4x: plan.policy === "clean",
        durationMs,
        savedToDisk: savedToDisk || undefined,
        fileName: opfsSink ? opfsSink.fileName : undefined,
        fileBytes: savedToDisk || wantStrips ? fileBytes : undefined,
        threads: actualWorkers,
      },
    };
  } finally {
    decoded.close();
  }
}
