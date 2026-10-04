"use client";

import { useState } from "react";
import { maxOutputPixels } from "../../../lib/limits";

/** Device output cap in MP, read once (deviceMemory never changes mid-session). */
export function useDeviceCapMp(): number {
  const [cap] = useState(() =>
    typeof navigator === "undefined" ? 24 : maxOutputPixels() / 1_000_000,
  );
  return cap;
}
