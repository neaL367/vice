#pragma once
#include <cstdint>

namespace vice {

// Ordered dither modes (ABI v5). DITHER_NONE is the legacy path (zero cost).
enum class DitherMode : int { None = 0, Ordered = 1 };

// Bayer 8x8 ordered dither: adds a spatially-periodic threshold in (-0.5, +0.5)
// to each float64 pixel before rounding. Deterministic: same (bx,by,dx,dy)
// always yields the same threshold. amplitude=0.5 fills one quantization step.
// Both (bx,by) are the SOURCE block coordinates (LR pixel position);
// (dx,dy) are the sub-block HR pixel offsets within [0,scale).
double bayer_threshold(int bx, int by, int dx, int dy, int scale, double amplitude = 0.5);

} // namespace vice
