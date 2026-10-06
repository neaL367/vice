"use client";

import { useEffect } from "react";

// View transitions are cosmetic: when the tab is hidden the browser aborts
// them (InvalidStateError: "Transition was aborted... Document hidden") and
// the rejection can surface as an uncaught console error. Swallow exactly
// that case — a hidden tab needs no animation. Everything else propagates.
export function ViewTransitionGuard() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { name?: string; message?: string } | null;
      const msg = String(reason?.message ?? reason ?? "");
      if (
        document.hidden &&
        (reason?.name === "InvalidStateError" || /transition was aborted/i.test(msg))
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}
