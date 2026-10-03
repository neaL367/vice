"use client";

import { useEffect } from "react";

// Route error boundary: catches fallible client tool failures
// (oversize files, missing canvas APIs) without blanking the shell.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex w-full max-w-3xl flex-col items-center gap-3 py-12 text-center">
      <h2 className="text-xl font-semibold">Upscaler hit a snag</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {error.message || "Something went wrong while upscaling."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-foreground px-5 py-2 text-background"
      >
        Try again
      </button>
    </div>
  );
}
