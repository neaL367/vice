"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  centerComparison: () => void;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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

  // Smooth-zoom targets: wheel/button updates land here, a rAF loop eases
  // the rendered zoom/pan toward them (critically-damped-ish lerp). Rapid
  // wheel ticks compound on the TARGET so trackpads glide instead of jump.
  const targetRef = useRef({ z: 1, x: 0, y: 0 });
  const curRef = useRef({ z: 1, x: 0, y: 0 });
  const rafRef = useRef(0);
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  }, [working]);

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

  // Latest geometry for the rAF loop (avoids stale closures).
  const geomRef = useRef({ fit, bw: box.w, bh: box.h });
  useEffect(() => {
    geomRef.current = { fit, bw: box.w, bh: box.h };
  }, [fit, box.w, box.h]);

  function stopAnim() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  useEffect(() => stopAnim, []);

  function step() {
    rafRef.current = 0;
    if (workingRef.current) return;
    const t = targetRef.current;
    const c = curRef.current;
    const k = 0.24;
    const nz = Math.abs(t.z - c.z) < 0.002 ? t.z : c.z + (t.z - c.z) * k;
    const nx = Math.abs(t.x - c.x) < 0.1 ? t.x : c.x + (t.x - c.x) * k;
    const ny = Math.abs(t.y - c.y) < 0.1 ? t.y : c.y + (t.y - c.y) * k;
    const g = geomRef.current;
    const clamped = clampPan(g.fit, g.bw, g.bh, nz, { x: nx, y: ny });
    const fz = nz === 1 ? 1 : nz;
    const fx = nz === 1 ? 0 : clamped.x;
    const fy = nz === 1 ? 0 : clamped.y;
    curRef.current = { z: fz, x: fx, y: fy };
    setZoom(fz);
    setPan({ x: fx, y: fy });
    if (fz !== t.z || fx !== t.x || fy !== t.y) {
      rafRef.current = requestAnimationFrame(step);
    }
  }

  function smoothTo(z: number, x: number, y: number) {
    targetRef.current = { z, x, y };
    if (reducedMotion()) {
      stopAnim();
      curRef.current = { z, x, y };
      setZoom(z);
      setPan({ x, y });
      return;
    }
    if (!rafRef.current) rafRef.current = requestAnimationFrame(step);
  }

  function snapTo(z: number, x: number, y: number) {
    stopAnim();
    targetRef.current = { z, x, y };
    curRef.current = { z, x, y };
    setZoom(z);
    setPan({ x, y });
  }

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
        // Panning tracks the pointer 1:1 — cancel any zoom glide first.
        stopAnim();
        const next = clampPan(geomRef.current.fit, geomRef.current.bw, geomRef.current.bh, curRef.current.z, {
          x: ev.clientX - g.sx,
          y: ev.clientY - g.sy,
        });
        targetRef.current = { z: curRef.current.z, x: next.x, y: next.y };
        curRef.current = { z: curRef.current.z, x: next.x, y: next.y };
        setPan(next);
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
    // Normalize: line-mode deltas (Firefox) and huge touchpad flings would
    // otherwise jump. Clamp each tick so motion compounds smoothly.
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    dy = Math.max(-100, Math.min(100, dy));
    if (dy === 0) return;
    const r = boxRef.current!.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    const t = targetRef.current;
    const z2 = Math.min(32, Math.max(1, t.z * Math.exp(-dy * 0.0015)));
    if (z2 === t.z) return;
    if (z2 === 1) {
      smoothTo(1, 0, 0);
      return;
    }
    const g = geomRef.current;
    const next = clampPan(g.fit, g.bw, g.bh, z2, {
      x: cx - ((cx - t.x) * z2) / t.z,
      y: cy - ((cy - t.y) * z2) / t.z,
    });
    smoothTo(z2, next.x, next.y);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!result) return;
    if (e.key === "ArrowLeft") setSplit(fraction - 0.04);
    else if (e.key === "ArrowRight") setSplit(fraction + 0.04);
    else if (e.key === "Home") setSplit(0);
    else if (e.key === "End") setSplit(1);
    else if (e.key === "0" || e.key === "Escape") resetView();
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(1 / 1.25);
    else return;
    e.preventDefault();
  }

  function resetView() {
    setFraction(0.5);
    if (reducedMotion()) snapTo(1, 0, 0);
    else smoothTo(1, 0, 0);
  }

  function zoomBy(factor: number) {
    const t = targetRef.current;
    const z2 = Math.min(32, Math.max(1, t.z * factor));
    if (z2 === t.z) return;
    if (z2 === 1) {
      if (reducedMotion()) snapTo(1, 0, 0);
      else smoothTo(1, 0, 0);
      return;
    }
    // Button zoom anchors at the viewport center: scale pan proportionally.
    const g = geomRef.current;
    const next = clampPan(g.fit, g.bw, g.bh, z2, {
      x: (t.x * z2) / t.z,
      y: (t.y * z2) / t.z,
    });
    if (reducedMotion()) snapTo(z2, next.x, next.y);
    else smoothTo(z2, next.x, next.y);
  }

  function zoomToHundred() {
    const hz = hundredPercentZoom(geomRef.current.fit, input.w);
    if (reducedMotion()) snapTo(hz, 0, 0);
    else smoothTo(hz, 0, 0);
  }

  function setSplit(f: number) {
    // Full 0..1 travel: the divider must reach both image edges. Findability
    // at the extremes is handled by the Center control, not by restricting
    // travel (a clamp here left dead space the slider could never reach).
    setFraction(Math.min(1, Math.max(0, f)));
  }

  function centerComparison() {
    // Center the divider in the CURRENT view: combine with the present
    // pan/zoom instead of resetting to the image center. The view never
    // jumps; the divider lands mid-screen, always findable, no dragging.
    setSplit(fractionFromViewportX(rect, box.w / 2));
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
    centerComparison,
  };
}
