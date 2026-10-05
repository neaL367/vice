// Single source of truth for processing limits (worker enforcement + UI copy).
//
// One engine: every render (Blob download, save-to-disk, folder batch) drives
// the same streaming strip pipeline, so a single device-tier ceiling gates
// the in-memory Blob route. The save-to-disk (infinite) route has NO output
// cap: bands feed the incremental PNG writer and chunks go straight to disk,
// so output size changes time and disk use, not peak RAM.

/**
 * Streaming ceiling for the Blob (in-browser download) route: band-sized
 * float buffers keep the WASM math ~flat, but the 8-bit accumulation + PNG
 * encode + output blob + result preview all scale with output size, so the
 * cap is about total tab weight, not just OOM survival.
 *
 * The save-to-disk (infinite) route has NO output cap: bands feed the
 * incremental PNG writer and chunks go straight to disk, so output size
 * changes time and disk use, not peak RAM. These ceilings gate Blob
 * downloads only.
 *
 * Measured 2026-10-04, headless Chromium, 16 GB / 8-core desktop, noisy JPEG
 * input, default routing (streaming above the 24 MP full-image tier),
 * isolated browser-tree RSS:
 * - 64 MP out: 66 s wall, peak 2.13 GB, settles 2.09 GB
 * (vs 36 MP full-image: 43 s, 2.62 GB — streaming trades ~1.5x time for a
 * lower, flatter peak; the WASM heap never shrinks either way).
 * - >= 8 or SSR/unknown-runtime: 64 MP
 * - 4: 32 MP | <= 2: 16 MP
 * - unknown device class: 32 MP.
 */
export const MAX_STREAM_PIXELS = 64_000_000;

export function maxStreamPixels(): number {
  if (typeof navigator !== "undefined") {
    const dm = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
    if (typeof dm === "number" && dm > 0) {
      if (dm <= 2) return 16_000_000;
      if (dm < 8) return 32_000_000;
      return MAX_STREAM_PIXELS;
    }
    return 32_000_000;
  }
  return MAX_STREAM_PIXELS;
}

/** Same streaming ceiling in megapixels, for static display copy. */
export const MAX_STREAM_MP = MAX_STREAM_PIXELS / 1_000_000;
