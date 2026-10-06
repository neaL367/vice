"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";

// Workspace: full-viewport stage with floating control pill. Job state owned
// here; transform state inside ImageStage (keyed per image); scale here.
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
  const outDims = `${input.w * scale}×${input.h * scale}`;

  return (
    <div className="relative min-h-0 flex-1">
      <ImageStage
        key={`${job.name}-${input.w}x${input.h}`}
        input={input}
        result={result}
        working={working}
      />
      {job.kind === "done" && (
        <p className="absolute top-3 right-4 font-mono text-[11px] text-stone-400 tabular-nums">
          Ready · {job.output.w}×{job.output.h} · {job.ms.toFixed(0)} ms · {job.residual.toExponential(1)}
        </p>
      )}
      {job.kind === "error" && (
        <p role="alert" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[13px] text-[#e07856]">
          {job.message} <button className="underline" onClick={reset}>Try another image</button>
        </p>
      )}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 sm:bottom-4">
        <Controls
          scale={scale}
          setScale={setScale}
          inDims={`${input.w}×${input.h}`}
          outDims={outDims}
          canRun={job.kind === "ready" || job.kind === "done"}
          working={working}
          canDownload={job.kind === "done"}
          onUpscale={() => void upscale(scale)}
          onDownload={() => {
            if (job.kind === "done") download(job.output, job.name, job.scale);
          }}
        />
      </div>
      <div className="absolute top-3 left-4 flex gap-4 text-[13px] text-stone-500">
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
      </div>
    </div>
  );
}
