"use client";

import { Upscaler } from "./upscaler/upscaler";

export function UpscalerTool() {
  return (
    <Upscaler.Root>
      <Upscaler.Header>
        <Upscaler.Brand />
        <div className="flex items-center gap-2">
          <Upscaler.ScaleSelector />
          <Upscaler.Tuning />
        </div>
        <Upscaler.Actions />
      </Upscaler.Header>

      <Upscaler.StagedBar />
      <Upscaler.StatusBar />
      <Upscaler.Stage />
    </Upscaler.Root>
  );
}

export function UpscalerToolSkeleton() {
  return (
    <div
      aria-hidden
      className="h-full w-full bg-foreground/[0.02]"
    />
  );
}
