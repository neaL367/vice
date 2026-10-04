import { memo } from "react";
import { MAX_STREAM_MP } from "../../../lib/limits";
import { FocusSquareIcon } from "./studio-icons";

interface StudioDropzoneProps {
  inputId: string;
  onChoose: () => void;
}

export const StudioDropzone = memo(function StudioDropzone({
  inputId,
  onChoose,
}: StudioDropzoneProps) {
  return (
    <div className="group relative flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-xl border border-hairline bg-foreground/[0.02] text-foreground/60">
          <FocusSquareIcon className="h-7 w-7" />
        </div>

        <h2 className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">
          Drop images to upscale
        </h2>
        <p className="mt-1.5 text-xs text-muted">
          PNG, JPEG, or WebP · processed on this device
        </p>

        <button
          type="button"
          onClick={onChoose}
          className="mt-5 inline-flex h-9 items-center rounded-md bg-foreground px-5 text-xs font-semibold text-background transition-opacity hover:opacity-90"
        >
          Choose images
        </button>

        <details className="mt-4 text-[11px] text-muted">
          <summary className="cursor-pointer list-none hover:text-foreground">
            Output limits
          </summary>
          <p className="mt-1 font-mono tabular-nums">
            Up to {MAX_STREAM_MP} MP output · full-quality passes adapt to
            device memory
          </p>
        </details>

        <label htmlFor={inputId} className="sr-only">
          Or drop files anywhere on this area
        </label>
      </div>
    </div>
  );
});
