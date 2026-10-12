#include <cmath>
#include "color.h"

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

void rgb_to_ycocg(double r, double g, double b, double* y, double* co, double* cg) {
  *y = r * 0.25 + g * 0.5 + b * 0.25;
  *co = r * 0.5 - b * 0.5;
  *cg = -r * 0.25 + g * 0.5 - b * 0.25;
}

void ycocg_to_rgb(double y, double co, double cg, double* r, double* g, double* b) {
  *r = y + co - cg;
  *g = y + cg;
  *b = y - co - cg;
}

}  // namespace vice
