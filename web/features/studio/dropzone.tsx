"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioImage } from "./model";
import { decodeFile } from "./use-studio-job";

// Empty state: one surface for drop, browse, paste, keyboard. Drag depth is
// tracked with a counter (dragleave fires on child entry — a boolean flickers).
// Images over 2048px are fitted down before processing; stated, not hidden.
//
// React notes: parent callbacks arrive via refs so `take` stays stable and the
// page-wide paste listener subscribes once (no re-subscribe churn per render).
// The React Compiler memoizes the rest; no manual useMemo here by design.
export function Dropzone({
  onImage,
  onBurst,
}: {
  onImage: (img: StudioImage, name: string) => void;
  onBurst: (fs: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onImageRef = useRef(onImage);
  const onBurstRef = useRef(onBurst);
  const readingRef = useRef(reading);
  useEffect(() => {
    onImageRef.current = onImage;
    onBurstRef.current = onBurst;
    readingRef.current = reading;
  }, [onImage, onBurst, reading]);

  const take = useCallback(async (f: File | undefined | null) => {
    if (!f || readingRef.current) return;
    if (!f.type.startsWith("image/")) {
      setError("That file isn't an image. Try another image.");
      return;
    }
    setError(null);
    setReading(true);
    try {
      const { image, name } = await decodeFile(f);
      onImageRef.current(image, name);
    } catch {
      setError("We couldn't read this image. Try another image.");
    } finally {
      setReading(false);
    }
  }, []);

  // Page-wide paste: subscribes once, reads latest callbacks via refs.
  // Cleanup mirrors setup so StrictMode's double-mount never double-listens.
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

  function burstOrSingle(fs: File[]) {
    if (fs.length > 1) onBurstRef.current(fs);
    else void take(fs[0]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Slim brand bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#2a2724] bg-[#0e0d0c]/90 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f5f4f0] text-[14px] font-semibold text-[#0e0d0c]">
            V
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-[#f5f4f0]">Vice</span>
          <span className="hidden rounded-full border border-[#2a2724] bg-[#171512] px-2 py-0.5 text-[11px] font-medium text-[#a8a29e] sm:block">
            On-device · No uploads
          </span>
        </div>
        <p className="hidden text-[12px] text-[#6f6c66] md:block">
          Deterministic enlargement, 2×–8×
        </p>
      </header>

      <div
        className="vx-rise flex flex-1 cursor-pointer flex-col items-center justify-center px-4 py-10 outline-none sm:px-6"
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
          const fs = [...(e.dataTransfer.files ?? [])].filter((f) =>
            f.type.startsWith("image/"),
          );
          burstOrSingle(fs);
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
        <div
          data-over={over}
          className="vx-drop w-full max-w-[560px] rounded-3xl bg-[#171512] px-6 py-10 text-center shadow-[0_24px_64px_-24px_rgba(0,0,0,0.8)] sm:px-10"
        >
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-[#f5f4f0]">
            {reading ? (
              <span className="vx-spinner" aria-hidden="true" />
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M4 20h16" />
              </svg>
            )}
          </div>

          <h1 className="text-[26px] font-semibold tracking-tight text-[#f5f4f0] sm:text-[30px]">
            {reading ? "Reading…" : "Upscale your image"}
          </h1>
          <p
            className={`mt-2 text-[14px] leading-relaxed ${over ? "text-[#f5f4f0]" : "text-[#a8a29e]"}`}
          >
            {over
              ? "Let go to begin"
              : reading
                ? "Decoding pixels…"
                : "Drop an image anywhere, paste it, or choose a file"}
          </p>

          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <span className="inline-flex min-h-[40px] items-center rounded-full bg-[#f5f4f0] px-6 text-[14px] font-medium text-[#0e0d0c]">
              {reading ? "Working…" : "Choose image"}
            </span>
            <span className="text-[13px] text-[#6f6c66]">
              or drag & drop · Ctrl+V to paste
            </span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
            {["PNG", "JPEG", "WEBP", "AVIF", "BMP"].map((f) => (
              <span
                key={f}
                className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] text-[#a8a29e]"
              >
                {f}
              </span>
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-[13px] font-medium text-[#ff9d94]">
              {error}
            </p>
          )}
        </div>

        {/* The whole flow in one glance */}
        <ol
          className="mt-6 flex flex-col items-center gap-1.5 text-[13px] text-[#a8a29e] sm:flex-row sm:gap-5"
          aria-label="How it works"
        >
          {[
            ["1", "Drop an image"],
            ["2", "Pick 2×–8×"],
            ["3", "Drag to compare"],
          ].map(([n, label], i) => (
            <li key={n} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden="true" className="mr-3 hidden text-[#3a3632] sm:block">
                  →
                </span>
              )}
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#f5f4f0] font-mono text-[11px] text-[#0e0d0c]">
                {n}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <p className="mt-3 max-w-sm text-center text-[12px] leading-relaxed text-[#6f6c66]">
          Runs fully on your device — no uploads, no AI. Images over 2048px are
          fitted down first.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          // Visually hidden but RENDERED: programmatic .click() on display:none
          // inputs is flaky (dialog sometimes never opens). sr-only keeps it
          // in layout so the browser honors the user gesture.
          className="sr-only"
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])];
            e.target.value = "";
            burstOrSingle(fs);
          }}
        />
      </div>
    </div>
  );
}
