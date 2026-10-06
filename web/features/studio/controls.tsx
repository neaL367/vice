"use client";

// Static control bar (never floats over the image): scale, derived dims,
// upscale, download. Wraps on narrow screens instead of overflowing.
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 py-1">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-stone-500">Size</span>
        <div className="flex gap-1" role="group" aria-label="Scale">
          {([2, 3, 4] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              aria-pressed={scale === s}
              className={`min-h-[36px] rounded-lg px-3 py-1 text-[14px] transition-colors ${
                scale === s ? "bg-stone-100 text-stone-900" : "text-stone-300 hover:bg-white/10"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <p className="text-[13px] text-stone-400 tabular-nums">
        {inDims} <span className="text-stone-600">→</span> {outDims}
      </p>
      <div className="ml-auto flex gap-2">
        <button
          onClick={onUpscale}
          disabled={!canRun || working}
          className="min-h-[36px] rounded-lg bg-[#c2410c] px-6 py-1.5 text-[14px] font-medium text-white transition-colors hover:bg-[#d14e14] disabled:opacity-40"
        >
          {working ? "Processing…" : "Upscale"}
        </button>
        <button
          onClick={onDownload}
          disabled={!canDownload}
          className="min-h-[36px] rounded-lg border border-white/15 px-4 py-1.5 text-[14px] text-stone-200 transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          Download
        </button>
      </div>
    </div>
  );
}
