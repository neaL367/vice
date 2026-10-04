"use client";

import { Upscaler } from "./upscaler/upscaler";

export function UpscalerTool() {
  return (
    <Upscaler.Root>
      <Upscaler.Header>
        <Upscaler.Brand />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Upscaler.SheetButtons />
          <Upscaler.HeaderActions />
        </div>
      </Upscaler.Header>

      <div className="flex min-h-0 w-full flex-1 flex-row">
        <Upscaler.QueueRail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Upscaler.Stage />
          <Upscaler.EvidenceRail />
        </div>
        <Upscaler.InspectorRail />
      </div>

      <Upscaler.MobileBar />
      <Upscaler.Sheets />
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
