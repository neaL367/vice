"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";
import { useView } from "./use-view";

// Workspace owns job + view state. Layout pinning:
// - the measured box fills the area; canvas never positions chrome;
// - toolbar, labels, status are SIBLINGS of the box, anchored to this
//   relative container (the app viewport area), never to image content;
// - the dock sits below in normal flow and can never cover the image.
export function Workspace() {
  const { job, openImage, upscale } = useStudioJob();
  const [scale, setScale] = useState<2 | 3 | 4>(2);

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
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
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
  scale: 2 | 3 | 4;
  setScale: (s: 2 | 3 | 4) => void;
  take: (f: File | undefined) => void;
  download: (out: StudioImage, name: string, s: number) => void;
  upscale: (s: 2 | 3 | 4) => Promise<void>;
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
  } = useView(input, result, working);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <ImageStage
          input={input}
          result={result}
          working={working}
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
          setSplit={setSplit}
        />
        {/* Chrome: viewport-anchored siblings of the measured box. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-3 flex items-start justify-between px-4"
          aria-hidden="true"
        >
          <div>
            {result ? (
              <span className="text-[11px] tracking-widest text-white/70 uppercase">
                Original
              </span>
            ) : (
              <span className="block max-w-[40vw] truncate font-mono text-[11px] text-white/50 tabular-nums">
                {job.name}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div>
              {result ? (
                <span className="text-[11px] tracking-widest text-white/70 uppercase">
                  Enhanced
                </span>
              ) : (
                <span className="font-mono text-[11px] text-white/50 tabular-nums">
                  {job.kind === "working"
                    ? "Working…"
                    : `${input.w}×${input.h}`}
                </span>
              )}
            </div>
            {job.kind === "done" && (
              <div className="font-mono text-[11px] text-white/40 tabular-nums">
                Ready · {job.output.w}×{job.output.h} · {job.ms.toFixed(0)} ms ·{" "}
                {job.residual.toExponential(1)}
              </div>
            )}
          </div>
        </div>
        <div
          className="absolute top-12 right-3 flex items-center gap-0.5 rounded-full bg-black/70 px-1 py-1 text-[13px] text-stone-200"
          role="group"
          aria-label="Zoom"
          onPointerDown={(e) => e.stopPropagation()}
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
            onClick={() => zoomBy(1.25)}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
        {job.kind === "error" && (
          <p
            role="alert"
            className="absolute top-12 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[13px] text-[#e07856]"
          >
            {job.message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 justify-center px-4 pt-3 pb-4">
        <Controls
          scale={scale}
          setScale={setScale}
          inDims={`${input.w}×${input.h}`}
          outDims={`${input.w * scale}×${input.h * scale}`}
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
