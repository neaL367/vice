"use client";

import { useState } from "react";
import { maxOutputPixels, maxStreamPixels } from "../../../lib/limits";

/** Device output cap in MP, read once (deviceMemory never changes mid-session). */
export function useDeviceCapMp(): number {
  const [cap] = useState(() =>
    typeof navigator === "undefined" ? 24 : maxOutputPixels() / 1_000_000,
  );
  return cap;
}

/** Device Blob-streaming ceiling in MP: above this, only save-to-disk runs. */
export function useDeviceStreamCapMp(): number {
  const [cap] = useState(() =>
    typeof navigator === "undefined" ? 64 : maxStreamPixels() / 1_000_000,
  );
  return cap;
}
