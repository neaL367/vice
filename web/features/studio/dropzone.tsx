"use client";

import { useRef } from "react";
import type { StudioImage } from "./model";
import { decodeFile } from "./use-studio-job";

// Empty state: beautiful, simple. Drop anywhere, browse, paste, keyboard.
export function Dropzone({ onImage }: { onImage: (img: StudioImage, name: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function take(f: File | undefined) {
    if (!f || !f.type.startsWith("image/")) return;
    const { image, name } = await decodeFile(f);
    onImage(image, name);
  }

  return (
    <div
      className="vx-rise flex min-h-[62vh] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/15 bg-[#171412] px-6 text-center"
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
      <p className="text-[12px] tracking-[0.2em] text-stone-500 uppercase">Vice laboratory</p>
      <h2 className="font-display max-w-xl text-5xl leading-tight text-stone-100 sm:text-6xl">
        Upscale your image
      </h2>
      <p className="text-[15px] text-stone-400">Drop an image anywhere</p>
      <p className="text-[12px] tracking-widest text-stone-600">PNG · JPEG · WEBP · AVIF</p>
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
