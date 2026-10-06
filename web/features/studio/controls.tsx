"use client";

// Single floating pill: scale · dims · upscale · download. The only control
// surface; wraps on narrow screens instead of overflowing.
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
    <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-full bg-black/70 py-2 pr-2 pl-4 shadow-2xl backdrop-blur">
      <div className="flex gap-0.5" role="group" aria-label="Scale">
        {([2, 3, 4] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScale(s)}
            aria-pressed={scale === s}
            className={`min-h-[36px] rounded-full px-3 py-1 text-[14px] transition-colors ${
              scale === s ? "bg-stone-100 text-stone-900" : "text-stone-300 hover:bg-white/10"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <p className="hidden text-[13px] text-stone-400 tabular-nums sm:block">
        {inDims} <span className="text-stone-600">→</span> {outDims}
      </p>
      <button
        onClick={onUpscale}
        disabled={!canRun || working}
        className="min-h-[36px] rounded-full bg-[#c2410c] px-6 py-1.5 text-[14px] font-medium text-white transition-colors hover:bg-[#d14e14] disabled:opacity-40"
      >
        {working ? "Processing…" : "Upscale"}
      </button>
      <button
        onClick={onDownload}
        disabled={!canDownload}
        aria-label="Download result"
        className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full border border-white/15 text-[15px] text-stone-200 transition-colors hover:bg-white/10 disabled:opacity-40"
      >
        ↓
      </button>
    </div>
  );
}
