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

void vice_project_box_clamped(const float* y, float* raw, int w, int h, int s, int c) {
  const int W = w * s;
  const int N = s * s;
  const double inv = 1.0 / (double)N;

  for (int by = 0; by < h; ++by) {
    for (int bx = 0; bx < w; ++bx) {
      for (int ch = 0; ch < c; ++ch) {
        float y_target = y[(by * w + bx) * c + ch];
        if (y_target <= 0.0f) {
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              raw[((by * s + dy) * W + bx * s + dx) * c + ch] = 0.0f;
          continue;
        }
        if (y_target >= 1.0f) {
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              raw[((by * s + dy) * W + bx * s + dx) * c + ch] = 1.0f;
          continue;
        }

        float vals[16];
        float min_v = 1e30f;
        float max_v = -1e30f;
        double sum = 0.0;
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            int idx = dy * s + dx;
            float v = raw[((by * s + dy) * W + bx * s + dx) * c + ch];
            vals[idx] = v;
            if (v < min_v) min_v = v;
            if (v > max_v) max_v = v;
            sum += v;
          }
        }

        double d_linear = (double)y_target - sum * inv;
        if ((double)min_v + d_linear >= 0.0 && (double)max_v + d_linear <= 1.0) {
          float d = (float)d_linear;
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              raw[((by * s + dy) * W + bx * s + dx) * c + ch] += d;
          continue;
        }

        // Saturated block: solve mean(clamp(v + d, 0, 1)) = y_target via bisection
        double lo = -(double)max_v;
        double hi = 1.0 - (double)min_v;
        for (int it = 0; it < 36; ++it) {
          double mid = 0.5 * (lo + hi);
          double cur_sum = 0.0;
          for (int k = 0; k < N; ++k) {
            double v = (double)vals[k] + mid;
            if (v < 0.0) v = 0.0;
            else if (v > 1.0) v = 1.0;
            cur_sum += v;
          }
          if (cur_sum * inv < (double)y_target) {
            lo = mid;
          } else {
            hi = mid;
          }
        }

        double d_opt = 0.5 * (lo + hi);
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            float v = (float)((double)vals[dy * s + dx] + d_opt);
            if (v < 0.0f) v = 0.0f;
            else if (v > 1.0f) v = 1.0f;
            raw[((by * s + dy) * W + bx * s + dx) * c + ch] = v;
          }
        }
      }
    }
  }
}
