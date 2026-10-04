// Single source of truth for processing limits (worker enforcement + UI copy).

/**
 * Ceiling output pixels (width * height * scale^2) for deviceMemory >= 8.
 *
 * Measured 2026-10-04, headless Chromium, 16 GB / 8-core desktop, noisy PNG
 * input, WASM worker path, isolated browser-tree RSS:
 * - 25 MP out: 29 s wall, peak 1.94 GB, settles 1.90 GB
 * - 36 MP out: 43 s wall, peak 2.62 GB, settles 2.33 GB
 * => ~68 MB per output MP + ~0.2 GB fixed. The WASM heap never shrinks, so
 * the tab retains ~peak after the job; the old 36 MP cap sat ~0.6 GB under
 * the 2 GB WASM ceiling and risked tab OOM on 8 GB machines, so it is gone.
 *
 * Policy by navigator.deviceMemory (Chrome-only; capped at 8 by the API):
 * - >= 8 or SSR/unknown-runtime: 24 MP (~1.8 GB peak, measured model)
 * - 4: 12 MP (~1.0 GB)
 * - <= 2: 6 MP (~0.6 GB)
 * - unknown (Safari/Firefox, incl. mobile): 12 MP conservative.
 *
 * The C++ streaming strip pipeline (vice_stream_*) handles everything above
 * the full-image tiers: band-sized floats, 8-bit accumulation, one PNG
 * encode. Band projection is box-only (no multigrid) — same guarantee,
 * slightly different low frequencies.
 */
export const MAX_OUTPUT_PIXELS = 24_000_000;

export function maxOutputPixels(): number {
  if (typeof navigator !== "undefined") {
    const dm = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
    if (typeof dm === "number" && dm > 0) {
      if (dm <= 2) return 6_000_000;
      if (dm < 8) return 12_000_000;
      return MAX_OUTPUT_PIXELS;
    }
    // Unknown device class: assume phone-class, not desktop-class.
    return 12_000_000;
  }
  return MAX_OUTPUT_PIXELS;
}

/** Same ceiling in megapixels, for static display copy. */
export const MAX_OUTPUT_MP = MAX_OUTPUT_PIXELS / 1_000_000;

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
