"use client";

import { useEffect } from "react";

// Registers the offline service worker once. Failures are silent-safe:
// the studio works online without it; offline is progressive enhancement.
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
