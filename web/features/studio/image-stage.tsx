"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { ImageViewport } from "./image-viewport";

const DRAG_THRESHOLD = 6;

// One gesture surface: at fit, press-drag reveals (tap toggles full compare);
// zoomed, drag pans. Wheel zooms around the cursor (covers trackpad pinch).
// The container is the accessible slider (arrows move split, 0 resets).
export function ImageStage({ input, result, working }: { input: StudioImage; result: StudioImage | null; working: boolean }) {
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ mode: "maybe-split" | "split" | "pan"; sx: number; sy: number; px: number; py: number } | null>(null);

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
    if (e.button !== 0 || working) return;
    if (zoomed) {
      gesture.current = { mode: "pan", sx: e.clientX - pan.x, sy: e.clientY - pan.y, px: e.clientX, py: e.clientY };
    } else if (result) {
      gesture.current = { mode: "maybe-split", sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY };
    } else {
      return;
    }
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (g.mode === "maybe-split") {
        if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < DRAG_THRESHOLD) return;
        g.mode = "split";
      }
      if (g.mode === "split") splitFromClientX(ev.clientX);
      else setPan({ x: ev.clientX - g.sx, y: ev.clientY - g.sy });
    };
    const up = (ev: PointerEvent) => {
      const g = gesture.current;
      if (g?.mode === "maybe-split") {
        // Plain tap toggles full compare (click/tap comparison pattern).
        const r = boxRef.current!.getBoundingClientRect();
        setSplit((ev.clientX - r.left) / r.width < 0.5 ? 0 : 100);
      }
      gesture.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onWheel(e: React.WheelEvent) {
    // No preventDefault: the page never scrolls (fixed viewport shell), and
    // React wheel listeners are passive. Plain wheel zooms; trackpad pinch
    // arrives as ctrl+wheel and takes the same path.
    if (working) return;
    const r = boxRef.current!.getBoundingClientRect();
    // Cursor position relative to container center (the transform origin).
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    setZoom((z) => {
      const z2 = Math.min(8, Math.max(1, z * Math.exp(-e.deltaY * 0.0015)));
      if (z2 !== z) {
        setPan((p) => ({ x: cx - ((cx - p.x) * z2) / z, y: cy - ((cy - p.y) * z2) / z }));
      }
      return z2;
    });
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
      className={`relative h-full w-full overflow-hidden outline-none select-none ${zoomed || dragging ? "touch-none" : ""}`}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onDoubleClick={resetView}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role={result ? "slider" : undefined}
      aria-label={result ? "Reveal comparison" : undefined}
      aria-valuemin={result ? 0 : undefined}
      aria-valuemax={result ? 100 : undefined}
      aria-valuenow={result ? Math.round(split) : undefined}
    >
      <ImageViewport input={input} result={result} split={result ? split : 100} cssW={cssW} cssH={cssH} pan={pan} />
      {result && (
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }} aria-hidden="true">
          <div className="h-full w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
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
      {result && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-between px-4 text-[11px] tracking-widest text-white/70 uppercase" aria-hidden="true">
          <span>Original</span>
          <span>Enhanced</span>
        </div>
      )}
    </div>
  );
}
