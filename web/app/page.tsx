import { Workspace } from "../features/studio/workspace";

export default function Page() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col bg-[#131110] px-4 pb-10 text-stone-200 sm:px-6">
      <header className="flex items-center gap-4 py-5">
        <h1 className="font-display text-[26px] tracking-tight text-stone-100">Vice</h1>
        <p className="hidden text-[13px] text-stone-500 sm:block">Larger. Cleaner. Yours.</p>
        <nav className="ml-auto flex gap-4 text-[13px] text-stone-400" aria-label="About">
          <a href="#how" className="hover:text-stone-200">
            How it works
          </a>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">
        <Workspace />
      </main>
      <footer className="mt-10 border-t border-white/10 pt-4 text-[12px] text-stone-500">
        <details id="how">
          <summary className="cursor-pointer hover:text-stone-300">How it works</summary>
          <p className="mt-2 max-w-prose">
            Your image is enlarged by a small math engine running entirely in this browser tab — no
            uploads, no AI. Every output block averages exactly to its original pixel.
          </p>
        </details>
        <p className="mt-2">Private by construction. Nothing leaves this device.</p>
      </footer>
    </div>
  );
}
