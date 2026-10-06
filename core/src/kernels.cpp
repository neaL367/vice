#include "kernels.h"
#include <cmath>

namespace vice {

namespace {
double sinc(double x) {
  if (x == 0.0) return 1.0;
  const double px = M_PI * x;
  return std::sin(px) / px;
}
int edge_idx(int i, int n) {
  if (i < 0) return -i;
  if (i >= n) return 2 * n - 2 - i;
  return i;
}
}  // namespace

double kernel_weight(Kernel k, double x) {
  const double ax = std::fabs(x);
  switch (k) {
    case Kernel::Nearest:
      return ax < 0.5 ? 1.0 : 0.0;
    case Kernel::Bilinear:
      return ax < 1.0 ? 1.0 - ax : 0.0;
    case Kernel::Bicubic: {
      constexpr double a = -0.5;  // Catmull-Rom
      if (ax < 1.0) return (a + 2.0) * ax * ax * ax - (a + 3.0) * ax * ax + 1.0;
      if (ax < 2.0) return a * ax * ax * ax - 5.0 * a * ax * ax + 8.0 * a * ax - 4.0 * a;
      return 0.0;
    }
    case Kernel::Mitchell: {
      constexpr double B = 1.0 / 3.0, C = 1.0 / 3.0;
      if (ax < 1.0)
        return ((12.0 - 9.0 * B - 6.0 * C) * ax * ax * ax + (-18.0 + 12.0 * B + 6.0 * C) * ax * ax +
                (6.0 - 2.0 * B)) / 6.0;
      if (ax < 2.0)
        return ((-B - 6.0 * C) * ax * ax * ax + (6.0 * B + 30.0 * C) * ax * ax +
                (-12.0 * B - 48.0 * C) * ax + (8.0 * B + 24.0 * C)) / 6.0;
      return 0.0;
    }
    case Kernel::Lanczos2:
      return ax < 2.0 ? sinc(x) * sinc(x / 2.0) : 0.0;
    case Kernel::Lanczos3:
      return ax < 3.0 ? sinc(x) * sinc(x / 3.0) : 0.0;
  }
  return 0.0;
}

double kernel_radius(Kernel k) {
  switch (k) {
    case Kernel::Nearest:
      return 0.5;
    case Kernel::Bilinear:
      return 1.0;
    case Kernel::Bicubic:
    case Kernel::Mitchell:
    case Kernel::Lanczos2:
      return 2.0;
    case Kernel::Lanczos3:
      return 3.0;
  }
  return 1.0;
}

std::vector<double> upsample(const std::vector<double>& src, int w, int h, int s, Kernel k) {
  const double r = kernel_radius(k);
  const int ow = w * s, oh = h * s;
  std::vector<double> horiz(static_cast<size_t>(ow) * h, 0.0);
  for (int y = 0; y < h; y++) {
    for (int ox = 0; ox < ow; ox++) {
      const double c = (ox + 0.5) / s - 0.5;
      double acc = 0.0, wsum = 0.0;
      for (int ix = (int)std::floor(c - r) + 1; ix <= (int)std::ceil(c + r) - 1; ix++) {
        const double wt = kernel_weight(k, c - ix);
        if (wt == 0.0) continue;
        acc += src[(size_t)y * w + edge_idx(ix, w)] * wt;
        wsum += wt;
      }
      horiz[(size_t)y * ow + ox] = wsum != 0.0 ? acc / wsum : 0.0;
    }
  }
  std::vector<double> out(static_cast<size_t>(ow) * oh, 0.0);
  for (int oy = 0; oy < oh; oy++) {
    const double c = (oy + 0.5) / s - 0.5;
    for (int x = 0; x < ow; x++) {
      double acc = 0.0, wsum = 0.0;
      for (int iy = (int)std::floor(c - r) + 1; iy <= (int)std::ceil(c + r) - 1; iy++) {
        const double wt = kernel_weight(k, c - iy);
        if (wt == 0.0) continue;
        acc += horiz[(size_t)edge_idx(iy, h) * ow + x] * wt;
        wsum += wt;
      }
      out[(size_t)oy * ow + x] = wsum != 0.0 ? acc / wsum : 0.0;
    }
  }
  return out;
}

}  // namespace vice
