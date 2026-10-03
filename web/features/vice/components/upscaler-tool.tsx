"use client";

import { memo, useId, useState } from "react";
import { useViceJob } from "../hooks/use-vice-job";
import type { ViceResult, ViceScale } from "../types/vice";

const SCALES: readonly ViceScale[] = [2, 3, 4];
const ZOOMS: readonly number[] = [1, 2, 4];

// Client leaf: composes hook state + memoized leaves. No fetch, no URL
// juggling, no pipeline import — the hook lazy-loads the worker chunk.
export function UpscalerTool() {
  const job = useViceJob();
  const inputId = useId();
  const selected: ViceResult | undefined =
    job.results.find((r) => r.id === job.selectedId) ?? job.results[0];

  return (
    <section aria-label="Vice upscaler" className="flex w-full flex-col gap-6">
      <label
        htmlFor={inputId}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          job.pick(e.dataTransfer.files);
        }}
        className="cursor-pointer rounded-3xl border border-dashed border-hairline p-12 text-center transition-colors hover:border-muted"
      >
        {job.files.length > 0 ? (
          <span className="flex flex-wrap justify-center gap-3">
            {job.files.map((f) => (
              // Blob URLs can't use next/image optimization; plain img correct.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={f.previewUrl}
                src={f.previewUrl}
                alt={f.file.name}
                className="max-h-24 rounded-xl ring-1 ring-hairline"
              />
            ))}
          </span>
        ) : (
          <span className="block">
            <span className="block text-xs uppercase tracking-[0.25em] text-muted">
              Drop images
            </span>
            <span className="mt-3 block text-muted">
              PNG, JPEG, or WebP — or click to browse. Files never leave this device.
            </span>
          </span>
        )}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        aria-label="Choose images to upscale"
        className="sr-only"
        onChange={(e) => job.pick(e.target.files)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Upscale factor"
          className="flex items-center gap-1 rounded-full border border-hairline p-1"
        >
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => job.setScale(s)}
              aria-pressed={job.scale === s}
              className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                job.scale === s
                  ? "bg-foreground text-background"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={job.run}
          disabled={job.files.length === 0 || job.running}
          className="ml-auto rounded-full bg-foreground px-6 py-2.5 text-sm font-medium tracking-wide text-background transition-opacity disabled:opacity-40"
        >
          {job.running ? "Working…" : job.files.length > 1 ? `Upscale ${job.files.length}` : "Upscale"}
        </button>
        {job.running ? (
          <button
            type="button"
            onClick={job.cancel}
            className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {job.progress !== "" ? (
        <p aria-live="polite" className="text-sm tabular-nums text-muted">{job.progress}</p>
      ) : null}
      {job.error !== "" ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{job.error}</p>
      ) : null}

      {job.results.length > 1 ? (
        <div role="group" aria-label="Results" className="flex flex-wrap gap-x-4 gap-y-1">
          {job.results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => job.setSelectedId(r.id)}
              aria-pressed={selected?.id === r.id}
              title={r.name}
              className={`px-1 py-1 text-xs underline-offset-4 ${
                selected?.id === r.id ? "text-foreground underline" : "text-muted hover:text-foreground"
              }`}
            >
              {r.name.length > 18 ? `${r.name.slice(0, 17)}…` : r.name}
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <>
          <CompareSlider before={selected.previewUrl} after={selected.blobUrl} />
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={selected.blobUrl}
              download={`${selected.name.replace(/\.[^.]*$/, "") || "image"}-vice${selected.scale}x.png`}
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
            >
              Download PNG
            </a>
            {job.results.length > 1 ? (
              <button
                type="button"
                onClick={job.downloadZip}
                className="rounded-full border border-hairline px-5 py-2 text-sm hover:border-muted"
              >
                Download all (.zip)
              </button>
            ) : null}
            {job.zipUrl ? (
              <a href={job.zipUrl} download="vice-batch.zip" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
                vice-batch.zip ready
              </a>
            ) : null}
            <span className="text-xs tabular-nums text-muted">
              {selected.outW}×{selected.outH} · residual {selected.residual.toExponential(2)}
            </span>
          </div>
          <p className="text-xs text-muted">{selected.backend}</p>
        </>
      ) : null}

      <p className="border-t border-hairline pt-4 text-xs leading-relaxed text-muted">
        Guarantee: shrink result back and you recover input. New detail plausible,
        not true. Engine on backend line above: neural when model loads, bilinear
        fallback otherwise.
      </p>
    </section>
  );
}

// Single-use leaf: inlined per components.md (one call site, same client
// boundary). Memoized so slider/zoom never re-render the tool.
const CompareSlider = memo(function CompareSlider({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const sliderId = useId();

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div role="group" aria-label="Zoom" className="flex items-center gap-1 rounded-full border border-hairline p-1">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              aria-pressed={zoom === z}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                zoom === z ? "bg-foreground text-background" : "text-muted hover:text-foreground"
              }`}
            >
              {z}×
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">scroll to pan when zoomed</span>
      </div>
      <div className="overflow-auto rounded-2xl border border-hairline" style={{ maxHeight: "70vh" }}>
        <div
          className="relative overflow-hidden"
          style={{ aspectRatio: "4/3", zoom }}
        >
          {/* Blob URLs can't use next/image optimization; plain img correct. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={after} alt="upscaled result" className="absolute inset-0 h-full w-full object-contain" />
          <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={before}
              alt="original"
              className="absolute inset-0 h-full w-full object-contain bg-white"
              style={{ width: "100vw", maxWidth: "none" }}
            />
          </div>
          <div aria-hidden className="absolute inset-y-0" style={{ left: `${pos}%` }}>
            <div className="h-full w-0.5 bg-white shadow" />
          </div>
        </div>
      </div>
      <label htmlFor={sliderId} className="mt-3 flex items-center gap-3 text-sm text-muted">
        Before / after
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label="Before after slider"
          className="w-full accent-accent"
        />
      </label>
    </div>
  );
});

export function UpscalerToolSkeleton() {
  return <div aria-hidden className="h-[560px] w-full animate-pulse rounded-3xl bg-foreground/[0.04] dark:bg-white/[0.06]" />;
}
