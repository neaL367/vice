"use client";

import { memo, type ReactNode } from "react";
import { ViewTransition } from "react";
import { MAX_STREAM_MP } from "../../../../lib/limits";
import { DownloadIcon, SpinnerIcon, UploadIcon } from "../studio-icons";
import { StudioDropzone } from "../studio-dropzone";
import { StudioStagedPreview } from "../studio-staged-preview";
import { Comparison } from "../comparison/comparison-view";
import { UpscalerProvider, useUpscaler } from "./upscaler-context";
import { EvidenceRail } from "./evidence-rail";
import { InspectorContent, InspectorRail } from "./inspector";
import { QueueContent, QueueRail } from "./queue-rail";

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
              PNG, JPEG, WebP · Up to {MAX_STREAM_MP} MP output
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
      className="z-30 flex h-[var(--header-h)] shrink-0 items-center justify-between gap-2 border-b border-hairline/60 bg-background/80 px-4 backdrop-blur-xl"
    >
      {children}
    </header>
  );
});

// --- 3. Brand (identity only; status lives in the evidence rail) ---
export const UpscalerBrand = memo(function UpscalerBrand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <h1 className="text-sm font-semibold tracking-tight text-foreground">
        Vice
      </h1>
      <span className="hidden h-3.5 w-px bg-hairline/70 md:inline-block" />
      <span className="hidden truncate text-xs text-muted md:inline-block">
        Consistent super-resolution
      </span>
    </div>
  );
});

// --- 4. Sheet triggers (below lg only) ---
export const UpscalerSheetButtons = memo(function UpscalerSheetButtons() {
  const { hasFiles, hasResults, job, setIsQueueOpen, setIsInspectorOpen } = useUpscaler();
  if (!hasFiles && !hasResults) return null;
  return (
    <div className="flex items-center gap-1.5 lg:hidden">
      <button
        type="button"
        onClick={() => setIsQueueOpen(true)}
        aria-label={`Open file queue (${job.files.length})`}
        className="inline-flex h-8 items-center rounded-md border border-hairline px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        Files · {job.files.length}
      </button>
      <button
        type="button"
        onClick={() => setIsInspectorOpen(true)}
        aria-label="Open settings"
        className="inline-flex h-8 items-center rounded-md border border-hairline px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        Tune
      </button>
    </div>
  );
});

