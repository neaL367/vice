import { memo, ViewTransition } from "react";
import type { ViceFile } from "../types/vice";

interface StudioStagedPreviewProps {
  file: ViceFile;
  onImageLoad: (url: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export const StudioStagedPreview = memo(function StudioStagedPreview({
  file,
  onImageLoad,
}: StudioStagedPreviewProps) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden p-6 select-none">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
        <ViewTransition name="vice-hero-media" share="morph" default="none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.previewUrl}
            alt={file.file.name}
            onLoad={(e) => onImageLoad(file.previewUrl, e)}
            className="h-full max-h-full w-full max-w-full rounded-lg object-contain shadow-xl"
          />
        </ViewTransition>
      </div>
    </div>
  );
});
