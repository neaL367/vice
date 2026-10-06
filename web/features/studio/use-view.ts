"use client";

import { useCallback, useRef, useState } from "react";
import type { StudioImage } from "./model";
import {
  calculateFit,
  calculateRect,
  clampPan,
  dividerViewportX,
  fractionFromViewportX,
  hundredPercentZoom,
} from "./geometry";

const DRAG_THRESHOLD = 6;

// Single owner for comparison view state: viewport box, image, zoom, pan,
// divider fraction. Pure geometry derives via geometry.ts.
// Used INSIDE ImageStage (never passed across as an object: the hooks lint
// forbids reading its fields during render). Chrome renders via render prop.

export interface ViewApi {
  zoomBy: (factor: number) => void;
  resetView: () => void;
  zoomToHundred: () => void;
}

interface ViewInternal extends ViewApi {
  // NOTE: no ref objects in here — the hooks lint taints any object carrying
  // one. The box div attaches via attachBox (callback ref); measuring goes
  // through measure(). Everything else is plain state/handlers.
  attachBox: (el: HTMLDivElement | null) => void;
  measure: () => DOMRect | null;
  box: { w: number; h: number };
  fraction: number;
  zoom: number;
  pan: { x: number; y: number };
  dragging: boolean;
  rect: { x: number; y: number; w: number; h: number };
  dividerX: number;
  zoomed: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick: () => void;
  setSplit: (f: number) => void;
}

export function useView(
  input: StudioImage,
  result: StudioImage | null,
  working: boolean,
): ViewInternal {
  const [fraction, setFraction] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{
    mode: "maybe-split" | "split" | "pan";
    sx: number;
    sy: number;
  } | null>(null);

  // Callback ref: attaches + measures without ever exposing the ref object.
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    boxRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function measure(): DOMRect | null {
    const el = boxRef.current;
    return el ? el.getBoundingClientRect() : null;
  }

  const fit = calculateFit(box.w, box.h, input.w, input.h);
  const rect = calculateRect(fit, box.w, box.h, zoom, pan);
  const zoomed = zoom > 1;

  function fractionAt(clientX: number) {
    const r = boxRef.current!.getBoundingClientRect();
    return fractionFromViewportX(rect, clientX - r.left);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || working) return;
    boxRef.current?.focus({ preventScroll: true });
    if (zoomed) {
      gesture.current = {
        mode: "pan",
        sx: e.clientX - pan.x,
        sy: e.clientY - pan.y,
      };
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
        if (Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) < DRAG_THRESHOLD)
          return;
        g.mode = "split";
      }
      if (g.mode === "split") {
        const r = boxRef.current!.getBoundingClientRect();
        setSplit(fractionFromViewportX(rect, ev.clientX - r.left));
      } else {
        setPan(
          clampPan(fit, box.w, box.h, zoom, {
            x: ev.clientX - g.sx,
            y: ev.clientY - g.sy,
          }),
        );
      }
    };
    const up = (ev: PointerEvent) => {
      const g = gesture.current;
      if (g?.mode === "maybe-split") {
        setSplit(fractionAt(ev.clientX) < 0.5 ? 0 : 1);
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
    if (working) return;
    const r = boxRef.current!.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    setZoom((z) => {
      const z2 = Math.min(32, Math.max(1, z * Math.exp(-e.deltaY * 0.0015)));
      if (z2 !== z) {
        if (z2 === 1) setPan({ x: 0, y: 0 });
        else
          setPan((p) =>
            clampPan(fit, box.w, box.h, z2, {
              x: cx - ((cx - p.x) * z2) / z,
              y: cy - ((cy - p.y) * z2) / z,
            }),
          );
      }
      return z2;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!result) return;
    if (e.key === "ArrowLeft") setSplit(fraction - 0.04);
    else if (e.key === "ArrowRight") setSplit(fraction + 0.04);
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

  function zoomBy(factor: number) {
    setZoom((z) => {
      const z2 = Math.min(32, Math.max(1, z * factor));
      if (z2 === 1) setPan({ x: 0, y: 0 });
      else if (z2 !== z)
        setPan((p) => ({ x: (p.x * z2) / z, y: (p.y * z2) / z }));
      return z2;
    });
  }

  function zoomToHundred() {
    setPan({ x: 0, y: 0 });
    setZoom(hundredPercentZoom(fit, input.w));
  }

  function setSplit(f: number) {
    // Clamp travel to [5, 95]: at the extremes one side (and the grip) would
    // vanish off-screen and users must hunt for the divider. Tap toggles
    // between the clamped ends — a sliver of each side always remains.
    setFraction(Math.min(0.95, Math.max(0.05, f)));
  }

  return {
    attachBox,
    measure,
    box,
    fraction,
    zoom,
    pan,
    dragging,
    rect,
    dividerX: dividerViewportX(rect, fraction),
    zoomed,
    onPointerDown,
    onWheel,
    onKeyDown,
    onDoubleClick: resetView,
    resetView,
    zoomBy,
    zoomToHundred,
    setSplit,
  };
}
