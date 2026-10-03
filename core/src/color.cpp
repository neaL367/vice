#include "vice.h"
#include <cmath>

float vice_srgb_to_linear(float v) {
  if (v <= 0.04045f) return v / 12.92f;
  return std::pow((v + 0.055f) / 1.055f, 2.4f);
}

float vice_linear_to_srgb(float v) {
  if (v <= 0.0f) return 0.0f;
  if (v >= 1.0f) return 1.0f;
  if (v <= 0.0031308f) return v * 12.92f;
  return 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
}
