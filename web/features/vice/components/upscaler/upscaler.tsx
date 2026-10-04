"use client";

import { memo, type ReactNode } from "react";
import { ViewTransition } from "react";
import { MAX_OUTPUT_MP } from "../../../../lib/limits";
import type { VicePreset, ViceScale } from "../../types/vice";
import { DownloadIcon, SpinnerIcon, UploadIcon } from "../studio-icons";
import { StudioDropzone } from "../studio-dropzone";
import { StudioStagedPreview } from "../studio-staged-preview";
import { Comparison } from "../comparison/comparison-view";
import { UpscalerProvider, useUpscaler } from "./upscaler-context";

const SCALES: readonly ViceScale[] = [2, 3, 4];

// --- 1. Root ---
function RootImpl({ children }: { children: ReactNode }) {
  const {
    fileInputRef,
    fileInputId,
    job,
    isDragOver,
    setIsDragOver,
  } = useUpscaler();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      job.pick(e.dataTransfer.files);
    }
  };

  return (
    <section
      aria-label="Vice studio upscaler"
      className="relative flex h-full w-full flex-1 flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        aria-label="Choose image to upscale"
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) job.pick(e.target.files);
        }}
      />

      {/* Full-width Drag Drop Overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-md">
          <div className="flex flex-col items-center gap-3 text-foreground">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-foreground/20 bg-foreground/5 shadow-sm">
              <UploadIcon className="h-6 w-6" />
            </div>
            <p className="text-base font-medium tracking-tight">
              Drop images to upscale
            </p>
            <p className="text-xs text-muted">
              PNG, JPEG, WebP · Up to {MAX_OUTPUT_MP} MP output
            </p>
          </div>
        </div>
      )}

      {children}
    </section>
  );
}

export function UpscalerRoot({ children }: { children: ReactNode }) {
  return (
    <UpscalerProvider>
      <RootImpl>{children}</RootImpl>
    </UpscalerProvider>
  );
}

// --- 2. Header ---
export const UpscalerHeader = memo(function UpscalerHeader({
  children,
}: {
  children?: ReactNode;
}) {
  return (
    <header
      style={{ viewTransitionName: "site-header" }}
      className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-hairline/60 bg-background/80 px-6 backdrop-blur-xl"
    >
      {children}
    </header>
  );
});

// --- 3. Brand & Status ---
export const UpscalerBrand = memo(function UpscalerBrand() {
  const { hasResults, selectedResult, stagedDims, job } = useUpscaler();

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">
          Vice
        </h1>
      </div>

      <span className="hidden h-3.5 w-px bg-hairline/70 sm:inline-block" />

      {hasResults && selectedResult ? (
        <div className="flex items-center gap-2 text-xs font-mono text-muted truncate">
          <span className="text-foreground font-medium">done</span>
          <span>·</span>
          <span>{selectedResult.backend}</span>
          <span>·</span>
          <span className="tabular-nums">
            {Math.round(selectedResult.outW / selectedResult.scale)}×
            {Math.round(selectedResult.outH / selectedResult.scale)} →{" "}
            {selectedResult.outW}×{selectedResult.outH}
          </span>
        </div>
      ) : stagedDims ? (
        <span className="hidden text-xs font-mono text-muted lg:inline-block">
          {stagedDims.w}×{stagedDims.h} → {stagedDims.w * job.scale}×
          {stagedDims.h * job.scale} ({job.scale}×)
        </span>
      ) : (
        <span className="hidden text-xs text-muted sm:inline-block font-mono">
          Consistent Super-Resolution
        </span>
      )}
    </div>
  );
});

// --- 4. Scale Selector ---
export const UpscalerScaleSelector = memo(function UpscalerScaleSelector() {
  const { job } = useUpscaler();

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Upscale factor"
        className="flex items-center rounded-full border border-hairline/80 bg-foreground/[0.03] p-0.5 shadow-2xs"
      >
        {SCALES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={job.running}
            onClick={() => job.setScale(s)}
            aria-pressed={job.scale === s}
            className={`rounded-full px-3.5 py-1 text-xs font-medium transition-all ${
              job.scale === s
                ? "bg-foreground text-background shadow-xs font-semibold"
                : "text-muted hover:text-foreground disabled:opacity-40"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      {job.scale === 4 && (
        <div
          role="group"
          aria-label="4x pass mode"
          className="hidden sm:flex items-center rounded-full border border-hairline/70 bg-foreground/[0.02] p-0.5 text-[11px]"
        >
          <button
            type="button"
            disabled={job.running}
            onClick={() => job.setChained4x(false)}
            className={`rounded-full px-2.5 py-0.5 transition-all ${
              !job.chained4x
                ? "bg-foreground text-background font-medium shadow-xs"
                : "text-muted hover:text-foreground disabled:opacity-40"
            }`}
            title="Direct 4× pass: optimal edge continuity"
          >
            Direct
          </button>
          <button
            type="button"
            disabled={job.running}
            onClick={() => job.setChained4x(true)}
            className={`rounded-full px-2.5 py-0.5 transition-all ${
              job.chained4x
                ? "bg-foreground text-background font-medium shadow-xs"
                : "text-muted hover:text-foreground disabled:opacity-40"
            }`}
            title="Chained 2××2× passes"
          >
            2××2×
          </button>
        </div>
      )}
    </div>
  );
});

// --- 5. Tuning Flyout Popover ---
export const UpscalerTuning = memo(function UpscalerTuning() {
  const { isQualityOpen, setIsQualityOpen, job } = useUpscaler();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsQualityOpen((curr) => !curr)}
        className="flex items-center gap-1.5 rounded-full border border-hairline/80 bg-foreground/[0.03] px-3 py-1 text-xs font-medium text-foreground transition-all hover:bg-foreground/[0.06] active:scale-95"
        title="Tune upscale preset, anti-ringing, null-space sharpness, and shock"
      >
        <span className="capitalize">{job.preset}</span>
        <span className="text-[10px] text-muted">
          · {Math.round(job.sharpness * 100)}%
        </span>
        <svg
          className="h-3 w-3 text-muted"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {isQualityOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsQualityOpen(false)}
          />
          <div className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-hairline/80 bg-background/95 p-3.5 shadow-2xl backdrop-blur-xl">
            {/* Preset Segmented Control */}
            <div className="mb-3">
              <label className="mb-1 block text-[11px] font-medium text-muted">
                Engine Preset
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-foreground/[0.04] p-0.5 text-xs">
                {(["photo", "smooth", "pixel-art"] as const).map((p: VicePreset) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => job.setPreset(p)}
                    className={`rounded-lg py-1 font-medium transition-all ${
                      job.preset === p
                        ? "bg-background text-foreground font-semibold shadow-xs"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {p === "pixel-art" ? "Pixel" : p === "smooth" ? "CGI" : "Photo"}
                  </button>
                ))}
              </div>
            </div>

            {/* Sharpness Slider */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted mb-1">
                <span>Null-Space Sharpness</span>
                <span className="font-mono text-foreground">
                  {Math.round(job.sharpness * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={job.sharpness}
                onChange={(e) => job.setSharpness(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-foreground/15 accent-foreground"
              />
            </div>

            {/* Shock Slider */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted mb-1">
                <span>Shock Edge Steepness</span>
                <span className="font-mono text-foreground">
                  {Math.round(job.shock * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={job.shock}
                onChange={(e) => job.setShock(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-foreground/15 accent-foreground"
              />
            </div>

            {/* Deringing Toggle */}
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-muted">Anti-Ringing Clamping</span>
              <button
                type="button"
                onClick={() => job.setDering(job.dering > 0 ? 0 : 1)}
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-all ${
                  job.dering > 0
                    ? "bg-foreground text-background"
                    : "border border-hairline text-muted"
                }`}
              >
                {job.dering > 0 ? "Enabled" : "Off"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// --- 6. Actions (New, Upscale, Download) ---
export const UpscalerActions = memo(function UpscalerActions() {
  const {
    hasResults,
    hasFiles,
    job,
    selectedResult,
    fileInputRef,
    exportFormat,
    setExportFormat,
    customFormatUrl,
  } = useUpscaler();

  return (
    <div className="flex items-center gap-2">
      {hasResults ? (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-foreground/[0.04] active:scale-95"
          >
            <UploadIcon className="h-3.5 w-3.5" />
            <span>New</span>
          </button>

          {hasFiles && (
            <button
              type="button"
              onClick={job.run}
              disabled={job.running}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-40 ${
                selectedResult && selectedResult.scale !== job.scale
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "border border-hairline/80 bg-background text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              {job.running ? (
                <>
                  <SpinnerIcon className="h-3 w-3 animate-spin" />
                  <span>Upscaling…</span>
                </>
              ) : selectedResult && selectedResult.scale !== job.scale ? (
                `Upscale ${job.scale}×`
              ) : job.files.length > 1 ? (
                `Upscale (${job.files.length})`
              ) : (
                "Upscale"
              )}
            </button>
          )}

          {job.results.length > 1 && (
            <button
              type="button"
              onClick={job.downloadZip}
              className="rounded-full border border-hairline/80 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-foreground/[0.04]"
            >
              Download all (.zip)
            </button>
          )}

          {job.zipUrl && (
            <a
              href={job.zipUrl}
              download="vice-batch.zip"
              className="text-xs text-accent underline underline-offset-4"
            >
              vice-batch.zip ready
            </a>
          )}

          {selectedResult && (
            <div className="flex items-center rounded-full border border-hairline/80 bg-foreground/[0.02] p-0.5 shadow-2xs">
              <div
                role="group"
                aria-label="Export format"
                className="hidden sm:flex items-center text-[11px] font-medium"
              >
                {(["png", "webp", "jpeg"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setExportFormat(fmt)}
                    className={`rounded-full px-2.5 py-1 transition-all ${
                      exportFormat === fmt
                        ? "bg-foreground text-background font-semibold shadow-2xs"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {fmt === "jpeg" ? "JPG" : fmt.toUpperCase()}
                  </button>
                ))}
              </div>

              <a
                href={
                  exportFormat !== "png" &&
                  customFormatUrl?.format === exportFormat &&
                  customFormatUrl.id === selectedResult.id
                    ? customFormatUrl.url
                    : selectedResult.blobUrl
                }
                download={`${selectedResult.name.replace(/\.[^.]*$/, "") || "image"}-vice${selectedResult.scale}x.${
                  exportFormat === "jpeg" ? "jpg" : exportFormat
                }`}
                className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1 text-xs font-semibold text-background shadow-xs transition-all hover:opacity-90 active:scale-95"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                <span>
                  {exportFormat === "png"
                    ? "Download PNG"
                    : exportFormat === "webp"
                    ? "Download WebP"
                    : "Download JPG"}
                </span>
              </a>
            </div>
          )}
        </>
      ) : (
        <>
          {hasFiles && !job.running && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full border border-hairline/80 bg-background px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-all"
            >
              Change
            </button>
          )}

          <button
            type="button"
            onClick={hasFiles ? job.run : () => fileInputRef.current?.click()}
            disabled={job.running}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-1.5 text-xs font-semibold text-background shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          >
            {job.running ? (
              <>
                <SpinnerIcon className="h-3 w-3 animate-spin" />
                <span>Upscaling…</span>
              </>
            ) : hasFiles ? (
              job.files.length > 1 ? (
                `Upscale ${job.files.length}`
              ) : (
                "Upscale"
              )
            ) : (
              "Choose image"
            )}
          </button>

          {job.running && (
            <button
              type="button"
              onClick={job.cancel}
              className="rounded-full border border-hairline/80 px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  );
});

// --- 7. Staged Files Bar ---
export const UpscalerStagedBar = memo(function UpscalerStagedBar() {
  const { job } = useUpscaler();
  if (job.files.length === 0) return null;

  return (
    <div className="z-20 flex items-center gap-2 border-b border-hairline/40 bg-foreground/[0.015] px-6 py-1.5 overflow-x-auto">
      <span className="text-[11px] text-muted font-medium">Staged:</span>
      {job.files.map((f) => (
        <div
          key={f.previewUrl}
          className="flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background px-2.5 py-0.5 text-xs text-foreground shadow-2xs"
        >
          <span className="max-w-[120px] truncate">{f.file.name}</span>
          <button
            type="button"
            aria-label={`Remove ${f.file.name}`}
            onClick={() => job.removeFile(f.previewUrl)}
            className="text-muted hover:text-foreground ml-0.5"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
});

// --- 8. Status & Error Bar ---
export const UpscalerStatusBar = memo(function UpscalerStatusBar() {
  const { job } = useUpscaler();

  return (
    <>
      {job.running && job.progress !== "" && (
        <div className="z-20 flex h-7 items-center justify-between border-b border-hairline/40 bg-foreground/[0.02] px-6 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            <span aria-live="polite" className="font-mono text-[11px] tabular-nums">
              {job.progress}
            </span>
          </div>
          <span className="text-[11px] font-mono text-muted/70">100% on-device</span>
        </div>
      )}

      {job.error !== "" && (
        <div
          role="alert"
          className="z-20 flex items-center justify-between border-b border-red-500/20 bg-red-500/5 px-6 py-2 text-xs text-red-600 dark:text-red-400"
        >
          <span>{job.error}</span>
          <button
            type="button"
            onClick={job.run}
            className="font-medium underline underline-offset-4 hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
});

// --- 9. Stage (Canvas / Comparison / Dropzone) ---
export const UpscalerStage = memo(function UpscalerStage() {
  const {
    hasResults,
    selectedResult,
    hasFiles,
    stagedFile,
    stagedDims,
    job,
    fileInputId,
    onImageLoad,
  } = useUpscaler();

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      {hasResults && selectedResult ? (
        <ViewTransition
          key={`result-${selectedResult.id}`}
          name="studio-stage"
          share="auto"
          enter="slide-up"
          exit="slide-down"
          default="none"
        >
          <Comparison.Root
            key={selectedResult.id}
            result={selectedResult}
            allResults={job.results}
            onSelectId={job.setSelectedId}
          >
            <Comparison.Viewport />
            <Comparison.BatchStrip />
            <Comparison.Hud />
          </Comparison.Root>
        </ViewTransition>
      ) : hasFiles && stagedFile ? (
        <ViewTransition
          key={`staged-${stagedFile.previewUrl}`}
          name="studio-stage"
          share="auto"
          enter="slide-up"
          exit="slide-down"
          default="none"
        >
          <StudioStagedPreview
            file={stagedFile}
            scale={job.scale}
            dims={stagedDims}
            running={job.running}
            onImageLoad={onImageLoad}
            onRun={job.run}
          />
        </ViewTransition>
      ) : (
        <ViewTransition
          key="dropzone"
          name="studio-stage"
          share="auto"
          enter="slide-up"
          exit="slide-down"
          default="none"
        >
          <StudioDropzone inputId={fileInputId} />
        </ViewTransition>
      )}
    </div>
  );
});

// Export the compound namespace object
export const Upscaler = {
  Root: UpscalerRoot,
  Header: UpscalerHeader,
  Brand: UpscalerBrand,
  ScaleSelector: UpscalerScaleSelector,
  Tuning: UpscalerTuning,
  Actions: UpscalerActions,
  StagedBar: UpscalerStagedBar,
  StatusBar: UpscalerStatusBar,
  Stage: UpscalerStage,
  Comparison,
};
