import { Suspense, ViewTransition } from "react";
import {
  UpscalerTool,
  UpscalerToolSkeleton,
} from "../features/vice/components/upscaler-tool";

export default function Home() {
  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background font-sans text-foreground select-none">
      <main className="flex min-h-0 w-full flex-1 flex-col">
        <Suspense
          fallback={
            <ViewTransition exit="slide-down" default="none">
              <UpscalerToolSkeleton />
            </ViewTransition>
          }
        >
          <ViewTransition enter="slide-up" default="none">
            <UpscalerTool />
          </ViewTransition>
        </Suspense>
      </main>
    </div>
  );
}
