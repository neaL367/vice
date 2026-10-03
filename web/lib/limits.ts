// Single source of truth for processing limits (worker enforcement + UI copy).

/** Maximum output pixels (width * height * scale^2) the worker will process. */
export const MAX_OUTPUT_PIXELS = 130_000_000;

/** Same limit in megapixels, for display. */
export const MAX_OUTPUT_MP = MAX_OUTPUT_PIXELS / 1_000_000;
