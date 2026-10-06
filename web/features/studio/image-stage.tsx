"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { ComparisonViewport } from "./image-viewport";
import {
  calculateFit,
  calculateRect,
  clampPan,
  dividerViewportX,
  fractionFromViewportX,
  hundredPercentZoom,
} from "./geometry";

const DRAG_THRESHOLD = 6;

// Canonical state: {viewport(box), image, zoom, pan, fraction}. Everything
// else derives via geometry.ts — no duplicated rects, no sync effects.
export function ImageStage({
  input,
  result,
  working,
  topLeft,
  topRight,
  statusLine,
}: {
  input: StudioImage;
  result: StudioImage | null;
  working: boolean;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  statusLine?: React.ReactNode;
}) {
  const [fraction, setFraction] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ mode: "maybe-split" | "split" | "pan"; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = calculateFit(box.w, box.h, input.w, input.h);
  const rect = calculateRect(fit, box.w, box.h, zoom, pan);
  const zoomed = zoom > 1;

  function fractionAt(clientX: number) {
    const r = boxRef.current!.getBoundingClientRect();
    return fractionFromViewportX(rect, clientX - r.left);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || working) return;
    // Keyboard from here on: focus the surface on any interaction.
    boxRef.current?.focus({ preventScroll: true });
    if (zoomed) {
      gesture.current = { mode: "pan", sx: e.clientX - pan.x, sy: e.clientY - pan.y };
    } else if (result) {
      gesture.current = { mode: "maybe-split", sx: e.clientX, sy: e.clientY };
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
      if (g.mode === "split") {
        const r = boxRef.current!.getBoundingClientRect();
        setFraction(fractionFromViewportX(rect, ev.clientX - r.left));
      } else {
        setPan(clampPan(fit, box.w, box.h, zoom, { x: ev.clientX - g.sx, y: ev.clientY - g.sy }));
      }
    };
    const up = (ev: PointerEvent) => {
      const g = gesture.current;
      if (g?.mode === "maybe-split") {
        setFraction(fractionAt(ev.clientX) < 0.5 ? 0 : 1);
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
    // Page never scrolls (fixed viewport shell); plain wheel zooms, trackpad
    // pinch arrives as ctrl+wheel on the same path. Cursor-anchored, except
    // zooming all the way out always snaps back to center.
    if (working) return;
    const r = boxRef.current!.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    setZoom((z) => {
      const z2 = Math.min(32, Math.max(1, z * Math.exp(-e.deltaY * 0.0015)));
      if (z2 !== z) {
        if (z2 === 1) setPan({ x: 0, y: 0 });
        else setPan((p) => clampPan(fit, box.w, box.h, z2, { x: cx - ((cx - p.x) * z2) / z, y: cy - ((cy - p.y) * z2) / z }));
      }
      return z2;
    });
  }

  // Button zoom keeps the current center stable (pan scales with zoom) and
  // snaps to center at 1x, so in/out always returns to center.
  function zoomBy(factor: number) {
    setZoom((z) => {
      const z2 = Math.min(32, Math.max(1, z * factor));
      if (z2 === 1) setPan({ x: 0, y: 0 });
      else if (z2 !== z) setPan((p) => ({ x: (p.x * z2) / z, y: (p.y * z2) / z }));
      return z2;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!result) return;
    if (e.key === "ArrowLeft") setFraction((s) => Math.max(0, s - 0.04));
    else if (e.key === "ArrowRight") setFraction((s) => Math.min(1, s + 0.04));
    else if (e.key === "0" || e.key === "Escape") resetView();
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else return;
    e.preventDefault();
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFraction(0.5);
  }

  function zoomToHundred() {
    setPan({ x: 0, y: 0 });
    setZoom(hundredPercentZoom(fit, input.w));
  }

  const dividerX = dividerViewportX(rect, fraction);

  return (
    <div
      ref={boxRef}
      className={`relative h-full w-full overflow-hidden bg-[#0c0b0a] outline-none select-none ${zoomed || dragging ? "touch-none" : ""}`}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onDoubleClick={resetView}
      tabIndex={0}
      role={result ? "slider" : undefined}
      aria-label={result ? "Reveal comparison" : undefined}
      aria-valuemin={result ? 0 : undefined}
      aria-valuemax={result ? 100 : undefined}
      aria-valuenow={result ? Math.round(fraction * 100) : undefined}
      onKeyDown={onKeyDown}
    >
      <ComparisonViewport input={input} result={result} rect={rect} fraction={result ? fraction : 1} />
      <div className="pointer-events-none absolute inset-x-0 top-3 flex items-start justify-between px-4" aria-hidden="true">
        <div>{topLeft}</div>
        <div className="flex flex-col items-end gap-1">
          <div>{topRight}</div>
          {statusLine && <div className="font-mono text-[11px] text-white/40 tabular-nums">{statusLine}</div>}
        </div>
      </div>
      {result && (
        <>
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${dividerX}px` }} aria-hidden="true">
            <div className="h-full w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
          </div>
          {/* Divider grip: split-drag works at any zoom (image drag pans). */}
          <div
            className="absolute inset-y-0 flex w-8 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center"
            style={{ left: `${dividerX}px` }}
            onPointerDown={(e) => {
              if (e.button !== 0 || working) return;
              e.stopPropagation();
              boxRef.current?.focus({ preventScroll: true });
              gesture.current = { mode: "split", sx: e.clientX, sy: e.clientY };
              setDragging(true);
              const move = (ev: PointerEvent) => {
                if (!gesture.current) return;
                const r = boxRef.current!.getBoundingClientRect();
                setFraction(fractionFromViewportX(rect, ev.clientX - r.left));
              };
              const up = () => {
                gesture.current = null;
                setDragging(false);
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            aria-hidden="true"
          >
            <div className="rounded-full border border-white/40 bg-black/70 px-2 py-1 text-[11px] text-white">⟷</div>
          </div>
        </>
      )}
      {working && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <p className="font-display text-3xl text-white">Making it larger…</p>
        </div>
      )}
      <div
        className="absolute top-12 right-3 flex items-center gap-0.5 rounded-full bg-black/70 px-1 py-1 text-[13px] text-stone-200"
        role="group"
        aria-label="Zoom"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={zoomToHundred} aria-label="100 percent">1:1</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={resetView} aria-label="Fit to view">Fit</button>
        <button className="rounded-full px-2.5 py-1 hover:bg-white/10" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
