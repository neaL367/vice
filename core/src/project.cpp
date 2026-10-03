#include "vice.h"

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
