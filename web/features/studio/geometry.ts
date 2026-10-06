// Comparison geometry: pure functions, no React. ONE canonical image rect
// shared by both layers; the divider only clips. Nothing here is stored in
// state — callers keep {viewport, image, zoom, pan, split} and derive.

export interface Rect {
  x: number; // viewport px, left edge of the shared image rect
  y: number; // viewport px, top edge
  w: number; // viewport px
  h: number; // viewport px
}

/** Fit rect: largest same-aspect rect centered in the viewport. */
export function calculateFit(viewW: number, viewH: number, imgW: number, imgH: number): Rect {
  if (viewW <= 0 || viewH <= 0 || imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(viewW / imgW, viewH / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (viewW - w) / 2, y: (viewH - h) / 2, w, h };
}

/**
 * Zoomed rect: scale the fit rect about the viewport center, then translate
 * by pan. zoom=1 returns the fit rect exactly.
 */
export function calculateRect(fit: Rect, viewW: number, viewH: number, zoom: number, pan: { x: number; y: number }): Rect {
  const w = fit.w * zoom;
  const h = fit.h * zoom;
  const cx = viewW / 2;
  const cy = viewH / 2;
  // Point under the viewport center stays fixed as zoom changes; pan shifts.
  return { x: cx - (cx - fit.x) * zoom + pan.x, y: cy - (cy - fit.y) * zoom + pan.y, w, h };
}

/** 100% zoom multiplier for the canonical (input) pixel grid. */
export function hundredPercentZoom(fit: Rect, imgW: number): number {
  if (fit.w <= 0 || imgW <= 0) return 1;
  return imgW / fit.w;
}

/** Clip for the enhanced layer inside rect space: reveal right of fraction f. */
export function calculateClip(fraction: number): string {
  const pct = Math.min(100, Math.max(0, fraction * 100));
  return `inset(0 0 0 ${pct}%)`;
}

/** Divider viewport-x from image fraction + shared rect. */
export function dividerViewportX(rect: Rect, fraction: number): number {
  return rect.x + rect.w * Math.min(1, Math.max(0, fraction));
}

/** Image fraction from a viewport-relative x (0 = viewport left edge). */
export function fractionFromViewportX(rect: Rect, viewportX: number): number {
  if (rect.w <= 0) return 0.5;
  return Math.min(1, Math.max(0, (viewportX - rect.x) / rect.w));
}
