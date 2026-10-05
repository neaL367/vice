"use client";

import { memo, type ReactNode } from "react";
import { ViewTransition } from "react";
import type { ViceResult } from "../../types/vice";
import {
  ChevronLeftRightIcon,
  FitScreenIcon,
  PixelGridIcon,
  SideBySideIcon,
  SplitViewIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "../studio-icons";
import { ComparisonProvider, useComparison } from "./comparison-context";

// --- 1. Root ---
export function ComparisonRoot({
  result,
  allResults,
  onSelectId,
  children,
}: {
  result: ViceResult;
  allResults?: ViceResult[];
  onSelectId?: (id: number) => void;
  children: ReactNode;
}) {
  return (
    <ComparisonProvider
      result={result}
      allResults={allResults}
      onSelectId={onSelectId}
    >
      <div className="relative flex h-full w-full flex-1 flex-col select-none overflow-hidden">
        {children}
      </div>
    </ComparisonProvider>
  );
}

// --- 2. Split Stage ---
export const ComparisonSplit = memo(function ComparisonSplit() {
  const {
    stageRef,
    stageW,
    stageH,
    result,
    imageRenderingClass,
    effectivePos,
    isHoldingBefore,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    bringSliderToView,
  } = useComparison();

  return (
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

      {/* Side Labels */}
      <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-foreground backdrop-blur-md shadow-2xs">
        Original
      </span>
      <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-background/80 px-2.5 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur-md shadow-2xs">
        Vice {result.scale}×
      </span>

      {/* Spacebar preview indicator */}
      {isHoldingBefore && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-background/90 px-4 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur-md">
          Showing Original Preview
        </div>
      )}

      {/* Vertical Divider with Centered Grab Handle */}
      <div
        style={{ left: `${effectivePos}%` }}
        className="pointer-events-none absolute inset-y-0 -translate-x-1/2 z-20"
      >
        {/* 1.5px glowing white divider line */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.8)]" />

        {/* Generous touch/drag hit area spanning entire height */}
        <div
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          style={{ touchAction: "none" }}
          className="pointer-events-auto absolute inset-y-0 -left-6 -right-6 cursor-ew-resize"
        />

        {/* Centered Grab Handle */}
        <div
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
          style={{ touchAction: "none" }}
          className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border border-hairline/80 bg-background text-foreground shadow-2xl backdrop-blur-md transition-transform hover:scale-110 active:scale-95 cursor-ew-resize select-none"
        >
          <ChevronLeftRightIcon className="h-4 w-4" />
        </div>
      </div>

    </div>
  );
});

// --- 3. Side-by-Side Stage ---
export const ComparisonSide = memo(function ComparisonSide() {
  const {
    stageRef,
    panelW,
    panelH,
    panelGap,
    result,
    imageRenderingClass,
  } = useComparison();

  return (
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
        <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-foreground backdrop-blur-md shadow-2xs">
          Original
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
        <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-background/80 px-2.5 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur-md shadow-2xs">
          Vice {result.scale}×
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
  );
});

// --- 4. Viewport Container ---
export const ComparisonViewport = memo(function ComparisonViewport() {
  const {
    viewportRef,
    onWheel,
    onViewportScroll,
    onViewportPointerDown,
    onViewportPointerMove,
    onViewportPointerUp,
    onDoubleClick,
    zoom,
    mode,
    isSliderOffLeft,
    isSliderOffRight,
    bringSliderToView,
  } = useComparison();

  return (
    <>
      {/* Floating edge pills when slider is scrolled off-screen */}
      {isSliderOffLeft && (
        <button
          type="button"
          onClick={bringSliderToView}
          title="Bring slider here"
          className="pointer-events-auto absolute left-6 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer animate-in fade-in"
        >
          <span>← Bring Slider</span>
        </button>
      )}
      {isSliderOffRight && (
        <button
          type="button"
          onClick={bringSliderToView}
          title="Bring slider here"
          className="pointer-events-auto absolute right-6 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer animate-in fade-in"
        >
          <span>Bring Slider →</span>
        </button>
      )}

      <div
        ref={viewportRef}
        onWheel={onWheel}
        onScroll={onViewportScroll}
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
        {mode === "side" ? <ComparisonSide /> : <ComparisonSplit />}
      </div>
    </>
  );
});

