import { memo, ViewTransition } from "react";
import type { ViceFile, ViceScale } from "../types/vice";

interface StudioStagedPreviewProps {
  file: ViceFile;
  scale: ViceScale;
  dims?: { w: number; h: number };
  running: boolean;
  onImageLoad: (url: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
  onRun: () => void;
}

export const StudioStagedPreview = memo(function StudioStagedPreview({
  file,
  scale,
  dims,
  running,
  onImageLoad,
  onRun,
}: StudioStagedPreviewProps) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden p-6 select-none">
      <div className="relative flex max-h-full max-w-full flex-1 items-center justify-center">
        <ViewTransition name="vice-hero-media" share="morph" default="none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.previewUrl}
            alt={file.file.name}
            onLoad={(e) => onImageLoad(file.previewUrl, e)}
            className="max-h-[75vh] max-w-[90vw] rounded-xl object-contain shadow-xl"
          />
        </ViewTransition>
      </div>

      {/* Floating Bottom Action Pill */}
      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-hairline/80 bg-background/90 px-5 py-2 shadow-xl backdrop-blur-md">
        <span className="text-xs text-muted">
          Output:{" "}
          <strong className="font-mono font-medium text-foreground">
            {dims
              ? `${dims.w * scale} × ${dims.h * scale}`
              : `${scale}×`}
          </strong>
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-1.5 text-xs font-semibold text-background shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          Upscale Now
        </button>
      </div>
    </div>
  );
});
