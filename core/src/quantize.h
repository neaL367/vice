#include "vice.h"

static inline float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

static inline void quantize_pixel(const float* raw_pixel, unsigned char* out_pixel,
                                  int channels, int x, int y) {
  if (channels == 4) {
    float a = clamp01(raw_pixel[3]);
    float inv_a = (a > 1e-6f) ? (1.0f / a) : 0.0f;
    for (int c = 0; c < 3; ++c) {
      float lin = clamp01(raw_pixel[c] * inv_a);
      float srgb = vice_fast_linear_to_srgb(lin);
      float dither = vice_spatial_triangular_dither(x, y, c);
      int q = (int)(srgb * 255.0f + dither + 0.5f);
      if (q < 0) q = 0;
      if (q > 255) q = 255;
      out_pixel[c] = (unsigned char)q;
    }
    int qa = (int)(a * 255.0f + 0.5f);
    if (qa < 0) qa = 0;
    if (qa > 255) qa = 255;
    out_pixel[3] = (unsigned char)qa;
  } else {
    for (int c = 0; c < channels; ++c) {
      float lin = clamp01(raw_pixel[c]);
      float srgb = vice_fast_linear_to_srgb(lin);
      float dither = vice_spatial_triangular_dither(x, y, c);
      int q = (int)(srgb * 255.0f + dither + 0.5f);
      if (q < 0) q = 0;
      if (q > 255) q = 255;
      out_pixel[c] = (unsigned char)q;
    }
  }
}
