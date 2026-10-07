import { Suspense } from "react";
import { Workspace } from "../features/studio/workspace";
import { SwRegister } from "./sw-register";

function Shell() {
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-[#0e0d0c]"
      aria-hidden="true"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5f4f0] text-[18px] font-semibold text-[#0e0d0c]">
        V
      </div>
      <div className="h-2 w-40 animate-pulse rounded-full bg-[#2a2724]" />
      <p className="text-[13px] text-[#a8a29e]">Loading workspace…</p>
    </div>
  );
}

export default function Page() {
  return (
    <div className="flex h-dvh flex-col bg-[#0e0d0c] text-[#f5f4f0]">
      <SwRegister />
      <Suspense fallback={<Shell />}>
        <Workspace />
      </Suspense>
    </div>
  );
}
