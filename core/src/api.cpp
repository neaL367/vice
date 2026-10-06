#include "vice.h"
#include <cmath>
#include <vector>
#include "ibp.h"

namespace {
double g_last_residual = -1.0;

double clamp_byte(double v) { return v < 0.0 ? 0.0 : v > 255.0 ? 255.0 : v; }
}  // namespace

unsigned vice_abi_version(void) { return VICE_ABI_VERSION; }

int vice_upscale(const unsigned char* in, int w, int h, int ch, int scale, unsigned char* out) {
  if (!in || !out || w <= 0 || h <= 0 || (ch != 1 && ch != 3 && ch != 4) ||
      (scale != 2 && scale != 3 && scale != 4))
    return -1;
  const int ow = w * scale, oh = h * scale;
  double worst = 0.0;
  std::vector<double> lr(static_cast<size_t>(w) * h);
  for (int c = 0; c < ch; c++) {
    for (int i = 0; i < w * h; i++) lr[(size_t)i] = in[(size_t)i * ch + c];
    auto r = vice::reconstruct_ibp(lr, w, h, scale, VICE_ITERS);
    if (r.residuals.back() > worst) worst = r.residuals.back();
    for (int i = 0; i < ow * oh; i++)
      out[(size_t)i * ch + c] = (unsigned char)(std::lround(clamp_byte(r.x[(size_t)i])));
  }
  g_last_residual = worst;
  return 0;
}

double vice_last_residual(void) { return g_last_residual; }
