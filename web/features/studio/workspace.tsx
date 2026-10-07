"use client";

import { useEffect, useRef, useState } from "react";
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
//
// React notes: plain components by design — the React Compiler (enabled in
// next.config.ts) owns memoization. No manual useMemo/useCallback here.
export function Workspace() {
  const { job, openImage, openBurst, reset, upscale } = useStudioJob();
  const [scale, setScale] = useState<Scale>(2);
  // Replace-path failures (dock picker, header picker, drop, paste) must
  // never fail silent — a dead "nothing happens" is worse than an error.
  const [pickError, setPickError] = useState<string | null>(null);

  async function take(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setPickError("That file isn't an image. Try another image.");
      return;
    }
    try {
      const { image, name } = await decodeFile(f);
      setPickError(null);
      openImage(image, name);
    } catch {
      setPickError("We couldn't read this image. Try another image.");
    }
  }

  // Multi-file drop/pick opens a burst (frame 0 = reference). Burst fusion
  // stops at 4×, so an armed 8× falls back to 2× on entry.
  async function takeBurst(fs: File[]) {
    const imgs = fs.filter((f) => f.type.startsWith("image/")).slice(0, 8);
    if (imgs.length === 0) {
      setPickError("That file isn't an image. Try another image.");
      return;
    }
    if (imgs.length < 2) {
      await take(imgs[0]);
      return;
    }
    try {
      const decoded = await Promise.all(imgs.map((f) => decodeFile(f)));
      if (scale === 8) setScale(2);
      setPickError(null);
      openBurst(decoded);
    } catch {
      setPickError("We couldn't read these images. Try other images.");
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
        <Dropzone onImage={openImage} onBurst={takeBurst} />
      </div>
    );
  }

  const input = job.input;
  if (!input) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0e0d0c] p-6">
        <p role="alert" className="text-[14px] text-[#ff9d94]">
          We couldn&apos;t process this image.
        </p>
      </div>
    );
  }
  // Keyed per image so view state (zoom/pan/split) resets on new uploads.
  // Burst uploads re-key on frame count so switching single↔burst resets too.
  // (Past the idle early-return above, job is never idle here.)
  const frameCount = job.frames?.length ?? 1;
  return (
    <ActiveWorkspace
      key={`${job.name}-${input.w}x${input.h}-${frameCount}`}
      input={input}
      job={job}
      scale={scale}
      setScale={setScale}
      pickError={pickError}
      onPickFiles={(fs) => {
        if (fs.length > 1) void takeBurst(fs);
        else void take(fs[0]);
      }}
      onReset={reset}
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
  pickError,
  onPickFiles,
  onReset,
  download,
  upscale,
}: {
  input: StudioImage;
  job: Exclude<ReturnType<typeof useStudioJob>["job"], { kind: "idle" }>;
  scale: Scale;
  setScale: (s: Scale) => void;
  pickError: string | null;
  onPickFiles: (fs: File[]) => void;
  onReset: () => void;
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

  // Accept new images anywhere in the active view: drag-drop + paste keep
  // working after the first upload, so replacing never needs a refresh.
  // Parent callback arrives via ref so listeners subscribe once.
  const pickRef = useRef(onPickFiles);
  useEffect(() => {
    pickRef.current = onPickFiles;
  }, [onPickFiles]);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const fs = [...(e.clipboardData?.items ?? [])]
        .map((i) => (i.type.startsWith("image/") ? i.getAsFile() : null))
        .filter((f): f is File => f !== null);
      if (fs.length > 0) {
        e.preventDefault();
        pickRef.current(fs);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function imageFiles(dt: DataTransfer | null): File[] {
    if (!dt) return [];
    return [...(dt.files ?? [])].filter((f) => f.type.startsWith("image/"));
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[#0e0d0c]"
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        const fs = imageFiles(e.dataTransfer);
        if (fs.length === 0) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        pickRef.current(fs);
      }}
    >
      {/* Slim header: brand · file meta · status · zoom */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#2a2724] bg-[#0e0d0c]/90 px-3 py-2 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={onReset}
            title="Back to start"
            aria-label="Back to start"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f5f4f0] text-[14px] font-semibold text-[#0e0d0c]"
          >
            V
          </button>
          <span className="text-[14px] font-semibold tracking-tight text-[#f5f4f0]">Vice</span>
          <span className="hidden h-4 w-px bg-[#2a2724] sm:block" aria-hidden="true" />
          <span className="block max-w-[28vw] truncate font-mono text-[11.5px] text-[#a8a29e] tabular-nums">
            {job.name}
          </span>
          <span className="hidden font-mono text-[11.5px] text-[#6f6c66] tabular-nums sm:block">
            {input.w}×{input.h}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
              job.kind === "done"
                ? "border-[#2f4a2f] bg-[#122416] text-[#9fd6a4]"
                : job.kind === "working"
                  ? "border-[#2a2724] bg-[#171512] text-[#a8a29e]"
                  : job.kind === "error"
                    ? "border-[#5a2b27] bg-[#2a1512] text-[#ff9d94]"
                    : "border-[#2a2724] bg-[#171512] text-[#a8a29e]"
            }`}
          >
            {working && <span className="vx-spinner !h-3 !w-3 !border-2" aria-hidden="true" />}
            {job.kind === "done"
              ? `Ready · ${job.output.w}×${job.output.h} · ${job.scale}× · ${(job.ms / 1000).toFixed(1)}s${job.frames && job.frames.length > 1 ? ` · fused ${job.frames.length}` : ""}`
              : job.kind === "working"
                ? "Working…"
                : job.kind === "error"
                  ? "Something went wrong"
                  : "Preview — pick a scale, then Upscale"}
          </span>
          <div
            className="flex items-center gap-0.5 rounded-full border border-[#2a2724] bg-[#171512] p-0.5 text-[12.5px]"
            role="group"
            aria-label="Zoom"
          >
            <button
              className="rounded-full px-2.5 py-1 text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]"
              onClick={() => zoomBy(1 / 1.25)}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <button
              className="rounded-full px-2.5 py-1 text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]"
              onClick={zoomToHundred}
              aria-label="100 percent"
              title="Actual pixels (100%)"
            >
              1:1
            </button>
            <button
              className="rounded-full px-2.5 py-1 text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]"
              onClick={resetView}
              aria-label="Fit to view"
              title="Fit to view"
            >
              Fit
            </button>
            {result && (
              <button
                className="rounded-full px-2.5 py-1 text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]"
                onClick={centerComparison}
                aria-label="Center comparison divider"
                title="Center comparison divider"
              >
                Center
              </button>
            )}
            <button
              className="rounded-full px-2.5 py-1 text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]"
              onClick={() => zoomBy(1.25)}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
          </div>
          <label className="cursor-pointer rounded-full border border-[#2a2724] bg-[#171512] px-3 py-1.5 text-[12px] font-medium text-[#a8a29e] hover:bg-white/[0.06] hover:text-[#f5f4f0]">
            New image
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])];
                e.target.value = "";
                if (fs.length > 0) pickRef.current(fs);
              }}
            />
          </label>
        </div>
        {job.kind === "error" && (
          <p role="alert" className="basis-full text-[13px] font-medium text-[#ff9d94]">
            {job.message}
          </p>
        )}
      </header>

      {/* Stage: padded card, never under the dock */}
      <div className="min-h-0 flex-1 bg-[#0e0d0c] px-3 pt-3 sm:px-5">
        <div className="relative h-full min-h-0 overflow-hidden rounded-2xl border border-[#2a2724] bg-[#0c0b0a] shadow-[0_24px_64px_-32px_rgba(0,0,0,0.9)]">
          <ImageStage
            input={input}
            result={result}
            working={working}
            startedAt={job.kind === "working" ? job.startedAt : null}
            progress={job.kind === "working" ? job.progress : null}
            framesN={job.frames?.length ?? 1}
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
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-full bg-[#f5f4f0] px-3 py-1.5 text-[12px] font-medium whitespace-nowrap text-[#0e0d0c] shadow-lg"
              style={{ left: `${dividerX}px`, top: `${rect.y + 12}px` }}
            >
              Drag to compare
            </div>
          )}
          {/* Corner hint: scroll to zoom · drag to pan/compare */}
          <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-[#a8a29e] backdrop-blur md:block">
            {result ? "Scroll to zoom · drag divider or image" : "Scroll to zoom · pick a scale below"}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2 bg-[#0e0d0c] px-3 pt-3 pb-4 sm:px-5">
        {pickError && (
          <p role="alert" className="text-[12.5px] font-medium text-[#ff9d94]">
            {pickError}
          </p>
        )}
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
          onPickFiles={onPickFiles}
        />
      </div>
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]">
          <div className="rounded-3xl border-2 border-dashed border-[#f5f4f0] bg-[#171512] px-10 py-8 text-center">
            <p className="text-[16px] font-semibold text-[#f5f4f0]">Drop to replace image</p>
            <p className="mt-1 text-[13px] text-[#a8a29e]">Single image or up to 8 frames to fuse</p>
          </div>
        </div>
      )}
    </div>
  );
}
