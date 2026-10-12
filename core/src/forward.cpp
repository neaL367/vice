#include "forward.h"
#include <cmath>
#include <stdexcept>

namespace vice {

std::vector<double> box_downsample(const std::vector<double>& hr, int w, int h, int s) {
  if (w % s != 0 || h % s != 0) throw std::invalid_argument("not divisible");
  const int lw = w / s, lh = h / s;
  std::vector<double> out(static_cast<size_t>(lw) * lh, 0.0);
  for (int y = 0; y < lh; y++)
    for (int x = 0; x < lw; x++) {
      double acc = 0.0;
      for (int dy = 0; dy < s; dy++)
        for (int dx = 0; dx < s; dx++) acc += hr[(size_t)(y * s + dy) * w + x * s + dx];
      out[(size_t)y * lw + x] = acc / (s * s);
    }
  return out;
}

std::vector<double> simulate_forward(const std::vector<double>& hr, int w, int h, int s) {
  return box_downsample(hr, w, h, s);  // H = identity in product v1
}

double forward_residual(const std::vector<double>& hr, int w, int h, const std::vector<double>& lr,
                        int lw, int lh, int s) {
  (void)h;
  const double inv_s2 = 1.0 / static_cast<double>(s * s);
  double se = 0.0;
  for (int y = 0; y < lh; y++) {
    for (int x = 0; x < lw; x++) {
      double acc = 0.0;
      for (int dy = 0; dy < s; dy++) {
        for (int dx = 0; dx < s; dx++) {
          acc += hr[(size_t)(y * s + dy) * w + x * s + dx];
        }
      }
      const double d = acc * inv_s2 - lr[(size_t)y * lw + x];
      se += d * d;
    }
  }
  return std::sqrt(se / (static_cast<size_t>(lw) * lh));
}

void project_box_inplace(std::vector<double>& hr, int w, int h,
                         const std::vector<double>& lr, int lw, int lh, int s) {
  (void)h;
  const double inv_s2 = 1.0 / static_cast<double>(s * s);
  for (int y = 0; y < lh; y++) {
    for (int x = 0; x < lw; x++) {
      double acc = 0.0;
      for (int dy = 0; dy < s; dy++) {
        for (int dx = 0; dx < s; dx++) {
          acc += hr[(size_t)(y * s + dy) * w + x * s + dx];
        }
      }
      const double corr = lr[(size_t)y * lw + x] - acc * inv_s2;
      for (int dy = 0; dy < s; dy++) {
        for (int dx = 0; dx < s; dx++) {
          hr[(size_t)(y * s + dy) * w + x * s + dx] += corr;
        }
      }
    }
  }
}

std::vector<double> project_box(std::vector<double>&& hr, int w, int h,
                                const std::vector<double>& lr, int lw, int lh, int s) {
  project_box_inplace(hr, w, h, lr, lw, lh, s);
  return std::move(hr);
}

std::vector<double> project_box(const std::vector<double>& hr, int w, int h,
                                const std::vector<double>& lr, int lw, int lh, int s) {
  std::vector<double> out = hr;
  project_box_inplace(out, w, h, lr, lw, lh, s);
  return out;
}

}  // namespace vice
