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
  mode = "split",
}: {
  input: StudioImage;
  result: StudioImage | null;
  rect: Rect;
  fraction: number; // 0..1 image fraction: enhanced revealed right of it
  mode?: "split" | "diff";
}) {
  const inRef = useRef<HTMLCanvasElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);
  const diffRef = useRef<HTMLCanvasElement>(null);
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

  // Compute amplified difference heatmap when in diff view mode
  useEffect(() => {
    if (!result || mode !== "diff" || !diffRef.current) return;
    const c = diffRef.current;
    c.width = result.w;
    c.height = result.h;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    // Resample original input to result size via nearest-neighbor offscreen stage
    const offscreen = document.createElement("canvas");
    offscreen.width = result.w;
    offscreen.height = result.h;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;
    offCtx.imageSmoothingEnabled = false;

    const inStage = document.createElement("canvas");
    inStage.width = input.w;
    inStage.height = input.h;
    const inCtx = inStage.getContext("2d");
    if (!inCtx) return;
    inCtx.putImageData(new ImageData(input.data, input.w, input.h), 0, 0);
    offCtx.drawImage(inStage, 0, 0, result.w, result.h);

    const inImgData = offCtx.getImageData(0, 0, result.w, result.h);
    const inData = inImgData.data;
    const resData = result.data;
    const diffImg = ctx.createImageData(result.w, result.h);
    const dOut = diffImg.data;

    for (let i = 0; i < resData.length; i += 4) {
      const dR = Math.abs(inData[i] - resData[i]);
      const dG = Math.abs(inData[i + 1] - resData[i + 1]);
      const dB = Math.abs(inData[i + 2] - resData[i + 2]);
      const mag = (dR + dG + dB) / 3;
      // 8x amplification capped to [0, 255]
      const amp = Math.min(255, mag * 8);

      // Turbo/heat color map (0 -> Dark Blue, 128 -> Orange/Yellow, 255 -> Red)
      if (amp < 64) {
        dOut[i] = 0;
        dOut[i + 1] = Math.round(amp * 4);
        dOut[i + 2] = 128 + Math.round(amp * 2);
      } else if (amp < 128) {
        dOut[i] = Math.round((amp - 64) * 4);
        dOut[i + 1] = 255;
        dOut[i + 2] = 255 - Math.round((amp - 64) * 4);
      } else {
        dOut[i] = 255;
        dOut[i + 1] = Math.max(0, 255 - Math.round((amp - 128) * 2));
        dOut[i + 2] = 0;
      }
      dOut[i + 3] = 255;
    }
    ctx.putImageData(diffImg, 0, 0);
  }, [input, result, mode]);

  // Keep all canvases mounted continuously so their pixel buffers are never destroyed
  // on mode transitions (switching between split comparison and difference heatmap).
  return (
    <div
      className={`absolute overflow-hidden ${alpha ? "vx-checker" : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <canvas ref={inRef} className="absolute inset-0 h-full w-full" />
      {result && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            clipPath: calculateClip(fraction),
            display: mode === "split" ? "block" : "none",
          }}
        >
          <canvas ref={outRef} className="absolute inset-0 h-full w-full" />
        </div>
      )}
      {result && (
        <canvas
          ref={diffRef}
          className="absolute inset-0 h-full w-full"
          style={{ display: mode === "diff" ? "block" : "none" }}
        />
      )}
    </div>
  );
}
