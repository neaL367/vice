import { memo } from "react";
import type { ViceFile, ViceResult, ViceScale } from "../types/vice";
import { SpinnerIcon } from "./studio-icons";

const SCALES: readonly ViceScale[] = [2, 3, 4];

interface StudioToolbarProps {
  files: ViceFile[];
  results: ViceResult[];
  selectedResult?: ViceResult;
  stagedFile?: ViceFile;
  stagedDims?: { w: number; h: number };
  scale: ViceScale;
  chained4x?: boolean;
  running: boolean;
  onSetScale: (scale: ViceScale) => void;
  onSetChained4x?: (chained: boolean) => void;
  onOpenFileInput: () => void;
  onRun: () => void;
  onCancel: () => void;
}

export const StudioToolbar = memo(function StudioToolbar({
  files,
  results,
  selectedResult,
  stagedFile,
  stagedDims,
  scale,
  chained4x = false,
  running,
  onSetScale,
  onSetChained4x,
  onOpenFileInput,
  onRun,
  onCancel,
}: StudioToolbarProps) {
  const hasFiles = files.length > 0;
  const hasResults = results.length > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline/80 bg-foreground/[0.015] px-4 py-2 backdrop-blur-sm">
      {/* Left: Active File Info */}
      <div className="flex items-center gap-2 min-w-0">
        {hasResults && selectedResult ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="max-w-[160px] truncate text-xs font-medium text-foreground sm:max-w-[220px]">
              {selectedResult.name}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-muted">
              {Math.round(selectedResult.outW / selectedResult.scale)}×
              {Math.round(selectedResult.outH / selectedResult.scale)} →{" "}
              <strong className="text-foreground">{selectedResult.outW}×{selectedResult.outH}</strong>
            </span>
          </div>
        ) : stagedFile ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            <span className="max-w-[160px] truncate text-xs font-medium text-foreground sm:max-w-[220px]">
              {stagedFile.file.name}
            </span>
            {stagedDims && (
              <span className="text-[11px] font-mono tabular-nums text-muted">
                {stagedDims.w}×{stagedDims.h} →{" "}
                <strong className="text-foreground">{stagedDims.w * scale}×{stagedDims.h * scale}</strong>
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs font-medium text-muted">Lanczos-3 Engine</span>
        )}
      </div>

      {/* Right: Scale & Actions */}
      <div className="flex items-center gap-2">
        {/* Scale Switcher */}
        <div className="flex items-center gap-1.5">
          <div
            role="group"
            aria-label="Upscale factor"
            className="flex items-center rounded-full border border-hairline bg-background p-0.5 shadow-xs"
          >
            {SCALES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={running}
                onClick={() => onSetScale(s)}
                aria-pressed={scale === s}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  scale === s
                    ? "bg-foreground text-background shadow-xs font-semibold"
                    : "text-muted hover:text-foreground disabled:opacity-40"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          {scale === 4 && onSetChained4x && (
            <div
              role="group"
              aria-label="4x pass mode"
              className="hidden sm:flex items-center rounded-full border border-hairline/70 bg-background p-0.5 text-[11px]"
            >
              <button
                type="button"
                disabled={running}
                onClick={() => onSetChained4x(false)}
                className={`rounded-full px-2.5 py-0.5 transition-all ${
                  !chained4x
                    ? "bg-foreground text-background font-medium shadow-xs"
                    : "text-muted hover:text-foreground disabled:opacity-40"
                }`}
                title="Direct 4× pass: optimal edge continuity and higher PSNR"
              >
                Direct
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => onSetChained4x(true)}
                className={`rounded-full px-2.5 py-0.5 transition-all ${
                  chained4x
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

        {hasResults && !running && (
          <button
            type="button"
            onClick={onOpenFileInput}
            className="rounded-full border border-hairline bg-background px-3.5 py-1 text-xs font-medium text-foreground transition-all hover:bg-foreground/[0.04] active:scale-95"
          >
            New Image
          </button>
        )}

        {!hasResults && (
          <button
            type="button"
            onClick={onRun}
            disabled={!hasFiles || running}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-1 text-xs font-medium tracking-wide text-background shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
          >
            {running ? (
              <>
                <SpinnerIcon className="h-3 w-3 animate-spin" />
                <span>Upscaling…</span>
              </>
            ) : files.length > 1 ? (
              `Upscale (${files.length})`
            ) : (
              `Upscale ${scale}×`
            )}
          </button>
        )}

        {running && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-hairline px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
});
