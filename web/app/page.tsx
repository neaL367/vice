import { Workspace } from "../features/studio/workspace";

export default function Page() {
  return (
    <div className="flex h-dvh flex-col bg-[#131110] text-stone-200">
      <header className="flex shrink-0 items-center gap-4 px-5 py-3">
        <h1 className="font-display text-[22px] tracking-tight text-stone-100">Vice</h1>
        <p className="hidden text-[13px] text-stone-500 sm:block">Larger. Cleaner. Yours.</p>
        <p className="ml-auto text-[12px] text-stone-600">On-device · No uploads</p>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Workspace />
      </main>
    </div>
  );
}
