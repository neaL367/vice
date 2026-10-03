import { Suspense } from "react";
import {
  UpscalerTool,
  UpscalerToolSkeleton,
} from "../features/vice/components/upscaler-tool";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col items-center bg-background font-sans text-foreground">
      <main className="flex w-full max-w-2xl flex-1 flex-col px-6 py-16 sm:py-24">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Private · On-device
        </p>
        <h1 className="mt-4 text-7xl leading-[0.9] tracking-tight sm:text-8xl">
          Vice
        </h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
          Consistent super-resolution. Shrink the result back and you recover
          the input.
        </p>
        <div className="my-10 h-px w-full bg-hairline" aria-hidden />
        <Suspense fallback={<UpscalerToolSkeleton />}>
          <UpscalerTool />
        </Suspense>
      </main>
    </div>
  );
}