// --- 5. Floating Bottom Dock (HUD) ---
export const ComparisonHud = memo(function ComparisonHud() {
  const {
    mode,
    setMode,
    zoom,
    zoomPreset,
    zoom1to1,
    applyZoom,
    setPixelMode,
    isPixelated,
    isSliderOffscreen,
    bringSliderToView,
    result,
  } = useComparison();

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/85 p-1 shadow-2xl backdrop-blur-2xl ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
        {/* Mode Switcher */}
        <div
          role="group"
          aria-label="Comparison View"
          className="flex items-center rounded-full bg-foreground/[0.04] p-0.5"
        >
          <button
            type="button"
            onClick={() => setMode("split")}
            aria-pressed={mode === "split"}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              mode === "split"
                ? "bg-background text-foreground shadow-2xs font-semibold"
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
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              mode === "side"
                ? "bg-background text-foreground shadow-2xs font-semibold"
                : "text-muted hover:text-foreground"
            }`}
          >
            <SideBySideIcon className="h-3.5 w-3.5" />
            <span>Side</span>
          </button>
        </div>

        <span className="mx-0.5 h-3.5 w-px bg-hairline/70" />

        {/* Zoom Controls */}
        <div role="group" aria-label="Zoom" className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => applyZoom(1, undefined, undefined, "fit")}
            aria-pressed={zoomPreset === "fit"}
            title="Fit image to screen"
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
              zoomPreset === "fit"
                ? "bg-foreground text-background font-semibold shadow-2xs"
                : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
            }`}
          >
            <FitScreenIcon className="h-3.5 w-3.5" />
            <span>Fit</span>
          </button>

          <button
            type="button"
            onClick={() => applyZoom(zoom1to1, undefined, undefined, "1:1")}
            aria-pressed={zoomPreset === "1:1"}
            title={`View at 1:1 physical pixel scale (${result.outW}×${result.outH})`}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
              zoomPreset === "1:1"
                ? "bg-foreground text-background font-semibold shadow-2xs"
                : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
            }`}
          >
            1:1
          </button>

          <button
            type="button"
            onClick={() => applyZoom(2, undefined, undefined, "2")}
            aria-pressed={zoomPreset === "2"}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
              zoomPreset === "2"
                ? "bg-foreground text-background font-semibold shadow-2xs"
                : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
            }`}
          >
            2×
          </button>

          <button
            type="button"
            onClick={() => applyZoom(4, undefined, undefined, "4")}
            aria-pressed={zoomPreset === "4"}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
              zoomPreset === "4"
                ? "bg-foreground text-background font-semibold shadow-2xs"
                : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
            }`}
          >
            4×
          </button>

          {/* Stepper with percentage display */}
          <div className="flex items-center rounded-full bg-foreground/[0.04] p-0.5 ml-0.5">
            <button
              type="button"
              disabled={zoom <= 1}
              onClick={() => applyZoom(Math.max(1, zoom / 1.4))}
              title="Zoom out"
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-background/80 disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <ZoomOutIcon className="h-3 w-3" />
            </button>

            <span className="min-w-[34px] text-center px-1 font-mono text-[11px] tabular-nums font-semibold text-foreground">
              {Math.round(zoom * 100)}%
            </span>

            <button
              type="button"
              disabled={zoom >= 8}
              onClick={() => applyZoom(Math.min(8, zoom * 1.4))}
              title="Zoom in"
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-background/80 disabled:opacity-30 disabled:pointer-events-none transition-all"
            >
              <ZoomInIcon className="h-3 w-3" />
            </button>
          </div>
        </div>

        <span className="mx-0.5 h-3.5 w-px bg-hairline/70" />

        {/* Clarity & Center Tools */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={
              isPixelated
                ? "Pixel Grid active (nearest-neighbor)"
                : "Smooth interpolation (click for pixel-by-pixel inspection)"
            }
            onClick={() => setPixelMode((curr) => (curr === "crisp" ? "smooth" : "crisp"))}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              isPixelated
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold shadow-2xs"
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
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                isSliderOffscreen
                  ? "bg-foreground text-background font-semibold shadow-2xs"
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
  );
});

// --- 6. Batch Strip ---
export const ComparisonBatchStrip = memo(function ComparisonBatchStrip() {
  const { allResults, result, onSelectId } = useComparison();
  if (allResults.length <= 1) return null;

  return (
    <div className="pointer-events-none absolute bottom-20 left-1/2 z-30 -translate-x-1/2">
      <div
        role="group"
        aria-label="Results"
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-hairline/80 bg-background/85 p-1 shadow-xl backdrop-blur-2xl"
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
  );
});

// Export Compound Comparison object
export const Comparison = {
  Root: ComparisonRoot,
  Viewport: ComparisonViewport,
  Split: ComparisonSplit,
  Side: ComparisonSide,
  Hud: ComparisonHud,
  BatchStrip: ComparisonBatchStrip,
};
