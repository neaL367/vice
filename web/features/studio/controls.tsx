"use client";

import type { ExportFormat, Scale } from "./model";

// One bottom dock: scale · dims · upscale · download · new image.
// Dark card, hairline border, single primary action.
export function Controls({
  scale,
  setScale,
  exportFormat,
  setExportFormat,
  inDims,
  outDims,
  canUse8,
  canRun,
  working,
  canDownload,
  onUpscale,
  onCancel,
  onDownload,
  onPickFiles,
}: {
  scale: Scale;
  setScale: (s: Scale) => void;
  exportFormat: ExportFormat;
  setExportFormat: (f: ExportFormat) => void;
  inDims: string;
  outDims: string;
  canUse8: boolean;
  canRun: boolean;
  working: boolean;
  canDownload: boolean;
  onUpscale: () => void;
  onCancel?: () => void;
  onDownload: () => void;
  onPickFiles: (fs: File[]) => void;
}) {
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-2 rounded-2xl border border-[#2a2724] bg-[#171512] px-3 py-2.5 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.8)] sm:px-4">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        <div
          className="flex gap-0.5 rounded-full bg-black/40 p-1 ring-1 ring-white/[0.06] ring-inset"
          role="group"
          aria-label="Scale"
        >
          {([2, 3, 4, 8] as const).map((s) => {
            const disabled = s === 8 && !canUse8;
            const active = scale === s;
            return (
              <button
                key={s}
                onClick={() => setScale(s)}
                disabled={disabled}
                title={disabled ? "8× needs an input ≤512px on the long side" : undefined}
                aria-pressed={scale === s}
                className={`vx-pop min-h-[32px] min-w-[46px] rounded-full px-3 text-[13.5px] disabled:opacity-30 ${
                  active
                    ? "bg-[#f5f4f0] font-medium text-[#0e0d0c] shadow-sm"
                    : "text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]"
                }`}
              >
                {s}×
              </button>
            );
          })}
        </div>

        <p className="hidden items-center gap-1.5 font-mono text-[12px] text-[#a8a29e] tabular-nums sm:flex">
          <span>{inDims}</span>
          <span aria-hidden="true" className="text-[#3a3632]">→</span>
          <span className="font-medium text-[#f5f4f0]">{outDims}</span>
        </p>

        <div className="mx-1 hidden h-6 w-px bg-[#2a2724] sm:block" aria-hidden="true" />

        <div className="flex items-center gap-1.5">
          {working ? (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-[#2a2724] bg-[#221f1c] px-4 text-[13px] font-medium text-[#f5f4f0]">
                <span className="vx-spinner !h-3.5 !w-3.5 !border-2 !border-white/20 !border-t-white" aria-hidden="true" />
                Processing…
              </span>
              {onCancel && (
                <button
                  onClick={onCancel}
                  aria-label="Cancel processing"
                  title="Cancel processing"
                  className="vx-pop inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[#5a2b27] bg-[#2a1512] px-3.5 text-[12.5px] font-medium text-[#ff9d94] hover:bg-[#3d1e1a] active:scale-[0.98]"
                >
                  Cancel
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={onUpscale}
              disabled={!canRun}
              className="vx-pop inline-flex min-h-[36px] items-center gap-2 rounded-full bg-[#f5f4f0] px-5 text-[13.5px] font-medium text-[#0e0d0c] hover:bg-white active:scale-[0.98] disabled:opacity-40"
            >
              Upscale
            </button>
          )}
          {canDownload && (
            <div className="flex items-center gap-1 rounded-full border border-[#2a2724] bg-black/40 p-1">
              {(["png", "webp", "jpeg"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase transition-colors ${
                    exportFormat === fmt
                      ? "bg-[#2a2724] text-[#f5f4f0]"
                      : "text-[#a8a29e] hover:text-[#f5f4f0]"
                  }`}
                >
                  {fmt === "jpeg" ? "jpg" : fmt}
                </button>
              ))}
              <button
                onClick={onDownload}
                aria-label={`Download ${exportFormat.toUpperCase()}`}
                title={`Download ${exportFormat.toUpperCase()}`}
                className="vx-pop flex h-6 w-6 items-center justify-center rounded-full bg-[#f5f4f0] text-[12px] font-bold text-[#0e0d0c] hover:bg-white active:scale-95"
              >
                ↓
              </button>
            </div>
          )}
          <label className="vx-pop cursor-pointer rounded-full px-3 py-2 text-[13px] font-medium text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]">
            New
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                onPickFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {!canUse8 && (
        <p className="text-center text-[11.5px] text-[#6f6c66]">
          8× needs an input ≤512px on the long side — pick 4× or a smaller image
        </p>
      )}
    </div>
  );
}
