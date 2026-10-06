"use client";

import { useRef } from "react";
import type { StudioImage } from "./model";
import { decodeFile } from "./use-studio-job";

// Empty state + frictionless entry: drop anywhere, browse, paste.
export function Dropzone({ onImage }: { onImage: (img: StudioImage, name: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    const { image, name } = await decodeFile(f);
    onImage(image, name);
  }

  return (
    <div
      className="vx-rise flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-line bg-paper px-6 text-center"
      data-enter="true"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void take(e.dataTransfer.files?.[0]);
      }}
      onPaste={(e) => {
        const f = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
        if (f) void take(f);
      }}
      tabIndex={0}
      role="button"
      aria-label="Drop an image or choose a file"
      onClick={() => fileRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
      }}
    >
      <h2 className="font-display text-5xl">Upscale your image</h2>
      <p className="text-ink-soft">Drop an image anywhere</p>
      <p className="text-[12px] tracking-wide text-ink-faint">PNG · JPEG · WebP · AVIF</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0] ?? undefined);
          e.target.value = "";
        }}
      />
    </div>
  );
}
