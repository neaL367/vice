// vice_tests: contract gates mirroring research/ref tests + TS cross-numbers.
// Prints one line per check; exit 0 iff all pass.
#include <cmath>
#include <cstdio>
#include <vector>
#include "vice.h"
#include "../src/forward.h"
#include "../src/ibp.h"
#include "../src/kernels.h"

static int failures = 0;
#define CHECK(cond) do { \
  if (!(cond)) { std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } \
  else { std::printf("ok: %s\n", #cond); } \
} while (0)

static double psnr(const std::vector<double>& a, const std::vector<double>& b) {
  double se = 0.0;
  for (size_t i = 0; i < a.size(); i++) { double d = a[i] - b[i]; se += d * d; }
  if (se == 0.0) return 1e9;
  return 10.0 * std::log10(65025.0 / (se / a.size()));
}

int main() {
  CHECK(vice_abi_version() == 1u);

  // Constants preserved by every kernel.
  for (auto k : {vice::Kernel::Nearest, vice::Kernel::Bilinear, vice::Kernel::Bicubic,
                 vice::Kernel::Mitchell, vice::Kernel::Lanczos2, vice::Kernel::Lanczos3}) {
    std::vector<double> c(64, 128.0);
    auto o = vice::upsample(c, 8, 8, 2, k);
    double worst = 0.0;
    for (double v : o) worst = std::max(worst, std::fabs(v - 128.0));
    CHECK(worst < 1e-9);
  }

  // Bilinear never overshoots; lanczos3 does (ringing documented in TS too).
  {
    std::vector<double> step(32, 0.0);
    for (int i = 16; i < 32; i++) step[(size_t)i] = 255.0;
    // 8x4 step image, upscale 2x.
    std::vector<double> s(32, 0.0);
    for (int y = 0; y < 4; y++) for (int x = 0; x < 8; x++) s[(size_t)y * 8 + x] = x < 4 ? 0.0 : 255.0;
    auto b = vice::upsample(s, 8, 4, 2, vice::Kernel::Bilinear);
    double over = 0.0;
    for (double v : b) over = std::max(over, v < 0 ? -v : v > 255 ? v - 255 : 0.0);
    CHECK(over == 0.0);
    auto l = vice::upsample(s, 8, 4, 2, vice::Kernel::Lanczos3);
    double mx = -1e9, mn = 1e9;
    for (double v : l) { mx = std::max(mx, v); mn = std::min(mn, v); }
    CHECK(mx > 255.0 && mn < 0.0);
  }

  // Projection exactness + residual gate (mirrors forward.test.ts).
  {
    std::vector<double> lr(16, 100.0);
    std::vector<double> raw(64, 90.0);
    auto proj = vice::project_box(raw, 8, 8, lr, 4, 4, 2);
    CHECK(vice::forward_residual(proj, 8, 8, lr, 4, 4, 2) < 1e-9);
  }

  // IBP contracts: monotone residual, exact final, deterministic.
  {
    std::vector<double> lr(256, 0.0);  // 16x16 step
    for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) lr[(size_t)y * 16 + x] = x < 8 ? 0.0 : 255.0;
    auto a = vice::reconstruct_ibp(lr, 16, 16, 2, 4);
    auto b = vice::reconstruct_ibp(lr, 16, 16, 2, 4);
    CHECK(a.x == b.x);
    for (size_t i = 1; i < a.residuals.size(); i++) CHECK(a.residuals[i] <= a.residuals[i - 1] + 1e-9);
    CHECK(a.residuals.back() < 1e-5);
  }

  // TS cross-number: full-frame step-edge 2x uniform IBP = 47.62 dB (research probe).
  {
    std::vector<double> hr(1024, 0.0);  // 32x32 step at x=16
    for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) hr[(size_t)y * 32 + x] = x < 16 ? 0.0 : 255.0;
    auto lr = vice::box_downsample(hr, 32, 32, 2);
    auto r = vice::reconstruct_ibp(lr, 16, 16, 2, 4);
    double p = psnr(hr, r.x);
    std::printf("info: step2x psnr=%.2f (TS ref 47.62)\n", p);
    CHECK(std::fabs(p - 47.62) < 0.15);
  }

  // API smoke: 8x8 RGBA 2x through the C ABI, byte-exact block sums.
  {
    std::vector<unsigned char> in(8 * 8 * 4, 100);
    std::vector<unsigned char> out(16 * 16 * 4, 0);
    CHECK(vice_upscale(in.data(), 8, 8, 4, 2, out.data()) == 0);
    CHECK(vice_last_residual() < 1e-5);
    CHECK(vice_upscale(nullptr, 8, 8, 4, 2, out.data()) == -1);
    CHECK(vice_upscale(in.data(), 8, 8, 4, 5, out.data()) == -1);
  }

  std::printf(failures == 0 ? "ALL PASS\n" : "FAILURES=%d\n", failures);
  return failures == 0 ? 0 : 1;
}
