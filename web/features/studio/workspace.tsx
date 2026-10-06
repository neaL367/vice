"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";

// Workspace owns the job; transform state stays inside ImageStage (keyed per
// image so a new upload resets the view). Scale lives here: controls and
// output dims both derive from it.
export function Workspace() {
  const { job, openImage, reset, upscale } = useStudioJob();
  const [scale, setScale] = useState<2 | 3 | 4>(2);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    const { image, name } = await decodeFile(f);
    openImage(image, name);
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
      <Dropzone
        onImage={(img, name) => {
          openImage(img, name);
        }}
      />
    );
  }

  const input = job.input;
  if (!input) {
    return (
      <p role="alert" className="text-[14px] text-accent">
        We couldn&apos;t process this image. <button className="underline" onClick={reset}>Try another image</button>
      </p>
    );
  }
  const result = job.kind === "done" ? job.output : null;
  const working = job.kind === "working";
  const dims = (i: StudioImage) => `${i.w}×${i.h}`;
  const outDims = `${input.w * scale}×${input.h * scale}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="vx-rise min-h-[420px] overflow-hidden rounded-lg border border-line bg-stage" data-enter="true">
        <ImageStage
          key={`${job.name}-${input.w}x${input.h}`}
          input={input}
          result={result}
          working={working}
        />
      </div>
      {job.kind === "error" && (
        <p role="alert" className="text-[14px] text-accent">
          {job.message} <button className="underline" onClick={reset}>Try another image</button>
        </p>
      )}
      <Controls
        scale={scale}
        setScale={setScale}
        inDims={dims(input)}
        outDims={outDims}
        canRun={job.kind === "ready" || job.kind === "done"}
        working={working}
        canDownload={job.kind === "done"}
        onUpscale={() => void upscale(scale)}
        onDownload={() => {
          if (job.kind === "done") download(job.output, job.name, job.scale);
        }}
      />
      {job.kind === "done" && (
        <p className="font-mono text-[12px] text-ink-soft tabular-nums">
          Ready · {job.output.w}×{job.output.h} · {job.ms.toFixed(0)} ms · residual {job.residual.toExponential(1)}
        </p>
      )}
      <div className="flex gap-3 text-[13px] text-ink-faint">
        <label className="cursor-pointer underline">
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
        <button className="underline" onClick={reset}>
          Start over
        </button>
      </div>
    </div>
  );
}
