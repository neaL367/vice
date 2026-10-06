"use client";

import { useEffect, useMemo, useRef } from "react";
import type { StudioImage } from "./model";
import { hasAlpha } from "./model";

// Viewport: draws input (and result when present) to canvases once per image;
// zoom/pan run on CSS transforms (no re-draw, no layout thrash).
export function ImageViewport({
  input,
  result,
  split,
  zoom,
  pan,
}: {
  input: StudioImage;
  result: StudioImage | null;
  split: number; // 0..100, % of width showing result (right side)
  zoom: number; // multiplier over fit
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

  // Stage-relative scale: the result canvas is scale× the input canvas in px.
  const s = result ? result.w / input.w : 1;
  const style = (extra?: React.CSSProperties): React.CSSProperties => ({
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: "center",
    ...extra,
  });

  return (
    <div className={`relative h-full w-full overflow-hidden bg-stage ${alpha ? "vx-checker" : ""}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <canvas ref={inRef} style={style({ maxWidth: "100%", maxHeight: "100%" })} className="h-auto w-auto" />
      </div>
      {result && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          aria-hidden={false}
        >
          <canvas
            ref={outRef}
            style={style({ maxWidth: `${100 * s}%`, maxHeight: `${100 * s}%` })}
            className="h-auto w-auto"
          />
        </div>
      )}
    </div>
  );
}
