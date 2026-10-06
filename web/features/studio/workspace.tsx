"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";

// Workspace: stage fills available space; control bar sits below it in normal
// flow (nothing floats over anything except the zoom pill and reveal strip,
// which live in opposite corners). Facts inline in the bar row.
export function Workspace() {
  const { job, openImage, reset, upscale } = useStudioJob();
  const [scale, setScale] = useState<2 | 3 | 4>(2);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const { image, name } = await decodeFile(f);
      openImage(image, name);
    } catch {
      // Dropzone surfaces its own errors; the header picker stays silent-safe.
    }
  }

  function download(out: StudioImage, name: string, s: number) {
    const c = document.createElement("canvas");
    c.width = out.w;
    c.height = out.h;
    c.getContext("2d")!.putImageData(new ImageData(out.data, out.w, out.h), 0, 0);
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
        We couldn&apos;t process this image. <button className="underline" onClick={reset}>Try another image</button>
      </p>
    );
  }
  const result = job.kind === "done" ? job.output : null;
  const working = job.kind === "working";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-[40dvh] flex-1">
        <ImageStage
          key={`${job.name}-${input.w}x${input.h}`}
          input={input}
          result={result}
          working={working}
        />
      </div>
      <div className="shrink-0 border-t border-white/10 px-4 py-2">
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
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-[12px] text-stone-500">
          {job.kind === "done" ? (
            <span className="font-mono tabular-nums">
              Ready · {job.output.w}×{job.output.h} · {job.ms.toFixed(0)} ms · {job.residual.toExponential(1)}
            </span>
          ) : (
            <span>{working ? "Working…" : "Choose a size, then Upscale."}</span>
          )}
          <span className="ml-auto flex gap-4">
            <label className="cursor-pointer hover:text-stone-300">
              New image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void take(e.target.files?.[0] ?? undefined);
                  e.target.value = "";
                }}
              />
            </label>
            <button className="hover:text-stone-300" onClick={reset}>
              Start over
            </button>
          </span>
          {job.kind === "error" && (
            <span role="alert" className="text-[#e07856]">
              {job.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
