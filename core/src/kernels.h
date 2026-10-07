#pragma once
#include <vector>

namespace vice {

enum class Kernel { Nearest, Bilinear, Bicubic, Mitchell, Lanczos2, Lanczos3 };

double kernel_weight(Kernel k, double x);
double kernel_radius(Kernel k);

// Separable upscale with mirror (whole-sample symmetric) edges.
// src: h×w row-major. Returns (h*s)×(w*s). Weights renormalized per pixel.
std::vector<double> upsample(const std::vector<double>& src, int w, int h, int s, Kernel k);

// Bilinear subpixel translation with CLAMPED edges (matches research/ref
// burst.ts shiftImage exactly, including edge policy — required for TS
// cross-validation of the burst path).
std::vector<double> shift_image(const std::vector<double>& src, int w, int h, double dx, double dy);

}  // namespace vice
