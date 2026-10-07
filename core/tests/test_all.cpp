// vice_tests: contract gates mirroring research/ref tests + TS cross-numbers.
// Prints one line per check; exit 0 iff all pass.
#include <cmath>
#include <cstdio>
#include <vector>
#include "vice.h"
#include "../src/descriptors.h"
#include "../src/forward.h"
#include "../src/ibp.h"
#include "../src/kernels.h"
#include "../src/progressive.h"
#include "../src/regularization.h"

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
  CHECK(vice_abi_version() == 3u);

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

  // Regularization contracts: flat fields feel nothing; step edge is
  // confident but not alias-like; TS cross-behavior (R_edge idle on clean step).
  {
    std::vector<double> flat(64, 128.0);
    auto lap = vice::laplacian(flat, 8, 8);
    double worst = 0.0;
    for (double v : lap) worst = std::max(worst, std::fabs(v));
    CHECK(worst == 0.0);
    std::vector<double> lr(16, 100.0);  // 4x4 flat LR
    auto maps = vice::regularization_maps(lr, 4, 4, 2);
    std::vector<double> up(64, 100.0);
    auto step = vice::regularization_step(up, 8, 8, maps, 0.05, 0.1);
    worst = 0.0;
    for (double v : step) worst = std::max(worst, std::fabs(v));
    CHECK(worst < 1e-9);
    // 8x8 step LR (edge at x=4): mean edge confidence present.
    std::vector<double> lrS(64, 0.0);
    for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) lrS[(size_t)y * 8 + x] = x < 4 ? 0.0 : 255.0;
    auto d = vice::compute_descriptors(lrS, 8, 8);
    double me = 0.0;
    for (double v : d.edge) me += v;
    CHECK(me / d.edge.size() > 0.01);
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

  // Progressive contracts (mirrors progressive.test.ts): every stage residual
  // vs ORIGINAL y stays ~0; deterministic; constants preserved; x0 honored.
  {
    std::vector<double> hr(64 * 64, 0.0);  // 64x64 step at x=32
    for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) hr[(size_t)y * 64 + x] = x < 32 ? 0.0 : 255.0;
    auto y = vice::box_downsample(hr, 64, 64, 8);
    auto a = vice::reconstruct_progressive(y, 8, 8, 8, 4);
    auto b = vice::reconstruct_progressive(y, 8, 8, 8, 4);
    CHECK(a.stages.size() == 3);
    CHECK(a.stages[0].scale == 2 && a.stages[1].scale == 4 && a.stages[2].scale == 8);
    for (const auto& st : a.stages) CHECK(st.residual_vs_y < 1e-5);
    CHECK(a.final == b.final);
    CHECK(a.final.size() == 64 * 64);
    std::vector<double> c(100, 77.0);
    auto pc = vice::reconstruct_progressive(c, 10, 10, 8, 2);
    double worst = 0.0;
    for (double v : pc.final) worst = std::max(worst, std::fabs(v - 77.0));
    CHECK(worst < 1e-6);
    // x0 passthrough respected: explicit init is the starting point.
    std::vector<double> lr4(16, 50.0);
    std::vector<double> init(64, 50.0);
    auto r0 = vice::reconstruct_ibp(lr4, 4, 4, 2, 0, &init);
    CHECK(r0.x == init);
  }

  // Progressive API smoke: 8x8 RGB 8x, byte-exact final block sums.
  {
    std::vector<unsigned char> in(8 * 8 * 3, 100);
    std::vector<unsigned char> out(64 * 64 * 3, 0);
    CHECK(vice_upscale_progressive(in.data(), 8, 8, 3, 8, out.data()) == 0);
    CHECK(vice_last_residual() < 1e-5);
    long sum = 0;
    for (unsigned char v : out) sum += v;
    CHECK(sum == 64L * 64 * 3 * 100);
    CHECK(vice_upscale_progressive(in.data(), 8, 8, 3, 5, out.data()) == -1);
  }

  // Stage-4 adoption: vice_upscale at scale 4 stages 2→4 internally.
  // Constant input stays constant; block sums stay exact; residual gated.
  {
    std::vector<unsigned char> in(8 * 8 * 3, 100);
    std::vector<unsigned char> out(32 * 32 * 3, 0);
    CHECK(vice_upscale(in.data(), 8, 8, 3, 4, out.data()) == 0);
    CHECK(vice_last_residual() < 1e-5);
    long sum = 0;
    for (unsigned char v : out) sum += v;
    CHECK(sum == 32L * 32 * 3 * 100);
    auto p = vice::reconstruct_progressive(std::vector<double>(64, 100.0), 8, 8, 4, 4);
    CHECK(p.stages.size() == 2);
    CHECK(p.stages[0].scale == 2 && p.stages[1].scale == 4);
    for (const auto& st : p.stages) CHECK(st.residual_vs_y < 1e-5);
  }

  // Ranged entry: global clamp range reproduces whole-image bytes on tiles.
  // 16x16 step split into overlapping 10x10 tiles (halo 2): valid regions
  // must match vice_upscale byte-for-byte.
  {
    std::vector<double> lr(256, 0.0);
    for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) lr[(size_t)y * 16 + x] = x < 8 ? 0.0 : 255.0;
    auto whole = vice::reconstruct_ibp(lr, 16, 16, 2, 4);
    double range[2] = {0.0, 255.0};
    // Tile A: x 0..11, valid 0..7 (halo 8..11). Tile B: x 4..15, valid 8..15
    // (halo 4..7). Halo 4 covers lanczos3 support (3) plus margin.
    for (int t = 0; t < 2; t++) {
      int x0 = t == 0 ? 0 : 4;
      std::vector<double> tlr(12 * 16);
      for (int y = 0; y < 16; y++) for (int x = 0; x < 12; x++) tlr[(size_t)y * 12 + x] = lr[(size_t)y * 16 + x + x0];
      auto tr = vice::reconstruct_ibp(tlr, 12, 16, 2, 4, nullptr, range);
      int vx0 = t == 0 ? 0 : 8, vx1 = t == 0 ? 8 : 16;
      for (int y = 0; y < 32; y++)
        for (int x = vx0 * 2; x < vx1 * 2; x++) {
          double a = whole.x[(size_t)y * 32 + x];
          double b = tr.x[(size_t)y * 24 + (x - vx0 * 2 + (t == 0 ? 0 : 8))];
          CHECK(std::fabs(a - b) < 1e-9);
        }
    }
    // API-level: ranged 2x on constants matches direct.
    std::vector<unsigned char> in(8 * 8 * 1, 100);
    std::vector<unsigned char> o1(16 * 16, 0), o2(16 * 16, 0);
    double rg[2] = {100.0, 100.0};
    CHECK(vice_upscale(in.data(), 8, 8, 1, 2, o1.data()) == 0);
    CHECK(vice_upscale_ranged(in.data(), 8, 8, 1, 2, o2.data(), rg) == 0);
    CHECK(o1 == o2);
    CHECK(vice_upscale_ranged(in.data(), 8, 8, 1, 2, o2.data(), nullptr) == -1);
  }

  std::printf(failures == 0 ? "ALL PASS\n" : "FAILURES=%d\n", failures);
  return failures == 0 ? 0 : 1;
}
