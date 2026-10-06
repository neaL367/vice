"use client";

import { useRef, useState } from "react";
import type { StudioImage } from "./model";
import { ImageViewport } from "./image-viewport";

// Stage: owns transient view state (zoom/pan/split). Resets per image via key.
export function ImageStage({ input, result, working }: { input: StudioImage; result: StudioImage | null; working: boolean }) {
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    if (zoom <= 1) return;
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  }
  function onPointerUp() {
    drag.current = null;
  }
  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSplit(50);
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="relative min-h-[320px] flex-1 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={resetView}
      >
        <ImageViewport input={input} result={result} split={split} zoom={zoom} pan={pan} />
        {working && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <p className="font-display text-2xl text-white">Making it larger…</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[13px]">
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button className="rounded px-2 py-1 hover:bg-black/5" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} aria-label="Zoom out">−</button>
          <button className="rounded px-2 py-1 hover:bg-black/5" onClick={resetView} aria-label="Fit to view">Fit</button>
          <button className="rounded px-2 py-1 hover:bg-black/5" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Zoom in">+</button>
        </div>
        {result ? (
          <label className="ml-auto flex flex-1 items-center gap-2">
            <span className="text-ink-soft">Original</span>
            <input
              type="range"
              min={0}
              max={100}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              className="w-full accent-[#9a3412]"
              aria-label="Reveal comparison"
            />
            <span className="text-ink-soft">Enhanced</span>
          </label>
        ) : (
          <span className="ml-auto text-ink-faint">Upscale to compare</span>
        )}
      </div>
    </div>
  );
}
