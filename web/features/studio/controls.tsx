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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <fieldset>
        <legend className="text-[11px] tracking-wide text-ink-faint uppercase">Size</legend>
        <div className="flex gap-1" role="group" aria-label="Scale">
          {([2, 3, 4] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              aria-pressed={scale === s}
              className={`rounded-md px-3 py-1.5 text-[14px] ${
                scale === s ? "bg-ink text-paper" : "hover:bg-black/5"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">Output</p>
        <p className="text-[14px] tabular-nums">
          {inDims} → {outDims}
        </p>
      </div>
      <div className="ml-auto flex gap-2">
        <button
          onClick={onUpscale}
          disabled={!canRun || working}
          className="rounded-md bg-accent px-5 py-2 text-[14px] font-medium text-white disabled:opacity-40"
        >
          {working ? "Processing…" : "Upscale"}
        </button>
        <button
          onClick={onDownload}
          disabled={!canDownload}
          className="rounded-md border border-line px-4 py-2 text-[14px] disabled:opacity-40"
        >
          Download
        </button>
      </div>
    </div>
  );
}
