import { memo } from "react";
import { MAX_STREAM_MP } from "../../../lib/limits";
import { FocusSquareIcon } from "./studio-icons";

interface StudioDropzoneProps {
  inputId: string;
}

export const StudioDropzone = memo(function StudioDropzone({
  inputId,
}: StudioDropzoneProps) {
  return (
    <label
      htmlFor={inputId}
      className="group relative flex h-full w-full cursor-pointer flex-col items-center justify-center p-8 transition-colors hover:bg-foreground/[0.015]"
    >
      <div className="flex flex-col items-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-hairline/80 bg-foreground/[0.02] text-foreground/60 transition-transform duration-300 group-hover:scale-105 group-hover:text-foreground">
          <FocusSquareIcon className="h-7 w-7" />
        </div>

        <h2 className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">
          Drop images here
        </h2>
        <p className="mt-1.5 text-xs text-muted">
          or click anywhere to browse from device · PNG, JPEG, WebP · up to {MAX_STREAM_MP} MP output
        </p>
      </div>
    </label>
  );
});
