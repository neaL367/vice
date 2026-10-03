#include "vice.h"
#include <vector>

// out = U(y) + (r - U(A(r))) per spec section 3.
// y: h x w x C, raw: (h*s) x (w*s) x C, in-place.
void vice_project_box(const float* y, float* raw, int w, int h, int s, int c) {
  const int W = w * s;
  const double inv = 1.0 / (double(s) * s);
  for (int by = 0; by < h; ++by) {
    for (int bx = 0; bx < w; ++bx) {
      for (int ch = 0; ch < c; ++ch) {
        double sum = 0.0;
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
        float d = y[(by * w + bx) * c + ch] - (float)(sum * inv);
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            raw[((by * s + dy) * W + bx * s + dx) * c + ch] += d;
      }
    }
  }
}

// Iterative back-projection with a smooth (bilinear) correction operator:
//   raw += Ubilinear(y - A(raw))
// A bilinear correction changes neighbouring blocks gradually instead of by a
// per-block constant, so it does not create block-boundary seams. It only
// converges approximately, so callers finish with vice_project_box, which makes
// the block means exact; by then the remaining offsets are tiny.
void vice_project_smooth(const float* y, float* raw, int w, int h, int s, int c,
                         int iterations) {
  const int W = w * s;
  const double inv = 1.0 / (double(s) * s);
  std::vector<float> d((size_t)w * h * c);
  for (int it = 0; it < iterations; ++it) {
    for (int by = 0; by < h; ++by)
      for (int bx = 0; bx < w; ++bx)
        for (int ch = 0; ch < c; ++ch) {
          double sum = 0.0;
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
          d[((size_t)by * w + bx) * c + ch] =
              y[((size_t)by * w + bx) * c + ch] - (float)(sum * inv);
        }
    for (int py = 0; py < h * s; ++py) {
      float fy = ((float)py + 0.5f) / (float)s - 0.5f;
      int y0 = (int)(fy < 0 ? -1 : fy);
      if (fy < 0) y0 = -1;
      float ty = fy - (float)y0;
      int ya = y0 < 0 ? 0 : y0;
      int yb = y0 + 1 > h - 1 ? h - 1 : y0 + 1;
      for (int px = 0; px < W; ++px) {
        float fx = ((float)px + 0.5f) / (float)s - 0.5f;
        int x0 = (int)(fx < 0 ? -1 : fx);
        float tx = fx - (float)x0;
        int xa = x0 < 0 ? 0 : x0;
        int xb = x0 + 1 > w - 1 ? w - 1 : x0 + 1;
        const float alpha = (s == 2) ? 1.35f : 1.15f;
        for (int ch = 0; ch < c; ++ch) {
          float a = d[((size_t)ya * w + xa) * c + ch];
          float b = d[((size_t)ya * w + xb) * c + ch];
          float cc = d[((size_t)yb * w + xa) * c + ch];
          float e = d[((size_t)yb * w + xb) * c + ch];
          float top = a + (b - a) * tx;
          float bot = cc + (e - cc) * tx;
          raw[((size_t)py * W + px) * c + ch] += alpha * (top + (bot - top) * ty);
        }
      }
    }
  }
}
