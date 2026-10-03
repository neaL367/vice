#include "vice_metrics.h"
#include <cmath>
#include <cstddef>

static float luma(const float* p, int c) {
  float r = c > 0 ? p[0] : 0.0f;
  float g = c > 1 ? p[1] : r;
  float b = c > 2 ? p[2] : g;
  return 0.2126f * r + 0.7152f * g + 0.0722f * b;
}

double vice_psnr(const float* a, const float* b, int w, int h, int c) {
  if (!a || !b || w <= 0 || h <= 0 || c <= 0) return -1.0;
  double se = 0.0;
  size_t n = (size_t)w * h * c;
  for (size_t i = 0; i < n; i++) {
    double d = (double)a[i] - (double)b[i];
    se += d * d;
  }
  double mse = se / (double)n;
  if (mse <= 0.0) return 1e100; // identical
  return 10.0 * std::log10(1.0 / mse); // MAX = 1.0 float domain
}

double vice_ssim(const float* a, const float* b, int w, int h, int c) {
  if (!a || !b || w < 8 || h < 8 || c <= 0) return -1.0;
  const double K1 = 0.01, K2 = 0.03, L = 1.0;
  const double C1 = (K1 * L) * (K1 * L), C2 = (K2 * L) * (K2 * L);
  const int W = 8;
  double sum = 0.0;
  long windows = 0;
  for (int y = 0; y + W <= h; y += W)
    for (int x = 0; x + W <= w; x += W) {
      double ma = 0, mb = 0;
      for (int dy = 0; dy < W; dy++)
        for (int dx = 0; dx < W; dx++) {
          ma += luma(a + ((y + dy) * w + x + dx) * c, c);
          mb += luma(b + ((y + dy) * w + x + dx) * c, c);
        }
      ma /= (W * W);
      mb /= (W * W);
      double va = 0, vb = 0, cab = 0;
      for (int dy = 0; dy < W; dy++)
        for (int dx = 0; dx < W; dx++) {
          double da = luma(a + ((y + dy) * w + x + dx) * c, c) - ma;
          double db = luma(b + ((y + dy) * w + x + dx) * c, c) - mb;
          va += da * da;
          vb += db * db;
          cab += da * db;
        }
      va /= (W * W);
      vb /= (W * W);
      cab /= (W * W);
      sum += ((2 * ma * mb + C1) * (2 * cab + C2)) /
             ((ma * ma + mb * mb + C1) * (va + vb + C2));
      windows++;
    }
  return windows ? sum / windows : -1.0;
}

double vice_seam_ratio(const float* img, int w, int h, int s, int c) {
  if (!img || w < 2 || h < 1 || s < 1 || c <= 0) return -1.0;
  double edge = 0, inner = 0;
  long ne = 0, ni = 0;
  for (int y = 0; y < h; y++)
    for (int x = 0; x + 1 < w; x++) {
      double g = 0;
      for (int ch = 0; ch < c; ch++)
        g += std::abs((double)img[(y * w + x + 1) * c + ch] - (double)img[(y * w + x) * c + ch]);
      g /= c;
      if ((x + 1) % s == 0) {
        edge += g;
        ne++;
      } else {
        inner += g;
        ni++;
      }
    }
  if (!ne || !ni) return 1.0;
  double ie = edge / ne, ii = inner / ni;
  if (ii <= 0.0) return ie <= 0.0 ? 1.0 : 1e100;
  return ie / ii;
}

void vice_box_downscale(const float* hr, float* lr, int w, int h, int s, int c) {
  const int W = w * s;
  const double inv = 1.0 / ((double)s * s);
  for (int by = 0; by < h; by++)
    for (int bx = 0; bx < w; bx++)
      for (int ch = 0; ch < c; ch++) {
        double sum = 0.0;
        for (int dy = 0; dy < s; dy++)
          for (int dx = 0; dx < s; dx++)
            sum += hr[((by * s + dy) * W + bx * s + dx) * c + ch];
        lr[(by * w + bx) * c + ch] = (float)(sum * inv);
      }
}
