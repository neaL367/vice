"use client";

// Compact control cluster: scale choice, output dims (derived), upscale action,
// download. No fake quality presets — the engine has one fixed tuning.
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
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-white/10 bg-[#1b1815] px-4 py-3">
      <fieldset>
        <legend className="text-[11px] tracking-widest text-stone-500 uppercase">Size</legend>
        <div className="flex gap-1" role="group" aria-label="Scale">
          {([2, 3, 4] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              aria-pressed={scale === s}
              className={`rounded-lg px-3.5 py-1.5 text-[14px] transition-colors ${
                scale === s ? "bg-stone-100 text-stone-900" : "text-stone-300 hover:bg-white/10"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <p className="text-[11px] tracking-widest text-stone-500 uppercase">Output</p>
        <p className="text-[14px] text-stone-200 tabular-nums">
          {inDims} <span className="text-stone-500">→</span> {outDims}
        </p>
      </div>
      <div className="ml-auto flex gap-2">
        <button
          onClick={onUpscale}
          disabled={!canRun || working}
          className="rounded-lg bg-[#c2410c] px-6 py-2 text-[14px] font-medium text-white transition-opacity hover:bg-[#d14e14] disabled:opacity-40"
        >
          {working ? "Processing…" : "Upscale"}
        </button>
        <button
          onClick={onDownload}
          disabled={!canDownload}
          className="rounded-lg border border-white/15 px-4 py-2 text-[14px] text-stone-200 transition-colors hover:bg-white/5 disabled:opacity-40"
        >
          Download
        </button>
      </div>
    </div>
  );
}
