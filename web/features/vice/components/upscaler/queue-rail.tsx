"use client";

import { memo } from "react";
import { useUpscaler } from "./upscaler-context";
import { UploadIcon } from "../studio-icons";

export const QueueContent = memo(function QueueContent() {
  const { job, fileDimensions, fileInputRef } = useUpscaler();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Files · {job.files.length}
        </span>
      </div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={job.running}
        className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-dashed border-hairline text-xs font-medium text-muted transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
      >
        <UploadIcon className="h-3.5 w-3.5" />
        <span>Add images</span>
      </button>
      <ul className="flex flex-col gap-1.5">
        {job.files.map((f) => {
          const dims = fileDimensions[f.previewUrl];
          return (
            <li
              key={f.previewUrl}
              className="flex items-center gap-2.5 rounded-md border border-hairline/70 px-2 py-1.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={f.previewUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium text-foreground">
                  {f.file.name}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted">
                  {dims ? `${dims.w}×${dims.h}` : "…"}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${f.file.name}`}
                onClick={() => job.removeFile(f.previewUrl)}
                disabled={job.running}
                className="shrink-0 px-1 text-sm leading-none text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export const QueueRail = memo(function QueueRail() {
  const { hasFiles } = useUpscaler();
  if (!hasFiles) return null;
  return (
    <aside
      aria-label="File queue"
      className="hidden w-[var(--rail-l)] shrink-0 flex-col overflow-y-auto border-r border-hairline/60 px-4 py-4 lg:flex"
    >
      <QueueContent />
    </aside>
  );
});
