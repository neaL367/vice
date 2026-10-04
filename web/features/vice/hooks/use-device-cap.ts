"use client";

import { useState } from "react";
import { maxStreamPixels } from "../../../lib/limits";

/** Device Blob-streaming ceiling in MP: above this, only save-to-disk runs. */
export function useDeviceStreamCapMp(): number {
  const [cap] = useState(() =>
    typeof navigator === "undefined" ? 64 : maxStreamPixels() / 1_000_000,
  );
  return cap;
}

