#include "vice.h"
#include <cmath>
#include <vector>
#include "ibp.h"
#include "progressive.h"

namespace {
double g_last_residual = -1.0;

double clamp_byte(double v) { return v < 0.0 ? 0.0 : v > 255.0 ? 255.0 : v; }

// Integer-exact block quantization: round, then push ±1 levels along largest
// fractional headroom until the block sums to s²× the source byte exactly.
// Always terminates exact: target ∈ [0, 255s²], and err ≠ 0 implies some pixel
// has headroom in the needed direction. Kills ringing residue as a side effect
// (overshoot pixels are the first donors/recipients).
void quantize_exact(const double* blk, int s, double target, unsigned char* out) {
  const int n = s * s;
  std::vector<int> vals(n);
  std::vector<double> frac(n);
  long sum = 0;
  for (int i = 0; i < n; i++) {
    double c = clamp_byte(blk[i]);
    int q = (int)std::floor(c + 0.5);
    if (q < 0) q = 0;
    if (q > 255) q = 255;
    vals[i] = q;
    frac[i] = c - q;  // ∈ [-0.5, 0.5]: >0 wants up, <0 wants down
    sum += q;
  }
  long err = std::lround(target) - sum;
  while (err != 0) {
    int best = -1;
    if (err > 0) {
      double bf = -1e9;
      for (int i = 0; i < n; i++)
        if (vals[i] < 255 && frac[i] > bf) { bf = frac[i]; best = i; }
      if (best < 0) break;
      vals[best]++;
      frac[best] -= 1.0;
      err--;
    } else {
      double bf = 1e9;
      for (int i = 0; i < n; i++)
        if (vals[i] > 0 && frac[i] < bf) { bf = frac[i]; best = i; }
      if (best < 0) break;
      vals[best]--;
      frac[best] += 1.0;
      err++;
    }
  }
  for (int i = 0; i < n; i++) out[i] = (unsigned char)vals[i];
}
}  // namespace

unsigned vice_abi_version(void) { return VICE_ABI_VERSION; }

int vice_upscale(const unsigned char* in, int w, int h, int ch, int scale, unsigned char* out) {
  if (!in || !out || w <= 0 || h <= 0 || (ch != 1 && ch != 3 && ch != 4) ||
      (scale != 2 && scale != 3 && scale != 4))
    return -1;
  const int ow = w * scale;
  double worst = 0.0;
  std::vector<double> lr(static_cast<size_t>(w) * h);
  std::vector<double> blk(static_cast<size_t>(scale) * scale);
  std::vector<unsigned char> qblk(static_cast<size_t>(scale) * scale);
  for (int c = 0; c < ch; c++) {
    for (int i = 0; i < w * h; i++) lr[(size_t)i] = in[(size_t)i * ch + c];
    auto r = vice::reconstruct_ibp(lr, w, h, scale, VICE_ITERS);
    if (r.residuals.back() > worst) worst = r.residuals.back();
    for (int by = 0; by < h; by++)
      for (int bx = 0; bx < w; bx++) {
        for (int dy = 0; dy < scale; dy++)
          for (int dx = 0; dx < scale; dx++)
            blk[(size_t)dy * scale + dx] = r.x[(size_t)(by * scale + dy) * ow + bx * scale + dx];
        quantize_exact(blk.data(), scale, (double)(scale * scale) * lr[(size_t)by * w + bx], qblk.data());
        for (int dy = 0; dy < scale; dy++)
          for (int dx = 0; dx < scale; dx++)
            out[(size_t)((by * scale + dy) * ow + bx * scale + dx) * ch + c] =
                qblk[(size_t)dy * scale + dx];
      }
  }
  g_last_residual = worst;
  return 0;
}

// Hierarchical progressive upscale (2, 4, or 8): float64 staging through
// 2x steps, each projecting against the input; integer-exact block
// quantization applies once, at the final scale, against source bytes.
int vice_upscale_progressive(const unsigned char* in, int w, int h, int ch, int scale,
                             unsigned char* out) {
  if (!in || !out || w <= 0 || h <= 0 || (ch != 1 && ch != 3 && ch != 4) ||
      (scale != 2 && scale != 4 && scale != 8))
    return -1;
  const int ow = w * scale;
  double worst = 0.0;
  std::vector<double> lr(static_cast<size_t>(w) * h);
  std::vector<double> blk(static_cast<size_t>(scale) * scale);
  std::vector<unsigned char> qblk(static_cast<size_t>(scale) * scale);
  for (int c = 0; c < ch; c++) {
    for (int i = 0; i < w * h; i++) lr[(size_t)i] = in[(size_t)i * ch + c];
    auto p = vice::reconstruct_progressive(lr, w, h, scale, VICE_ITERS);
    for (const auto& st : p.stages) worst = std::max(worst, st.residual_vs_y);
    for (int by = 0; by < h; by++)
      for (int bx = 0; bx < w; bx++) {
        for (int dy = 0; dy < scale; dy++)
          for (int dx = 0; dx < scale; dx++)
            blk[(size_t)dy * scale + dx] = p.final[(size_t)(by * scale + dy) * ow + bx * scale + dx];
        quantize_exact(blk.data(), scale, (double)(scale * scale) * lr[(size_t)by * w + bx], qblk.data());
        for (int dy = 0; dy < scale; dy++)
          for (int dx = 0; dx < scale; dx++)
            out[(size_t)((by * scale + dy) * ow + bx * scale + dx) * ch + c] =
                qblk[(size_t)dy * scale + dx];
      }
  }
  g_last_residual = worst;
  return 0;
}

double vice_last_residual(void) { return g_last_residual; }
