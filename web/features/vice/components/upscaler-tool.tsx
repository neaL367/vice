"use client";

import { useCallback, useEffect, useId, useRef, useState, ViewTransition } from "react";
import { MAX_OUTPUT_MP } from "../../../lib/limits";
import { useViceJob } from "../hooks/use-vice-job";
import type { ViceResult, ViceScale } from "../types/vice";
import { StudioComparisonView } from "./studio-comparison-view";
import { StudioDropzone } from "./studio-dropzone";
import { DownloadIcon, SpinnerIcon, UploadIcon } from "./studio-icons";
import { StudioStagedPreview } from "./studio-staged-preview";

const SCALES: readonly ViceScale[] = [2, 3, 4];

export function UpscalerTool() {
  const job = useViceJob();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [fileDimensions, setFileDimensions] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const [exportFormat, setExportFormat] = useState<"png" | "webp" | "jpeg">("png");
  const [customFormatUrl, setCustomFormatUrl] = useState<{
    format: string;
    url: string;
    id: number;
  } | null>(null);

  const selectedResult: ViceResult | undefined =
    job.results.find((r) => r.id === job.selectedId) ?? job.results[0];
  const hasResults = job.results.length > 0;
  const hasFiles = job.files.length > 0;

  const stagedFile = job.files[0];
  const stagedDims = stagedFile
    ? fileDimensions[stagedFile.previewUrl]
    : undefined;

  const onImageLoad = useCallback(
    (url: string, e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (img.naturalWidth && img.naturalHeight) {
        setFileDimensions((prev) => ({
          ...prev,
          [url]: { w: img.naturalWidth, h: img.naturalHeight },
        }));
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedResult || exportFormat === "png") return;
    let active = true;
    const mime = exportFormat === "webp" ? "image/webp" : "image/jpeg";
    const img = new Image();
    img.src = selectedResult.blobUrl;
    img.onload = () => {
      if (!active) return;
      const canvas = document.createElement("canvas");
      canvas.width = selectedResult.outW;
      canvas.height = selectedResult.outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (exportFormat === "jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!active || !blob) return;
          const url = URL.createObjectURL(blob);
          setCustomFormatUrl({ format: exportFormat, url, id: selectedResult.id });
        },
        mime,
        0.92
      );
    };
    return () => {
      active = false;
    };
  }, [selectedResult, exportFormat]);

  useEffect(() => {
    return () => {
      if (customFormatUrl?.url && customFormatUrl.url.startsWith("blob:")) {
        URL.revokeObjectURL(customFormatUrl.url);
      }
    };
  }, [customFormatUrl]);

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
            <p className="text-xs text-muted">PNG, JPEG, WebP · Up to {MAX_OUTPUT_MP} MP output</p>
          </div>
        </div>
      )}

      {/* Sleek Studio Header (Single Line, Full Width) */}
      <header
        style={{ viewTransitionName: "site-header" }}
        className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-hairline/60 bg-background/90 px-6 backdrop-blur-md"
      >
        {/* Left: Brand & Engine Meta */}
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Vice
          </h1>
          <span className="hidden h-3.5 w-px bg-hairline sm:inline-block" />
          {hasResults && selectedResult ? (
            <span className="text-xs font-mono text-muted">
              done · Lanczos-3 · {selectedResult.outW}×{selectedResult.outH}
            </span>
          ) : stagedDims ? (
            <span className="hidden text-xs font-mono text-muted lg:inline-block">
              Lanczos-3 Engine · {stagedDims.w * job.scale}×{stagedDims.h * job.scale}
            </span>
          ) : (
            <span className="hidden text-xs text-muted sm:inline-block font-mono">
              Lanczos-3 Engine
            </span>
          )}
        </div>

        {/* Center: Scale Selector Pills & 4x Chained Toggle */}
        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label="Upscale factor"
            className="flex items-center rounded-full border border-hairline/80 bg-foreground/[0.03] p-0.5 shadow-xs"
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
                title="Direct 4× pass: optimal edge continuity and higher PSNR"
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
                title="Chained 2××2× passes: two-stage progressive refinement"
              >
                2××2×
              </button>
            </div>
          )}
        </div>

        {/* Right: Decisive Actions */}
        <div className="flex items-center gap-2">
          {hasResults ? (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-foreground/[0.04] active:scale-95"
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
                <div className="flex items-center rounded-full border border-hairline/80 bg-foreground/[0.02] p-0.5 shadow-xs">
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
      </header>

      {/* Staged File List with Remove action */}
      {job.files.length > 0 && (
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
      )}

      {/* Solid Status Bar (No Anime Pulse) */}
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

      {/* Edge-to-Edge Canvas Stage (No Nested Border Boxes) */}
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
            <StudioComparisonView
              result={selectedResult}
              allResults={job.results}
              onSelectId={job.setSelectedId}
              onDownloadZip={job.downloadZip}
              zipUrl={job.zipUrl}
            />
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
    </section>
  );
}

export function UpscalerToolSkeleton() {
  return (
    <div
      aria-hidden
      className="h-full w-full bg-foreground/[0.02]"
    />
  );
}
