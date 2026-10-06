"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { ImageViewport } from "./image-viewport";

// Stage: one surface, no stacked bars. Drag on the image reveals the result
// (split follows the pointer) when at fit; drag pans when zoomed. Arrow keys
// move the split for keyboard users. The container is the slider (role=slider).
export function ImageStage({ input, result, working }: { input: StudioImage; result: StudioImage | null; working: boolean }) {
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);

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
  const zoomed = zoom > 1;

  function splitFromClientX(clientX: number) {
    const r = boxRef.current!.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!result || working) return;
    if (zoomed) {
      const sx = e.clientX - pan.x;
      const sy = e.clientY - pan.y;
      const move = (ev: PointerEvent) => setPan({ x: ev.clientX - sx, y: ev.clientY - sy });
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    } else {
      splitFromClientX(e.clientX);
      const move = (ev: PointerEvent) => splitFromClientX(ev.clientX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!result) return;
    if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 4));
    else if (e.key === "ArrowRight") setSplit((s) => Math.min(100, s + 4));
    else if (e.key === "0") resetView();
    else return;
    e.preventDefault();
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSplit(50);
  }

  return (
    <div
      ref={boxRef}
      className={`relative h-full w-full overflow-hidden outline-none select-none ${zoomed ? "touch-none" : ""}`}
      onPointerDown={onPointerDown}
      onDoubleClick={resetView}
      tabIndex={0}
      role={result ? "slider" : undefined}
      aria-label={result ? "Reveal comparison" : undefined}
      aria-valuemin={result ? 0 : undefined}
      aria-valuemax={result ? 100 : undefined}
      aria-valuenow={result ? Math.round(split) : undefined}
      onKeyDown={onKeyDown}
    >
      <ImageViewport input={input} result={result} split={result ? split : 100} cssW={cssW} cssH={cssH} pan={pan} />
      {result && (
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }} aria-hidden="true">
          <div className="h-full w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
        </div>
      )}
      {result && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-between px-4 text-[11px] tracking-widest text-white/70 uppercase" aria-hidden="true">
          <span>Original</span>
          <span>Enhanced</span>
        </div>
      )}
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <p className="font-display text-3xl text-white">Making it larger…</p>
        </div>
      )}
      <div
        className="absolute top-3 right-3 flex items-center gap-0.5 rounded-full bg-black/70 px-1 py-1 text-[13px] text-stone-200"
        role="group"
        aria-label="Zoom"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={() => setZoom((z) => Math.max(1, z / 1.25))} aria-label="Zoom out">−</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={resetView} aria-label="Fit to view">Fit</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
