"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { Scale, StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";
import { useView } from "./use-view";
import { fitsEightX } from "../../lib/engine";

// Workspace owns job + view state. Layout pinning:
// - the measured box fills the area; canvas never positions chrome;
// - toolbar, labels, status are SIBLINGS of the box, anchored to this
//   relative container (the app viewport area), never to image content;
// - the dock sits below in normal flow and can never cover the image.
export function Workspace() {
  const { job, openImage, upscale } = useStudioJob();
  const [scale, setScale] = useState<Scale>(2);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const { image, name } = await decodeFile(f);
      openImage(image, name);
    } catch {
      // Dropzone surfaces its own errors; the dock picker stays silent-safe.
    }
  }

  function download(out: StudioImage, name: string, s: number) {
    const c = document.createElement("canvas");
    c.width = out.w;
    c.height = out.h;
    c.getContext("2d")!.putImageData(
      new ImageData(out.data, out.w, out.h),
      0,
      0,
    );
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = name.replace(/\.[^.]+$/, "") + `-${s}x.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  if (job.kind === "idle") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Dropzone onImage={openImage} />
      </div>
    );
  }

  const input = job.input;
  if (!input) {
    return (
      <p role="alert" className="p-6 text-[14px] text-[#e07856]">
        We couldn&apos;t process this image.
      </p>
    );
  }
  // Keyed per image so view state (zoom/pan/split) resets on new uploads.
  return (
    <ActiveWorkspace
      key={`${job.name}-${input.w}x${input.h}`}
      input={input}
      job={job}
      scale={scale}
      setScale={setScale}
      take={take}
      download={download}
      upscale={upscale}
    />
  );
}

function ActiveWorkspace({
  input,
  job,
  scale,
  setScale,
  take,
  download,
  upscale,
}: {
  input: StudioImage;
  job: Exclude<ReturnType<typeof useStudioJob>["job"], { kind: "idle" }>;
  scale: Scale;
  setScale: (s: Scale) => void;
  take: (f: File | undefined) => void;
  download: (out: StudioImage, name: string, s: number) => void;
  upscale: (s: Scale) => Promise<void>;
}) {
  const result = job.kind === "done" ? job.output : null;
  const working = job.kind === "working";
  const {
    attachBox,
    measure,
    rect,
    fraction,
    dividerX,
    zoomed,
    dragging,
    onPointerDown,
    onWheel,
    onDoubleClick,
    onKeyDown,
    resetView,
    zoomBy,
    zoomToHundred,
    setSplit,
    centerComparison,
  } = useView(input, result, working);
  // First-run coachmark: ActiveWorkspace remounts per image (keyed above),
  // so the hint returns for each new upload and retires on first touch.
  const [touched, setTouched] = useState(false);
  const split = (f: number) => {
    setTouched(true);
    setSplit(f);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar in normal flow: filename, status, and zoom live here so the
          image area stays clean — nothing floats over pixels anymore. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pt-2 pb-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span className="block max-w-[40vw] truncate font-mono text-[11px] text-white/50 tabular-nums">
            {job.name}
          </span>
          <span className="font-mono text-[11px] text-white/50 tabular-nums">
            {job.kind === "working"
              ? "Working…"
              : `${input.w}×${input.h}`}
          </span>
          {job.kind === "done" && (
            <div
              className="font-mono text-[11px] text-white/40 tabular-nums"
              title={`forward residual ${job.residual.toExponential(1)}`}
            >
              Ready · {job.output.w}×{job.output.h} · {job.scale}× ·{" "}
              {(job.ms / 1000).toFixed(1)}s
            </div>
          )}
          {result && (
            <span className="text-[11px] tracking-widest text-white/40 uppercase">
              Original | Enhanced
            </span>
          )}
          {job.kind === "error" && (
            <p role="alert" className="text-[13px] text-[#e07856]">
              {job.message}
            </p>
          )}
        </div>
        <div
          className="flex items-center gap-0.5 rounded-full bg-black/70 px-1 py-1 text-[13px] text-stone-200"
          role="group"
          aria-label="Zoom"
        >
          <button
            className="rounded-full px-2.5 py-1 hover:bg-white/10"
            onClick={() => zoomBy(1 / 1.25)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            className="rounded-full px-2.5 py-1 hover:bg-white/10"
            onClick={zoomToHundred}
            aria-label="100 percent"
          >
            1:1
          </button>
          <button
            className="rounded-full px-2.5 py-1 hover:bg-white/10"
            onClick={resetView}
            aria-label="Fit to view"
          >
            Fit
          </button>
          <button
            className="rounded-full px-2.5 py-1 hover:bg-white/10"
            onClick={centerComparison}
            aria-label="Center comparison divider"
          >
            Center
          </button>
          <button
            className="rounded-full px-2.5 py-1 hover:bg-white/10"
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <ImageStage
          input={input}
          result={result}
          working={working}
          startedAt={job.kind === "working" ? job.startedAt : null}
          progress={job.kind === "working" ? job.progress : null}
          attachBox={attachBox}
          measure={measure}
          rect={rect}
          fraction={fraction}
          dividerX={dividerX}
          zoomed={zoomed}
          dragging={dragging}
          onPointerDown={onPointerDown}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onKeyDown={onKeyDown}
          setSplit={split}
        />
        {result && !touched && !working && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[12px] font-medium whitespace-nowrap text-stone-900 shadow-lg"
            style={{ left: `${dividerX}px`, top: `${rect.y + 8}px` }}
          >
            Drag to compare
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-center px-4 pt-3 pb-4">
        <Controls
          scale={scale}
          setScale={setScale}
          inDims={`${input.w}×${input.h}`}
          outDims={`${input.w * scale}×${input.h * scale}`}
          canUse8={fitsEightX(input.w, input.h)}
          canRun={job.kind === "ready" || job.kind === "done"}
          working={working}
          canDownload={job.kind === "done"}
          onUpscale={() => void upscale(scale)}
          onDownload={() => {
            if (job.kind === "done") download(job.output, job.name, job.scale);
          }}
          onNewImage={(f) => void take(f)}
        />
      </div>
    </div>
  );
}
