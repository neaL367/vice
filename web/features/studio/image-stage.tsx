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

  return (
    <div
      ref={attachBox}
      className={`relative h-full w-full overflow-hidden bg-[#0c0b0a] outline-none select-none ${zoomed || dragging ? "touch-none" : ""}`}
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
      {result && (
        <>
          <div
            className="pointer-events-none absolute"
            style={{ left: `${dividerX}px`, top: `${rect.y}px`, height: `${rect.h}px` }}
            aria-hidden="true"
            data-testid="divider-line"
          >
            <div className="h-full w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
          </div>
          <div
            className="absolute flex w-8 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
            style={{ left: `${dividerX}px`, top: `${rect.y}px`, height: `${rect.h}px` }}
            onPointerDown={onGripDown}
            aria-hidden="true"
            data-testid="divider-grip"
          >
            <div className="rounded-full border border-white/40 bg-black/70 px-2 py-1 text-[11px] text-white">
              ⟷
            </div>
          </div>
        </>
      )}
      {working && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
          <p className="font-display text-3xl text-white">Making it larger…</p>
          {startedAt !== null && <Elapsed since={startedAt} />}
        </div>
      )}
    </div>
  );
}

// Self-ticking elapsed readout; local state keeps canvas redraws untouched.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="font-mono text-[12px] text-white/60 tabular-nums">
      {((now - since) / 1000).toFixed(0)}s
    </p>
  );
}
