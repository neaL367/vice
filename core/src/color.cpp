#include "vice.h"
#include <cmath>
#include <cstdint>

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

constexpr int COLOR_LUT_SIZE = 4096;

struct ColorLut {
  float lin_to_srgb[COLOR_LUT_SIZE + 1];
  float srgb_to_lin[COLOR_LUT_SIZE + 1];

  ColorLut() {
    for (int i = 0; i <= COLOR_LUT_SIZE; ++i) {
      float v = (float)i / (float)COLOR_LUT_SIZE;
      lin_to_srgb[i] = vice_linear_to_srgb(v);
      srgb_to_lin[i] = vice_srgb_to_linear(v);
    }
  }
};

static const ColorLut g_color_lut;

float vice_fast_linear_to_srgb(float v) {
  if (v <= 0.0f) return 0.0f;
  if (v >= 1.0f) return 1.0f;
  int idx = (int)(v * (float)COLOR_LUT_SIZE + 0.5f);
  return g_color_lut.lin_to_srgb[idx];
}

float vice_fast_srgb_to_linear(float v) {
  if (v <= 0.0f) return 0.0f;
  if (v >= 1.0f) return 1.0f;
  int idx = (int)(v * (float)COLOR_LUT_SIZE + 0.5f);
  return g_color_lut.srgb_to_lin[idx];
}

float vice_spatial_triangular_dither(int x, int y, int ch) {
  int32_t h = (int32_t)(x * 374761393 + y * 668265263 + ch * 91234567);
  h = (int32_t)((h ^ (h >> 13)) * 1274126177);
  float u1 = ((float)(h & 0xffff) / 65535.0f) - 0.5f;
  float u2 = ((float)((h >> 16) & 0xffff) / 65535.0f) - 0.5f;
  return (u1 + u2) * 0.5f;
}
