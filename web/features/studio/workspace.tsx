"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";

// Workspace: brand + status live in the header row only on the empty state.
// Once an image is open: full-bleed stage, micro labels top, one dock bottom.
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
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
        <div className="flex shrink-0 items-baseline gap-3">
          <h1 className="font-display text-[22px] tracking-tight text-stone-100">Vice</h1>
          <p className="text-[13px] text-stone-500">Larger. Cleaner. Yours.</p>
        </div>
        <Dropzone onImage={openImage} />
        <p className="shrink-0 py-3 text-center text-[11px] text-stone-600">On-device · No uploads</p>
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
  const result = job.kind === "done" ? job.output : null;
  const working = job.kind === "working";

  return (
    <div className="relative min-h-0 flex-1">
      <ImageStage
        key={`${job.name}-${input.w}x${input.h}`}
        input={input}
        result={result}
        working={working}
        topLeft={
          result ? (
            <span className="text-[11px] tracking-widest text-white/70 uppercase">Original</span>
          ) : (
            <span className="max-w-[40vw] truncate font-mono text-[11px] text-white/50 tabular-nums">{job.name}</span>
          )
        }
        topRight={
          result ? (
            <span className="text-[11px] tracking-widest text-white/70 uppercase">Enhanced</span>
          ) : job.kind === "done" ? null : (
            <span className="font-mono text-[11px] text-white/50 tabular-nums">
              {job.kind === "working" ? "Working…" : `${input.w}×${input.h}`}
            </span>
          )
        }
        statusLine={
          job.kind === "done" ? (
            <span>
              Ready · {job.output.w}×{job.output.h} · {job.ms.toFixed(0)} ms · {job.residual.toExponential(1)}
            </span>
          ) : null
        }
      />
      {job.kind === "error" && (
        <p role="alert" className="absolute top-12 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[13px] text-[#e07856]">
          {job.message}
        </p>
      )}
      <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
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
