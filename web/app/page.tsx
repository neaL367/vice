import { Workspace } from "../features/studio/workspace";

export default function Page() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-10 sm:px-6">
      <header className="flex items-center gap-4 py-4">
        <h1 className="font-display text-2xl">Vice</h1>
        <p className="hidden text-[13px] text-ink-faint sm:block">Larger. Cleaner. Yours.</p>
        <nav className="ml-auto flex gap-4 text-[13px] text-ink-soft" aria-label="About">
          <a href="#how" className="hover:underline">
            How it works
          </a>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">
        <Workspace />
      </main>
      <footer className="mt-10 border-t border-line pt-4 text-[12px] text-ink-faint">
        <details id="how">
          <summary className="cursor-pointer">How it works</summary>
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
