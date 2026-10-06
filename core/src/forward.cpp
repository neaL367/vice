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
  auto pred = simulate_forward(hr, w, h, s);
  double se = 0.0;
  for (size_t i = 0; i < pred.size(); i++) {
    const double d = pred[i] - lr[i];
    se += d * d;
  }
  (void)lw;
  (void)lh;
  return std::sqrt(se / pred.size());
}

std::vector<double> project_box(const std::vector<double>& hr, int w, int h,
                                const std::vector<double>& lr, int lw, int lh, int s) {
  std::vector<double> out = hr;
  (void)h;  // rows covered by lh*s; kept for symmetric call shape
  for (int y = 0; y < lh; y++)
    for (int x = 0; x < lw; x++) {
      double acc = 0.0;
      for (int dy = 0; dy < s; dy++)
        for (int dx = 0; dx < s; dx++) acc += out[(size_t)(y * s + dy) * w + x * s + dx];
      const double corr = lr[(size_t)y * lw + x] - acc / (s * s);
      for (int dy = 0; dy < s; dy++)
        for (int dx = 0; dx < s; dx++) out[(size_t)(y * s + dy) * w + x * s + dx] += corr;
    }
  return out;
}

}  // namespace vice
