import { Suspense, ViewTransition } from "react";
import { Workspace } from "../features/studio/workspace";

function Shell() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3" aria-hidden="true">
      <p className="font-display text-[22px] tracking-tight text-stone-100">Vice</p>
      <p className="text-[13px] text-stone-500">Loading workspace…</p>
    </div>
  );
}

export default function Page() {
  return (
    <div className="flex h-dvh flex-col bg-[#131110] text-stone-200">
      <Suspense
        fallback={
          <ViewTransition exit="vu-exit" default="none">
            <Shell />
          </ViewTransition>
        }
      >
        <ViewTransition enter="vu-enter" default="none">
          <Workspace />
        </ViewTransition>
      </Suspense>
    </div>
  );
}
