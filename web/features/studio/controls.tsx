"use client";

// Floating dock: one pill, four groups separated by hairlines. Segmented scale
// with pressed state, derived dims, primary upscale, icon download (when done).
export function Controls({
  scale,
  setScale,
  inDims,
  outDims,
  canRun,
  working,
  canDownload,
  onUpscale,
  onDownload,
}: {
  scale: 2 | 3 | 4;
  setScale: (s: 2 | 3 | 4) => void;
  inDims: string;
  outDims: string;
  canRun: boolean;
  working: boolean;
  canDownload: boolean;
  onUpscale: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-2xl bg-[#171412]/90 py-2 pr-2 pl-4 shadow-[0_16px_48px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur-md">
      <div className="flex gap-0.5 rounded-full bg-white/5 p-0.5" role="group" aria-label="Scale">
        {([2, 3, 4] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScale(s)}
            aria-pressed={scale === s}
            className={`min-h-[34px] rounded-full px-3.5 text-[14px] transition-all ${
              scale === s ? "bg-stone-100 font-medium text-stone-900 shadow" : "text-stone-400 hover:text-stone-100"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <p className="hidden text-[13px] text-stone-500 tabular-nums md:block">
        {inDims} <span className="text-stone-700">→</span> {outDims}
      </p>
      <div className="h-6 w-px bg-white/10" aria-hidden="true" />
      <button
        onClick={onUpscale}
        disabled={!canRun || working}
        className="min-h-[36px] rounded-xl bg-[#c2410c] px-6 text-[14px] font-medium text-white transition-all hover:bg-[#d14e14] active:scale-[0.98] disabled:opacity-40"
      >
        {working ? "Processing…" : "Upscale"}
      </button>
      {canDownload && (
        <button
          onClick={onDownload}
          aria-label="Download result"
          title="Download PNG"
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border border-white/15 text-[16px] text-stone-200 transition-colors hover:bg-white/10"
        >
          ↓
        </button>
      )}
    </div>
  );
}
