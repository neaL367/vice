#include <cmath>

namespace vice {

// Exact sRGB EOTF pair (mirrors research/ref/color.ts and old core/color.cpp).
// Product v1 processes gamma bytes per channel; these serve the linear path.
double srgb_to_linear(double v) {
  if (!(v > 0.0)) return 0.0;
  if (v <= 0.04045) return v / 12.92;
  return std::pow((v + 0.055) / 1.055, 2.4);
}

double linear_to_srgb(double v) {
  if (!(v > 0.0)) return 0.0;
  if (v >= 1.0) return 1.0;
  if (v <= 0.0031308) return v * 12.92;
  return 1.055 * std::pow(v, 1.0 / 2.4) - 0.055;
}

}  // namespace vice
