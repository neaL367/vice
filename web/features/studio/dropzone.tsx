"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { decodeFile } from "./use-studio-job";

// Empty state: one surface for drop, browse, paste, keyboard. Drag depth is
// tracked with a counter (dragleave fires on child entry — a boolean flickers).
// Images over 2048px are fitted down before processing; stated, not hidden.
export function Dropzone({
  onImage,
}: {
  onImage: (img: StudioImage, name: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = useCallback(
    async (f: File | undefined | null) => {
      if (!f || reading) return;
      if (!f.type.startsWith("image/")) {
        setError("That file isn't an image. Try another image.");
        return;
      }
      setError(null);
      setReading(true);
      try {
        const { image, name } = await decodeFile(f);
        onImage(image, name);
      } catch {
        setError("We couldn't read this image. Try another image.");
      } finally {
        setReading(false);
      }
    },
    [onImage, reading],
  );

  // Page-wide paste: the surface handler needs focus, users paste anywhere.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (f) void take(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [take]);

  return (
    <div
      className={`vx-rise flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 px-6 text-center outline-none transition-colors ${
        over ? "bg-white/[0.04]" : ""
      }`}
      data-enter="true"
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        void take(e.dataTransfer.files?.[0]);
      }}
      tabIndex={0}
      role="button"
      aria-label="Drop an image or choose a file"
      aria-busy={reading}
      onClick={() => {
        if (!reading) fileRef.current?.click();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !reading)
          fileRef.current?.click();
      }}
    >
      <h1 className="font-display text-[88px] leading-none tracking-tight text-stone-100 sm:text-[120px]">
        Vice
      </h1>
      <h2 className="font-display max-w-xl text-2xl leading-snug text-stone-300 sm:text-[28px]">
        {reading ? "Reading…" : "Upscale your image"}
      </h2>
      <p
        className={`text-[15px] transition-colors ${over ? "text-stone-100" : "text-stone-400"}`}
      >
        {over
          ? "Let go to begin"
          : reading
            ? "Decoding pixels…"
            : "Drop an image anywhere"}
      </p>
      {/* The whole flow in one glance: drop → enlarge → compare. */}
      <ol className="flex items-center gap-2 text-[12px] text-stone-500" aria-label="How it works">
        <li>
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/5 font-mono text-[11px] text-stone-300">
            1
          </span>
          Drop an image
        </li>
        <li aria-hidden="true" className="text-stone-700">
          →
        </li>
        <li>
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/5 font-mono text-[11px] text-stone-300">
            2
          </span>
          Pick 2×–8×
        </li>
        <li aria-hidden="true" className="text-stone-700">
          →
        </li>
        <li>
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/5 font-mono text-[11px] text-stone-300">
            3
          </span>
          Drag to compare
        </li>
      </ol>
      <p className="text-[12px] tracking-widest text-stone-600">
        PNG · JPEG · WEBP · AVIF
      </p>
      <p className="max-w-sm text-[12px] leading-relaxed text-stone-500">
        On-device, no uploads, no AI — the same math every time. Images over
        2048px are fitted down first.
      </p>
      {error && (
        <p role="alert" className="text-[14px] text-[#e07856]">
          {error}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        // Visually hidden but RENDERED: programmatic .click() on display:none
        // inputs is flaky (dialog sometimes never opens). sr-only keeps it
        // in layout so the browser honors the user gesture.
        className="sr-only"
        onChange={(e) => {
          void take(e.target.files?.[0] ?? undefined);
          e.target.value = "";
        }}
      />
    </div>
  );
}
