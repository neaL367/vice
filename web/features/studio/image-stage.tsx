"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { ImageViewport } from "./image-viewport";

// Stage: owns transient view state (zoom/pan/split) and measures its box to
// compute display sizes. Resets per image via key from the workspace.
export function ImageStage({ input, result, working }: { input: StudioImage; result: StudioImage | null; working: boolean }) {
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the INPUT (both layers share its display size, so splits align).
  const fit = box.w > 0 ? Math.min(box.w / input.w, box.h / input.h) : 1;
  const cssW = input.w * fit * zoom;
  const cssH = input.h * fit * zoom;

  function onPointerDown(e: React.PointerEvent) {
    if (zoom <= 1) return;
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  }
  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSplit(50);
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={boxRef}
        className="relative min-h-[46vh] flex-1 touch-none select-none lg:min-h-[62vh]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={resetView}
      >
        <ImageViewport input={input} result={result} split={result ? split : 100} cssW={cssW} cssH={cssH} pan={pan} />
        {result && (
          <>
            {/* Visible reveal grip riding the split line. */}
            <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }} aria-hidden="true">
              <div className="h-full w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
              <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-black/70 px-2 py-1 text-[11px] text-white">
                ⟷
              </div>
            </div>
          </>
        )}
        {working && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <p className="font-display text-3xl text-white">Making it larger…</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-line-dark bg-[#1b1815] px-3 py-2 text-[13px] text-stone-300">
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} aria-label="Zoom out">−</button>
          <button className="rounded px-2 py-1 hover:bg-white/10" onClick={resetView} aria-label="Fit to view">Fit</button>
          <button className="rounded px-2 py-1 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Zoom in">+</button>
        </div>
        {result ? (
          <label className="ml-auto flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-stone-400">Original</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              className="w-full accent-[#e07856]"
              aria-label="Reveal comparison"
            />
            <span className="shrink-0 text-stone-400">Enhanced</span>
          </label>
        ) : (
          <span className="ml-auto text-stone-500">Upscale to compare</span>
        )}
      </div>
    </div>
  );
}
