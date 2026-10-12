"use client";

import { useEffect, useMemo, useRef } from "react";
import type { StudioImage } from "./model";
import { hasAlpha } from "./model";
import { calculateClip, type Rect } from "./geometry";

// ComparisonViewport: ONE canonical rect shared by both layers. The rect div
// is the only positioned/transformed element; OriginalLayer and EnhancedLayer
// are absolute inset-0 inside it (identical geometry by construction); the
// divider controls ONLY the enhanced clip. Pixels are drawn once per image.
export function ComparisonViewport({
  input,
  result,
  rect,
  fraction,
}: {
  input: StudioImage;
  result: StudioImage | null;
  rect: Rect;
  fraction: number; // 0..1 image fraction: enhanced revealed right of it
}) {
  const inRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);
  // Kept manual: hasAlpha scans pixels and ComparisonViewport re-renders every
  // animation frame during smooth zoom — the compiler can't know this is
  // render-frequency-sensitive, so stabilize explicitly per the "expensive +
  // frequent render" rule.
  const alpha = useMemo(() => hasAlpha(input), [input]);

  useEffect(() => {
    let canceled = false;
    const c = inRef.current;
    if (!c) return;
    c.width = input.w;
    c.height = input.h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (typeof createImageBitmap === "function") {
      void createImageBitmap(new ImageData(input.data, input.w, input.h)).then((bmp) => {
        if (canceled) {
          bmp.close();
          return;
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
      });
    } else {
      ctx.putImageData(new ImageData(input.data, input.w, input.h), 0, 0);
    }
    return () => {
      canceled = true;
    };
  }, [input]);

  useEffect(() => {
    if (!result || !outRef.current) return;
    let canceled = false;
    const c = outRef.current;
    c.width = result.w;
    c.height = result.h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (typeof createImageBitmap === "function") {
      void createImageBitmap(new ImageData(result.data, result.w, result.h)).then((bmp) => {
        if (canceled) {
          bmp.close();
          return;
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
      });
    } else {
      ctx.putImageData(new ImageData(result.data, result.w, result.h), 0, 0);
    }
    return () => {
      canceled = true;
    };
  }, [result]);

  return (
    <div
      className={`absolute overflow-hidden ${alpha ? "vx-checker" : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <canvas ref={inRef} className="absolute inset-0 h-full w-full" />
      {result && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: calculateClip(fraction) }}
        >
          <canvas ref={outRef} className="absolute inset-0 h-full w-full" />
        </div>
      )}
    </div>
  );
}
