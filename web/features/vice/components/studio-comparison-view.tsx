"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  ViewTransition,
} from "react";
import type { ViceResult } from "../types/vice";
import {
  ChevronLeftRightIcon,
  FitScreenIcon,
  PixelGridIcon,
  SideBySideIcon,
  SplitViewIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./studio-icons";

type CompareMode = "split" | "side";

interface StudioComparisonViewProps {
  result: ViceResult;
  allResults: ViceResult[];
  onSelectId: (id: number) => void;
  onDownloadZip: () => Promise<void>;
  zipUrl: string | null;
}

export const StudioComparisonView = memo(function StudioComparisonView({
  result,
  allResults,
  onSelectId,
}: StudioComparisonViewProps) {
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<CompareMode>("split");
  const [isHoldingBefore, setIsHoldingBefore] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [handleTop, setHandleTop] = useState(200);
  const [pixelMode, setPixelMode] = useState<"auto" | "crisp" | "smooth">("auto");

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const isDraggingHandleRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const origW = Math.round(result.outW / result.scale);
  const origH = Math.round(result.outH / result.scale);
  const imgAspect = (result.outW || 1) / (result.outH || 1);

  // Measure container dynamically to support any aspect ratio (wide, tall, square) full-width
  useEffect(() => {
    if (!viewportRef.current) return;
    const el = viewportRef.current;
    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setViewportSize({ width: w, height: h });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Update floating handle position dynamically so it stays visible at center of screen during heavy zoom
  const updateHandlePosition = useCallback(() => {
    if (!viewportRef.current || !stageRef.current) return;
    const vpRect = viewportRef.current.getBoundingClientRect();
    const stageRect = stageRef.current.getBoundingClientRect();
    if (stageRect.height <= 0 || stageRect.width <= 0) return;

    // Viewport vertical center in stage coordinates
    const targetY = (vpRect.top + vpRect.height / 2) - stageRect.top;
    const clampedY = Math.max(28, Math.min(stageRect.height - 28, targetY));
    setHandleTop(clampedY);
  }, []);

  // Reset zoom & divider position when switching images
  useEffect(() => {
    setZoom(1);
    setPos(50);
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
    requestAnimationFrame(updateHandlePosition);
  }, [result.id, updateHandlePosition]);

  // Track scroll for floating handle
  const onScroll = useCallback(() => {
    updateHandlePosition();
  }, [updateHandlePosition]);

  // Full-width viewport calculations
  const availW = Math.max(60, (viewportSize.width || 1200) - 32);
  const availH = Math.max(60, (viewportSize.height || 800) - 32);
  const availAspect = availW / availH;

  // Split mode base dimensions
  let baseW: number;
  let baseH: number;
  if (availAspect > imgAspect) {
    baseH = availH;
    baseW = baseH * imgAspect;
  } else {
    baseW = availW;
    baseH = baseW / imgAspect;
  }
  const stageW = Math.max(20, Math.round(baseW * zoom));
  const stageH = Math.max(20, Math.round(baseH * zoom));
  const zoom1to1 = baseW > 0 ? Math.max(1, Math.round((result.outW / baseW) * 100) / 100) : 1;
  const is1to1 = Math.abs(zoom - zoom1to1) < 0.05;

  // Pixel-by-pixel rendering evaluation
  const isPixelated =
    pixelMode === "crisp" ||
    (pixelMode === "auto" && (zoom >= 2 || (zoom >= zoom1to1 && zoom > 1.2)));

  const imageRenderingClass = isPixelated
    ? "pointer-events-none absolute inset-0 h-full w-full object-fill [image-rendering:pixelated]"
    : "pointer-events-none absolute inset-0 h-full w-full object-fill";

  // Side-by-Side base dimensions
  const panelGap = 16;
  const panelAvailW = Math.max(30, (availW - panelGap) / 2);
  const panelAvailH = availH;
  const panelAvailAspect = panelAvailW / panelAvailH;

  let panelBaseW: number;
  let panelBaseH: number;
  if (panelAvailAspect > imgAspect) {
    panelBaseH = panelAvailH;
    panelBaseW = panelBaseH * imgAspect;
  } else {
    panelBaseW = panelAvailW;
    panelBaseH = panelBaseW / imgAspect;
  }
  const panelW = Math.max(20, Math.round(panelBaseW * zoom));
  const panelH = Math.max(20, Math.round(panelBaseH * zoom));

  const updateSplitPos = useCallback((clientX: number) => {
    if (!stageRef.current) return;
    const stageRect = stageRef.current.getBoundingClientRect();
    if (stageRect.width <= 0) return;
    const offset = clientX - stageRect.left;
    const pct = Math.max(0, Math.min(100, (offset / stageRect.width) * 100));
    setPos(Math.round(pct * 10) / 10);
  }, []);

  const bringSliderToView = useCallback(() => {
    if (!viewportRef.current || !stageRef.current) return;
    const vp = viewportRef.current;
    const stage = stageRef.current;
    const vpRect = vp.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width <= 0) return;
    const visibleCenterX = vpRect.left + vpRect.width / 2;
    const offset = visibleCenterX - stageRect.left;
    const pct = Math.max(5, Math.min(95, (offset / stageRect.width) * 100));
    setPos(Math.round(pct * 10) / 10);
  }, []);

  const applyZoom = useCallback(
    (newZoom: number, focalClientX?: number, focalClientY?: number) => {
      const vp = viewportRef.current;
      const stage = stageRef.current;
      const clampedZoom = Math.max(1, Math.min(16, Math.round(newZoom * 100) / 100));

      if (!vp || !stage) {
        setZoom(clampedZoom);
        return;
      }

      if (clampedZoom === 1) {
        setZoom(1);
        requestAnimationFrame(() => {
          vp.scrollLeft = 0;
          vp.scrollTop = 0;
          updateHandlePosition();
        });
        return;
      }

      const vpRect = vp.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();

      const fx = focalClientX ?? (vpRect.left + vpRect.width / 2);
      const fy = focalClientY ?? (vpRect.top + vpRect.height / 2);

      const normX =
        stageRect.width > 0
          ? Math.max(0, Math.min(1, (fx - stageRect.left) / stageRect.width))
          : 0.5;
      const normY =
        stageRect.height > 0
          ? Math.max(0, Math.min(1, (fy - stageRect.top) / stageRect.height))
          : 0.5;

      setZoom(clampedZoom);

      requestAnimationFrame(() => {
        if (!stageRef.current || !viewportRef.current) return;
        const nextStage = stageRef.current;
        const nextVp = viewportRef.current;

        const targetStageW = nextStage.offsetWidth;
        const targetStageH = nextStage.offsetHeight;

        const desiredScrollLeft = normX * targetStageW - (fx - vpRect.left);
        const desiredScrollTop = normY * targetStageH - (fy - vpRect.top);

        const maxScrollLeft = Math.max(0, nextVp.scrollWidth - nextVp.clientWidth);
        const maxScrollTop = Math.max(0, nextVp.scrollHeight - nextVp.clientHeight);

        const actualScrollLeft = Math.max(0, Math.min(maxScrollLeft, desiredScrollLeft));
        const actualScrollTop = Math.max(0, Math.min(maxScrollTop, desiredScrollTop));
        nextVp.scrollLeft = actualScrollLeft;
        nextVp.scrollTop = actualScrollTop;

        // When zooming in (especially 1:1), automatically center the slider in the visible view!
        if (clampedZoom > 1 && targetStageW > 0) {
          const visibleCenterX = actualScrollLeft + nextVp.clientWidth / 2;
          const newPos = Math.max(5, Math.min(95, (visibleCenterX / targetStageW) * 100));
          setPos(Math.round(newPos * 10) / 10);
        }

        updateHandlePosition();
      });
    },
    [updateHandlePosition]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName || "")
      ) {
        e.preventDefault();
        setIsHoldingBefore(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsHoldingBefore(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      applyZoom(zoom * factor, e.clientX, e.clientY);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (zoom > 1.05) {
      applyZoom(1);
    } else {
      const targetZoom = zoom1to1 > 1.4 ? zoom1to1 : 2.5;
      applyZoom(targetZoom, e.clientX, e.clientY);
    }
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    isDraggingHandleRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (isDraggingHandleRef.current) {
      updateSplitPos(e.clientX);
    }
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingHandleRef.current) {
      isDraggingHandleRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (isDraggingHandleRef.current) return;
    if (zoom > 1 && viewportRef.current) {
      isPanningRef.current = true;
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: viewportRef.current.scrollLeft,
        scrollTop: viewportRef.current.scrollTop,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (zoom === 1 && mode === "split") {
      updateSplitPos(e.clientX);
      isDraggingHandleRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onViewportPointerMove = (e: React.PointerEvent) => {
    if (isPanningRef.current && viewportRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      viewportRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      viewportRef.current.scrollTop = panStartRef.current.scrollTop - dy;
      updateHandlePosition();
    } else if (isDraggingHandleRef.current) {
      updateSplitPos(e.clientX);
    }
  };

  const onViewportPointerUp = (e: React.PointerEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
    if (isDraggingHandleRef.current) {
      isDraggingHandleRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const effectivePos = isHoldingBefore ? 100 : pos;

  // Detect if slider has scrolled offscreen during heavy zoom
  let isSliderOffLeft = false;
  let isSliderOffRight = false;
  if (viewportRef.current && stageRef.current && zoom > 1 && mode === "split") {
    const vpRect = viewportRef.current.getBoundingClientRect();
    const stageRect = stageRef.current.getBoundingClientRect();
    const sliderClientX = stageRect.left + (pos / 100) * stageRect.width;
    isSliderOffLeft = sliderClientX < vpRect.left + 40;
    isSliderOffRight = sliderClientX > vpRect.right - 40;
  }
  const isSliderOffscreen = isSliderOffLeft || isSliderOffRight;

  return (
    <div className="relative flex h-full w-full flex-1 flex-col select-none overflow-hidden">
      {/* Pinned Floating Corner Labels (Always Visible During Zoom & Pan) */}
      <div className="pointer-events-none absolute left-6 top-4 z-20 hidden items-center sm:flex">
        <div className="flex items-center gap-2 rounded-xl border border-hairline/80 bg-background/90 px-3 py-1.5 backdrop-blur-md shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Original</span>
          <span className="font-mono text-xs tabular-nums text-foreground">{origW}×{origH}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-6 top-4 z-20 hidden items-center sm:flex">
        <div className="flex items-center gap-2 rounded-xl border border-hairline/80 bg-background/90 px-3 py-1.5 backdrop-blur-md shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Vice {result.scale}×</span>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">{result.outW}×{result.outH}</span>
        </div>
      </div>

      {/* Floating Center HUD: Mode, Zoom, and Inspection Tools */}
      <div className="pointer-events-none absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-hairline/80 bg-background/95 p-1 shadow-xl backdrop-blur-xl ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
          {/* Mode Switcher */}
          <div role="group" aria-label="Comparison View" className="flex items-center rounded-xl bg-foreground/[0.04] p-0.5">
            <button
              type="button"
              onClick={() => setMode("split")}
              aria-pressed={mode === "split"}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                mode === "split"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <SplitViewIcon className="h-3.5 w-3.5" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("side")}
              aria-pressed={mode === "side"}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                mode === "side"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <SideBySideIcon className="h-3.5 w-3.5" />
              <span>Side</span>
            </button>
          </div>

          <span className="mx-0.5 h-4 w-px bg-hairline/80" />

          {/* Zoom Controls */}
          <div role="group" aria-label="Zoom" className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyZoom(1)}
              aria-pressed={zoom === 1}
              title="Fit image to screen"
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                zoom === 1
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              <FitScreenIcon className="h-3.5 w-3.5" />
              <span>Fit</span>
            </button>

            <button
              type="button"
              onClick={() => applyZoom(zoom1to1)}
              aria-pressed={is1to1}
              title={`View at 1:1 physical pixel scale (${result.outW}×${result.outH})`}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                is1to1
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              1:1
            </button>

            <button
              type="button"
              onClick={() => applyZoom(2)}
              aria-pressed={Math.abs(zoom - 2) < 0.1 && !is1to1}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                Math.abs(zoom - 2) < 0.1 && !is1to1
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              2×
            </button>

            <button
              type="button"
              onClick={() => applyZoom(4)}
              aria-pressed={Math.abs(zoom - 4) < 0.1 && !is1to1}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                Math.abs(zoom - 4) < 0.1 && !is1to1
                  ? "bg-foreground text-background font-semibold shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              4×
            </button>

            {/* Stepper with percentage display */}
            <div className="flex items-center rounded-lg bg-foreground/[0.04] p-0.5 ml-0.5">
              <button
                type="button"
                disabled={zoom <= 1}
                onClick={() => applyZoom(Math.max(1, zoom / 1.4))}
                title="Zoom out"
                className="flex h-5 w-5 items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-background/80 disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                <ZoomOutIcon className="h-3 w-3" />
              </button>

              <span className="min-w-[36px] text-center px-1 font-mono text-[11px] tabular-nums font-semibold text-foreground">
                {Math.round(zoom * 100)}%
              </span>

              <button
                type="button"
                disabled={zoom >= 8}
                onClick={() => applyZoom(Math.min(8, zoom * 1.4))}
                title="Zoom in"
                className="flex h-5 w-5 items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-background/80 disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                <ZoomInIcon className="h-3 w-3" />
              </button>
            </div>
          </div>

          <span className="mx-0.5 h-4 w-px bg-hairline/80" />

          {/* Clarity & Inspection Tools */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={isPixelated ? "Pixel Grid active (nearest-neighbor enabled)" : "Smooth interpolation (click for pixel-by-pixel inspection)"}
              onClick={() => setPixelMode((curr) => curr === "crisp" ? "smooth" : "crisp")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                isPixelated
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold shadow-xs"
                  : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
              }`}
            >
              <PixelGridIcon className="h-3.5 w-3.5" />
              <span>{isPixelated ? "Pixel Grid" : "Crisp"}</span>
            </button>

            {zoom > 1 && mode === "split" && (
              <button
                type="button"
                title="Center before/after split slider"
                onClick={bringSliderToView}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  isSliderOffscreen
                    ? "bg-foreground text-background font-semibold shadow-xs"
                    : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
                }`}
              >
                <ChevronLeftRightIcon className="h-3.5 w-3.5" />
                <span>Center</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating edge pills when slider is scrolled off-screen */}
      {isSliderOffLeft && (
        <button
          type="button"
          onClick={bringSliderToView}
          title="Bring slider here"
          className="pointer-events-auto absolute left-6 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <span>← Bring Slider</span>
        </button>
      )}
      {isSliderOffRight && (
        <button
          type="button"
          onClick={bringSliderToView}
          title="Bring slider here"
          className="pointer-events-auto absolute right-6 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <span>Bring Slider →</span>
        </button>
      )}

      {/* Main Full-Width Viewport & Stage */}
      <div
        ref={viewportRef}
        onScroll={onScroll}
        onWheel={onWheel}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onDoubleClick={onDoubleClick}
        title={
          zoom > 1
            ? "Click & drag to pan · Drag vertical line to split · Double-click to fit"
            : "Double-click to inspect 1:1 pixel detail"
        }
        className={`relative flex h-full w-full flex-1 min-h-0 overflow-auto p-4 transition-colors ${
          zoom > 1
            ? "cursor-grab active:cursor-grabbing"
            : mode === "split"
            ? "cursor-ew-resize"
            : "cursor-default"
        }`}
      >
        {mode === "side" ? (
          /* Side-by-Side Mode */
          <div
            ref={stageRef}
            style={{
              width: `${panelW * 2 + panelGap}px`,
              height: `${panelH}px`,
              margin: "auto",
              flexShrink: 0,
            }}
            className="relative flex items-center justify-center gap-4 overflow-hidden rounded-xl shadow-lg"
          >
            <div
              style={{ width: `${panelW}px`, height: `${panelH}px` }}
              className="relative flex-shrink-0 overflow-hidden rounded-xl bg-background/50 shadow-sm"
            >
              <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-md shadow-xs">
                Original ({origW}×{origH})
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.previewUrl}
                alt="original preview"
                draggable={false}
                className={imageRenderingClass}
              />
            </div>

            <div
              style={{ width: `${panelW}px`, height: `${panelH}px` }}
              className="relative flex-shrink-0 overflow-hidden rounded-xl bg-background/50 shadow-sm"
            >
              <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-md shadow-xs">
                {result.scale}× ({result.outW}×{result.outH})
              </span>
              <ViewTransition name="vice-hero-media" share="morph" default="none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.blobUrl}
                  alt="upscaled result"
                  draggable={false}
                  className={imageRenderingClass}
                />
              </ViewTransition>
            </div>
          </div>
        ) : (
          /* Split Comparison Mode */
          <div
            ref={stageRef}
            style={{
              width: `${stageW}px`,
              height: `${stageH}px`,
              margin: "auto",
              flexShrink: 0,
            }}
            className="relative flex items-center justify-center overflow-hidden rounded-xl shadow-lg"
          >
            {/* Upscaled Result Image (After) */}
            <ViewTransition name="vice-hero-media" share="morph" default="none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.blobUrl}
                alt="upscaled result"
                draggable={false}
                className={imageRenderingClass}
              />
            </ViewTransition>

            {/* Original Preview Image (Before) clipped to divider */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.previewUrl}
              alt="original preview"
              draggable={false}
              style={{
                clipPath: `inset(0 ${100 - effectivePos}% 0 0)`,
              }}
              className={imageRenderingClass}
            />

            {/* Spacebar preview indicator */}
            {isHoldingBefore && (
              <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-background/90 px-4 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur-md">
                Showing Original Preview
              </div>
            )}

            {/* Vertical Divider with Floating Always-Visible Handle */}
            <div
              style={{ left: `${effectivePos}%` }}
              className="pointer-events-none absolute inset-y-0 -translate-x-1/2"
            >
              {/* 1px glowing white divider line */}
              <div className="h-full w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.6)]" />

              {/* Extended invisible touch/drag bar spanning entire height with generous hit area */}
              <div
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                className="pointer-events-auto absolute inset-y-0 -left-5 -right-5 cursor-ew-resize"
              />

              {/* Floating Dynamic Grab Handle (Always anchored to visible viewport center) */}
              <div
                style={{ top: `${handleTop}px` }}
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  bringSliderToView();
                }}
                title="Drag to compare · Double-click to center slider"
                aria-label="Drag divider"
                className="pointer-events-auto absolute -translate-y-1/2 -translate-x-1/2 flex h-9 w-9 items-center justify-center rounded-full border border-hairline/80 bg-background text-foreground shadow-xl backdrop-blur-md transition-transform hover:scale-110 active:scale-95 cursor-ew-resize"
              >
                <ChevronLeftRightIcon className="h-4 w-4" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Bottom Bar for Batch Selector (if > 1 image) */}
      {allResults.length > 1 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2">
          <div
            role="group"
            aria-label="Results"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/90 p-1.5 shadow-lg backdrop-blur-md"
          >
            {allResults.map((r) => (
              <div key={r.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectId(r.id)}
                  aria-pressed={result.id === r.id}
                  className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors ${
                    result.id === r.id
                      ? "bg-foreground text-background font-medium shadow-xs"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.previewUrl}
                    alt=""
                    className="h-4 w-4 rounded-full object-cover"
                  />
                  <span className="max-w-[80px] truncate">{r.name}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
