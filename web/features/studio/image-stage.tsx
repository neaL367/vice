"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { ImageViewport } from "./image-viewport";

// Stage: full-bleed viewport filling its parent. Owns transient view state.
// Overlays float: zoom pill bottom-right, reveal slider bottom strip.
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
    <div
      ref={boxRef}
      className="relative h-full w-full touch-none overflow-hidden select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={resetView}
    >
      <ImageViewport input={input} result={result} split={result ? split : 100} cssW={cssW} cssH={cssH} pan={pan} />
      {result && (
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }} aria-hidden="true">
          <div className="h-full w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-black/70 px-2 py-1 text-[11px] text-white">
            ⟷
          </div>
        </div>
      )}
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <p className="font-display text-3xl text-white">Making it larger…</p>
        </div>
      )}
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-full bg-black/70 px-1 py-1 text-[13px] text-stone-200 backdrop-blur" role="group" aria-label="Zoom">
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} aria-label="Zoom out">−</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={resetView} aria-label="Fit to view">Fit</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Zoom in">+</button>
      </div>
      {result && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pt-8 pb-3">
          <label className="mx-auto flex max-w-xl items-center gap-3 text-[12px] text-stone-300">
            <span className="shrink-0">Original</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              className="w-full accent-[#e07856]"
              aria-label="Reveal comparison"
            />
            <span className="shrink-0">Enhanced</span>
          </label>
        </div>
      )}
    </div>
  );
}