// --- 5. Header actions: New + Export family only ---
export const UpscalerHeaderActions = memo(function UpscalerHeaderActions() {
  const {
    hasResults,
    job,
    selectedResult,
    fileInputRef,
    exportFormat,
    setExportFormat,
    customFormatUrl,
  } = useUpscaler();
  if (!hasResults) return null;

  const exportHref =
    exportFormat !== "png" &&
    customFormatUrl?.format === exportFormat &&
    customFormatUrl.id === selectedResult?.id
      ? customFormatUrl.url
      : selectedResult?.blobUrl;
  const exportName = selectedResult
    ? `${selectedResult.name.replace(/\.[^.]*$/, "") || "image"}-vice${selectedResult.scale}x.${
        exportFormat === "jpeg" ? "jpg" : exportFormat
      }`
    : undefined;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="hidden h-8 items-center gap-1.5 rounded-md border border-hairline bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.04] sm:inline-flex"
      >
        <UploadIcon className="h-3.5 w-3.5" />
        <span>New</span>
      </button>

      {job.results.filter((r) => !r.savedToDisk).length > 1 && (
        <button
          type="button"
          onClick={job.downloadZip}
          className="hidden h-8 items-center rounded-md border border-hairline bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-foreground/[0.04] md:inline-flex"
        >
          Download all (.zip)
        </button>
      )}

      {job.zipUrl && (
        <a
          href={job.zipUrl}
          download="vice-batch.zip"
          className="hidden text-xs text-accent underline underline-offset-4 md:inline"
        >
          vice-batch.zip ready
        </a>
      )}

      {selectedResult?.savedToDisk && selectedResult.fileName && (
        <span className="hidden max-w-48 truncate text-xs text-muted sm:inline" title={selectedResult.fileName}>
          Saved: {selectedResult.fileName}
        </span>
      )}

      {selectedResult && exportHref && !selectedResult.savedToDisk && (
        <div className="flex items-center gap-1 rounded-md border border-hairline bg-foreground/[0.02] p-0.5">
          <div
            role="group"
            aria-label="Export format"
            className="hidden items-center text-[11px] font-medium sm:flex"
          >
            {(["png", "webp", "jpeg"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setExportFormat(fmt)}
                aria-pressed={exportFormat === fmt}
                className={`rounded px-2 py-1 transition-colors ${
                  exportFormat === fmt
                    ? "bg-foreground font-semibold text-background"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {fmt === "jpeg" ? "JPG" : fmt.toUpperCase()}
              </button>
            ))}
          </div>

          <a
            href={exportHref}
            download={exportName}
            className="inline-flex h-7 items-center gap-1.5 rounded bg-foreground px-3 text-xs font-semibold text-background transition-opacity hover:opacity-90"
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
    </div>
  );
});

// --- 6. Mobile bottom bar (below sm only) ---
export const UpscalerMobileBar = memo(function UpscalerMobileBar() {
  const {
    hasResults,
    hasFiles,
    job,
    selectedResult,
    setIsQueueOpen,
    setIsInspectorOpen,
  } = useUpscaler();
  if (!hasFiles && !hasResults) return null;

  let primary: ReactNode;
  if (job.running) {
    primary = (
      <button
        type="button"
        onClick={job.cancel}
        className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-hairline text-sm font-semibold text-foreground"
      >
        Cancel
      </button>
    );
  } else if (hasResults && selectedResult) {
    primary = selectedResult.savedToDisk ? (
      <span className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-hairline text-sm font-semibold text-muted">
        Saved to disk
      </span>
    ) : (
      <a
        href={selectedResult.blobUrl}
        download={`${selectedResult.name.replace(/\.[^.]*$/, "") || "image"}-vice${selectedResult.scale}x.png`}
        className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background"
      >
        Export
      </a>
    );
  } else {
    primary = (
      <button
        type="button"
        onClick={job.run}
        disabled={job.running || !hasFiles}
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-foreground text-sm font-semibold text-background disabled:opacity-40"
      >
        {job.files.length > 1 ? `Upscale ${job.files.length}` : "Upscale"}
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-hairline/60 bg-background px-3 py-2 sm:hidden">
      <button
        type="button"
        onClick={() => setIsQueueOpen(true)}
        aria-label={`Open file queue (${job.files.length})`}
        className="inline-flex h-10 items-center rounded-md border border-hairline px-3 text-xs font-medium text-muted"
      >
        Files
      </button>
      {primary}
      <button
        type="button"
        onClick={() => setIsInspectorOpen(true)}
        aria-label="Open settings"
        className="inline-flex h-10 items-center rounded-md border border-hairline px-3 text-xs font-medium text-muted"
      >
        Tune
      </button>
    </div>
  );
});

// --- 7. Sheets (below lg only; rails cover desktop) ---
export const UpscalerSheets = memo(function UpscalerSheets() {
  const { isQueueOpen, setIsQueueOpen, isInspectorOpen, setIsInspectorOpen } =
    useUpscaler();
  return (
    <>
      {isQueueOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="File queue">
          <button
            type="button"
            aria-label="Dismiss file queue"
            onClick={() => setIsQueueOpen(false)}
            className="absolute inset-0 bg-foreground/20"
          />
          <div className="absolute top-0 bottom-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-hairline bg-background px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Files</span>
              <button
                type="button"
                onClick={() => setIsQueueOpen(false)}
                aria-label="Close file queue"
                className="px-2 text-lg leading-none text-muted hover:text-foreground"
              >
                ×
              </button>
            </div>
            <QueueContent />
          </div>
        </div>
      )}
      {isInspectorOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Output settings">
          <button
            type="button"
            aria-label="Dismiss settings"
            onClick={() => setIsInspectorOpen(false)}
            className="absolute inset-0 bg-foreground/20"
          />
          <div className="absolute top-0 right-0 bottom-0 w-80 max-w-[85vw] overflow-y-auto border-l border-hairline bg-background px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Output</span>
              <button
                type="button"
                onClick={() => setIsInspectorOpen(false)}
                aria-label="Close settings"
                className="px-2 text-lg leading-none text-muted hover:text-foreground"
              >
                ×
              </button>
            </div>
            <InspectorContent />
          </div>
        </div>
      )}
    </>
  );
});

// --- 8. Stage (Canvas / Comparison / Dropzone) ---
export const UpscalerStage = memo(function UpscalerStage() {
  const {
    hasResults,
    selectedResult,
    hasFiles,
    stagedFile,
    job,
    fileInputId,
    onImageLoad,
  } = useUpscaler();

  return (
    <div
      data-testid="workspace-stage"
      className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background"
    >
      {job.running && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/50">
          <span className="sr-only" aria-live="polite">
            Upscaling in progress
          </span>
          <SpinnerIcon className="h-5 w-5 animate-spin text-muted" />
        </div>
      )}
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
            onImageLoad={onImageLoad}
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
          <StudioDropzone
            inputId={fileInputId}
            onChoose={() =>
              (
                document.getElementById(fileInputId) as HTMLInputElement | null
              )?.click()
            }
          />
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
  SheetButtons: UpscalerSheetButtons,
  HeaderActions: UpscalerHeaderActions,
  MobileBar: UpscalerMobileBar,
  Sheets: UpscalerSheets,
  QueueRail,
  QueueContent,
  InspectorRail,
  InspectorContent,
  EvidenceRail,
  Stage: UpscalerStage,
  Comparison,
};
