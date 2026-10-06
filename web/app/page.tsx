import { Workspace } from "../features/studio/workspace";

export default function Page() {
  return (
    <div className="flex h-dvh flex-col bg-[#131110] text-stone-200">
      <header className="flex shrink-0 items-center gap-4 px-5 py-3">
        <h1 className="font-display text-[22px] tracking-tight text-stone-100">Vice</h1>
        <p className="hidden text-[13px] text-stone-500 sm:block">Larger. Cleaner. Yours.</p>
        <nav className="ml-auto text-[13px] text-stone-500" aria-label="About">
          <a href="#how" className="hover:text-stone-300">
            How it works
          </a>
        </nav>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Workspace />
      </main>
      <footer id="how" className="shrink-0 px-5 py-2 text-[11px] text-stone-600">
        On-device math, no uploads · Every output block averages exactly to its pixel
      </footer>
    </div>
  );
}
