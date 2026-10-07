"use client";

import { useEffect, useState } from "react";
import type { StudioImage } from "./model";
import { ComparisonViewport } from "./image-viewport";
import { fractionFromViewportX } from "./geometry";
import type { Rect } from "./geometry";

// Presentational stage: all geometry arrives as primitives (never bundled
// with refs — the hooks lint forbids reading those during render). Canvas
// fills the measured box; chrome renders in the workspace as siblings.
export function ImageStage({
  input,
  result,
  working,
  startedAt,
  progress,
  framesN,
  attachBox,
  measure,
  rect,
  fraction,
  dividerX,
  zoomed,
  dragging,
  onPointerDown,
  onWheel,
  onDoubleClick,
  onKeyDown,
  setSplit,
}: {
  input: StudioImage;
  result: StudioImage | null;
  working: boolean;
  startedAt: number | null;
  progress: { done: number; total: number } | null;
  framesN: number;
  attachBox: (el: HTMLDivElement | null) => void;
  measure: () => DOMRect | null;
  rect: Rect;
  fraction: number;
  dividerX: number;
  zoomed: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  setSplit: (f: number) => void;
}) {
  function onGripDown(e: React.PointerEvent) {
    if (e.button !== 0 || working || !result) return;
    e.stopPropagation();
    const move = (ev: PointerEvent) => {
      const r = measure();
      if (!r) return;
      setSplit(fractionFromViewportX(rect, ev.clientX - r.left));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div
      ref={attachBox}
      className={`relative h-full w-full overflow-hidden bg-[#0c0b0a] outline-none select-none ${zoomed || dragging ? "touch-none" : ""} ${dragging ? "cursor-grabbing" : zoomed ? "cursor-grab" : "cursor-ew-resize"}`}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      tabIndex={0}
      role={result ? "slider" : undefined}
      aria-label={result ? "Reveal comparison" : undefined}
      aria-valuemin={result ? 0 : undefined}
      aria-valuemax={result ? 100 : undefined}
      aria-valuenow={result ? Math.round(fraction * 100) : undefined}
      onKeyDown={onKeyDown}
    >
      <ComparisonViewport
        input={input}
        result={result}
        rect={rect}
        fraction={result ? fraction : 1}
      />
      {/* Floating labels */}
      {!working && (
        <>
          <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            Original
          </span>
          {result && (
            <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#0e0d0c] shadow-sm">
              Enhanced
            </span>
          )}
        </>
      )}
      {result && (
        <>
          <div
            className="pointer-events-none absolute"
            style={{ left: `${dividerX}px`, top: `${rect.y}px`, height: `${rect.h}px` }}
            aria-hidden="true"
            data-testid="divider-line"
          >
            <div className="h-full w-[2px] -translate-x-1/2 bg-white shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
          </div>
          <div
            className="absolute flex w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
            style={{ left: `${dividerX}px`, top: `${rect.y}px`, height: `${rect.h}px` }}
            onPointerDown={onGripDown}
            aria-hidden="true"
            data-testid="divider-grip"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[13px] text-[#0e0d0c] shadow-[0_2px_12px_rgba(0,0,0,0.5)] ring-1 ring-black/20">
              ⟷
            </div>
          </div>
        </>
      )}
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="w-[280px] rounded-2xl border border-[#2a2724] bg-[#171512] px-5 py-4 text-center shadow-[0_24px_64px_-24px_rgba(0,0,0,0.9)]">
            <div className="mx-auto mb-3 w-fit">
              <span className="vx-spinner block" aria-hidden="true" />
            </div>
            <p className="text-[14px] font-semibold tracking-tight text-[#f5f4f0]">
              {framesN > 1 ? `Fusing ${framesN} frames…` : "Making it larger…"}
            </p>
            {pct !== null ? (
              <>
                <div className="vx-progress-track mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className="vx-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 font-mono text-[11.5px] text-[#a8a29e] tabular-nums">
                  {pct}%
                </p>
              </>
            ) : (
              startedAt !== null && <Elapsed since={startedAt} />
            )}
            <p className="mt-1 text-[11px] text-[#6f6c66]">You can keep browsing — we&apos;ll let you know</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Self-ticking elapsed readout; local state keeps canvas redraws untouched.
// Independent effect process: setup ticks, cleanup clears (StrictMode-safe).
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="mt-2 font-mono text-[12px] text-[#a8a29e] tabular-nums">
      {((now - since) / 1000).toFixed(0)}s
    </p>
  );
}
