// Single source of truth for processing limits (worker enforcement + UI copy).

/**
 * Maximum output pixels (width * height * scale^2) the worker will process.
 * Set to 36 MP to ensure memory usage stays safely within the 32-bit WASM
 * 2 GB memory limit (output float buffer + temp shock buffer + canvas RGBA).
 */
export const MAX_OUTPUT_PIXELS = 36_000_000;

/** Same limit in megapixels, for display. */
export const MAX_OUTPUT_MP = MAX_OUTPUT_PIXELS / 1_000_000;

