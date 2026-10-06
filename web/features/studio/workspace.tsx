"use client";

import { useState } from "react";
import { Controls } from "./controls";
import { Dropzone } from "./dropzone";
import { ImageStage } from "./image-stage";
import type { StudioImage } from "./model";
import { decodeFile, useStudioJob } from "./use-studio-job";

// Workspace: top bar (brand · status · new image) + full-bleed stage + one
// floating dock. No sidebars, no sections, no footer.
export function Workspace() {
  const { job, openImage, upscale } = useStudioJob();
  const [scale, setScale] = useState<2 | 3 | 4>(2);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const { image, name } = await decodeFile(f);
      openImage(image, name);
    } catch {
      // Dropzone surfaces its own errors; the top-bar picker stays silent-safe.
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

  const status =
    job.kind === "done"
      ? `Ready · ${job.output.w}×${job.output.h} · ${job.ms.toFixed(0)} ms · ${job.residual.toExponential(1)}`
      : job.kind === "working"
        ? "Working…"
        : job.kind === "error"
          ? job.message
          : "On-device · No uploads";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-5 py-3">
        <h1 className="font-display text-[22px] tracking-tight text-stone-100">Vice</h1>
        <p className="hidden font-mono text-[11px] text-stone-500 tabular-nums sm:block" role="status">
          {status}
        </p>
        {job.kind !== "idle" && (
          <label className="ml-auto cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-[13px] text-stone-300 transition-colors hover:bg-white/5">
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
        )}
      </header>

      {job.kind === "idle" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Dropzone onImage={openImage} />
        </div>
      ) : (
        job.input && (
          <main className="relative min-h-0 flex-1">
            <ImageStage
              key={`${job.name}-${job.input.w}x${job.input.h}`}
              input={job.input}
              result={job.kind === "done" ? job.output : null}
              working={job.kind === "working"}
            />
            <div className="absolute inset-x-0 bottom-5 flex justify-center px-4">
              <Controls
                scale={scale}
                setScale={setScale}
                inDims={`${job.input.w}×${job.input.h}`}
                outDims={`${job.input.w * scale}×${job.input.h * scale}`}
                canRun={job.kind === "ready" || job.kind === "done"}
                working={job.kind === "working"}
                canDownload={job.kind === "done"}
                onUpscale={() => void upscale(scale)}
                onDownload={() => {
                  if (job.kind === "done") download(job.output, job.name, job.scale);
                }}
              />
            </div>
          </main>
        )
      )}
      {job.kind === "error" && !job.input && (
        <p role="alert" className="p-6 text-[14px] text-[#e07856]">
          We couldn&apos;t process this image.
        </p>
      )}
    </div>
  );
}
