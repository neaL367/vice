"use client";

import { useEffect, useMemo, useRef } from "react";
import type { StudioImage } from "./model";
import { hasAlpha } from "./model";

// Viewport: draws input (and result when present) to canvases once per image.
// Both layers render at identical CSS sizes (cssW/cssH from the stage) so the
// comparison split always aligns; zoom/pan are pure translations of sizes
// computed upstream — no re-draw, no layout thrash.
export function ImageViewport({
  input,
  result,
  split,
  cssW,
  cssH,
  pan,
}: {
  input: StudioImage;
  result: StudioImage | null;
  split: number; // 0..100, % of width showing result (right side)
  cssW: number; // display size in px, identical for both layers
  cssH: number;
  pan: { x: number; y: number };
}) {
  const inRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);
  // Derived during render, not stored: alpha is a pure function of pixels.
  const alpha = useMemo(() => hasAlpha(input), [input]);

  useEffect(() => {
    const c = inRef.current!;
    c.width = input.w;
    c.height = input.h;
    c.getContext("2d")!.putImageData(new ImageData(input.data, input.w, input.h), 0, 0);
  }, [input]);

  useEffect(() => {
    if (!result || !outRef.current) return;
    const c = outRef.current;
    c.width = result.w;
    c.height = result.h;
    c.getContext("2d")!.putImageData(new ImageData(result.data, result.w, result.h), 0, 0);
  }, [result]);

  const frame = (extra?: React.CSSProperties): React.CSSProperties => ({
    width: Math.max(1, Math.round(cssW)),
    height: Math.max(1, Math.round(cssH)),
    transform: `translate(${pan.x}px, ${pan.y}px)`,
    flex: "none",
    ...extra,
  });

  return (
    <div className={`relative h-full w-full overflow-hidden bg-stage ${alpha ? "vx-checker" : ""}`}>
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <canvas ref={inRef} style={frame()} />
      </div>
      {result && (
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        >
          <canvas ref={outRef} style={frame()} />
        </div>
      )}
    </div>
  );
}
