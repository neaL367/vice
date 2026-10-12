// vice_tests: contract gates mirroring research/ref tests + TS cross-numbers.
// Prints one line per check; exit 0 iff all pass.
#include <cmath>
#include <cstdio>
#include <utility>
#include <vector>
#include "vice.h"
#include "../src/burst.h"
#include "../src/color.h"
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
  CHECK(vice_abi_version() == 4u);

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

  // Burst contracts: shift exactness, registration on pseudo-texture,
  // joint residual gate + determinism, periodic fallback, API smoke.
  {
    // shift_image contracts: zero shift is identity (bit-exact), integer
    // shift permutes exactly. Correlated pseudo-texture (sine gratings +
    // step) underlies the lossy-operation probes below. (White noise is
    // unregistrable by design — no cross-scale structure.)
    std::vector<double> img(64 * 64);
    for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) img[(size_t)y * 64 + x] = (x * 7 + y * 13) % 251;
    CHECK(vice::shift_image(img, 64, 64, 0.0, 0.0) == img);
    auto ish = vice::shift_image(img, 64, 64, 1.0, 0.0);
    bool permute_ok = true;
    for (int y = 0; y < 64 && permute_ok; y++)
      for (int x = 1; x < 64 && permute_ok; x++)
        if (ish[(size_t)y * 64 + x] != img[(size_t)y * 64 + x - 1]) permute_ok = false;
    CHECK(permute_ok);
    std::vector<double> tex(32 * 32);
    for (int y = 0; y < 32; y++)
      for (int x = 0; x < 32; x++)
        tex[(size_t)y * 32 + x] =
            100.0 + 50.0 * std::sin(2.0 * 3.141592653589793 * x / 16.0) +
            30.0 * std::sin(2.0 * 3.141592653589793 * x / 7.0 + 1.0) +
            40.0 * std::sin(2.0 * 3.141592653589793 * y / 24.0) + (x < 16 ? 0.0 : 30.0);
    // Registration with known 0.5px shift, recovered exactly. Confidence is
    // asserted nonnegative here; its calibration (keep natural, drop
    // ambiguous) lives in the TS bench where battery fixtures exercise it.
    // (White noise can show spuriously sharp random basins, so no ordering
    // contract — the fusion-level aliasing trap, not the margin, owns that.)
    auto moved = vice::shift_image(tex, 32, 32, 0.5, 0.0);
    auto e = vice::estimate_shift(tex, moved, 32, 32);
    CHECK(std::fabs(e.dx - 0.5) < 1e-9 && std::fabs(e.dy) < 1e-9);
    CHECK(e.confidence >= 0.0);
    // Joint burst on a step edge: residual gate + deterministic.
    std::vector<double> hr(64 * 64, 0.0);
    for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) hr[(size_t)y * 64 + x] = x < 32 ? 0.0 : 255.0;
    auto lr0 = vice::box_downsample(hr, 64, 64, 2);
    auto lr1 = vice::box_downsample(vice::shift_image(hr, 64, 64, 1.0, 0.0), 64, 64, 2);
    auto b1 = vice::reconstruct_burst({lr0, lr1}, 32, 32, 2, 4, nullptr, 0.05);
    auto b2 = vice::reconstruct_burst({lr0, lr1}, 32, 32, 2, 4, nullptr, 0.05);
    CHECK(b1.x == b2.x);
    CHECK(b1.residual_vs_ref < 1e-5);
    // Periodic stripes: ambiguous → fallback to reference alone.
    std::vector<double> per(64 * 64);
    for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++) per[(size_t)y * 64 + x] = ((x >> 2) & 1) ? 0.0 : 255.0;
    auto p0 = vice::box_downsample(per, 64, 64, 2);
    auto p1 = vice::box_downsample(vice::shift_image(per, 64, 64, 1.0, 0.0), 64, 64, 2);
    auto bp = vice::reconstruct_burst({p0, p1}, 32, 32, 2, 4, nullptr, 0.05);
    CHECK(bp.kept == std::vector<int>({0}));
    // API smoke: 2-frame burst bytes + oracle shifts path.
    std::vector<unsigned char> in0(8 * 8, 100), in1(8 * 8, 100);
    const unsigned char* ins[2] = {in0.data(), in1.data()};
    std::vector<unsigned char> bout(16 * 16, 0);
    CHECK(vice_upscale_burst(ins, 2, 8, 8, 1, 2, bout.data(), nullptr) == 0);
    CHECK(vice_last_residual() < 1e-5);
    double osh[4] = {0.0, 0.0, 0.5, 0.0};
    CHECK(vice_upscale_burst(ins, 2, 8, 8, 1, 2, bout.data(), osh) == 0);
    CHECK(vice_upscale_burst(ins, 0, 8, 8, 1, 2, bout.data(), nullptr) == -1);
    CHECK(vice_upscale_burst(ins, 2, 8, 8, 1, 5, bout.data(), nullptr) == -1);
  }

  // H6 adaptive iteration count: shared floats, determinism, envelope,
  // non-regression vs fixed-4, and the K2 savings-or-gains bar.
  {
    // Forced-4 auto reproduces fixed-4 bit-exactly (shared pass floats).
    std::vector<double> lr(256, 0.0);
    for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) lr[(size_t)y * 16 + x] = x < 8 ? 0.0 : 255.0;
    vice::AutoIters forced{4, 4, 0.0};
    auto f4 = vice::reconstruct_ibp(lr, 16, 16, 2, 4);
    auto a4 = vice::reconstruct_ibp_auto(lr, 16, 16, 2, forced);
    CHECK(a4.x == f4.x);
    CHECK(a4.iters_used == 4);
    // Default policy trajectories (instrumentation doubles as the record).
    vice::AutoIters pol;
    auto show = [&](const char* name, const std::vector<double>& v, int w, int h) {
      auto r = vice::reconstruct_ibp_auto(v, w, h, 2, pol);
      std::printf("info: auto-%s iters=%d residuals=", name, r.iters_used);
      for (double q : r.residuals) std::printf(" %.3e", q);
      std::printf("\n");
      return r;
    };
    std::vector<double> flat(64, 128.0);
    auto rflat = show("flat", flat, 8, 8);
    auto rstep = show("step", lr, 16, 16);
    std::vector<double> tex(256, 0.0);
    for (int y = 0; y < 16; y++)
      for (int x = 0; x < 16; x++)
        tex[(size_t)y * 16 + x] =
            128.0 + 60.0 * std::sin(2.0 * 3.141592653589793 * x / 9.0) +
            40.0 * std::sin(2.0 * 3.141592653589793 * y / 13.0 + 1.0);
    auto rtex = show("texture", tex, 16, 16);
    // Determinism.
    auto rstep2 = vice::reconstruct_ibp_auto(lr, 16, 16, 2, pol);
    CHECK(rstep2.x == rstep.x);
    // Envelope: monotone-ish, gated residual.
    for (const auto* rp : {&rflat, &rstep, &rtex}) {
      for (size_t i = 1; i < rp->residuals.size(); i++)
        CHECK(rp->residuals[i] <= rp->residuals[i - 1] + 1e-9);
      CHECK(rp->residuals.back() < 1e-5);
    }
    // K1: no PSNR regression vs fixed-4 on step and texture.
    std::vector<double> hr(1024, 0.0);
    for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) hr[(size_t)y * 32 + x] = x < 16 ? 0.0 : 255.0;
    auto sLR = vice::box_downsample(hr, 32, 32, 2);
    auto sFix = vice::reconstruct_ibp(sLR, 16, 16, 2, 4);
    auto sAuto = vice::reconstruct_ibp_auto(sLR, 16, 16, 2, pol);
    double psF = psnr(hr, sFix.x), psA = psnr(hr, sAuto.x);
    std::printf("info: step psnr fixed=%.2f auto=%.2f (iters=%d)\n", psF, psA, sAuto.iters_used);
    CHECK(psA >= psF - 0.02);
    CHECK(psA > psF + 1.0);  // K2a gain: extra passes earn their keep here
    std::vector<double> tex32(1024, 0.0);
    for (int y = 0; y < 32; y++)
      for (int x = 0; x < 32; x++)
        tex32[(size_t)y * 32 + x] =
            128.0 + 60.0 * std::sin(2.0 * 3.141592653589793 * x / 9.0) +
            40.0 * std::sin(2.0 * 3.141592653589793 * y / 13.0 + 1.0);
    auto tLR = vice::box_downsample(tex32, 32, 32, 2);
    auto tFix = vice::reconstruct_ibp(tLR, 16, 16, 2, 4);
    auto tAuto = vice::reconstruct_ibp_auto(tLR, 16, 16, 2, pol);
    double ptF = psnr(tex32, tFix.x), ptA = psnr(tex32, tAuto.x);
    std::printf("info: texture psnr fixed=%.2f auto=%.2f (iters=%d)\n", ptF, ptA, tAuto.iters_used);
    // Tolerance −0.05 matches the program's texture gate used in the H5
    // trials: extra passes trade microscopic truth-PSNR on ambiguous
    // texture for large gains where structure exists (step +18 dB above).
    CHECK(ptA >= ptF - 0.05);
    // K2: must save passes somewhere or gain quality somewhere.
    bool saved = rflat.iters_used < 4 || rstep.iters_used < 4 || rtex.iters_used < 4;
    bool gained = psA > psF + 1e-9 || ptA > ptF + 1e-9;
    std::printf("info: h6 saved=%d gained=%d\n", (int)saved, (int)gained);
    CHECK(saved || gained);
  }

  // YCoCg pair contract (kept utility; the H7 working-space driver that
  // used it was killed — see color.h. Roundtrip must stay near-exact so
  // the pair remains available for future color work).
  {
    double worst = 0.0;
    for (int v = 0; v < 256; v++) {
      double y, co, cg, r, g, b;
      vice::rgb_to_ycocg(v, 255 - v, (v * 7) % 256, &y, &co, &cg);
      vice::ycocg_to_rgb(y, co, cg, &r, &g, &b);
      worst = std::max(worst, std::fabs(r - v));
      worst = std::max(worst, std::fabs(g - (255 - v)));
      worst = std::max(worst, std::fabs(b - ((v * 7) % 256)));
    }
    CHECK(worst < 1e-9);
  }

  // H8 per-channel adaptive budgets: gain on structure, savings on flat,
  // no regression anywhere. 16x16 fixtures → 2x.
  {
    vice::AutoIters pol;
    auto todb = [](const std::vector<unsigned char>& v) {
      std::vector<double> d(v.size());
      for (size_t i = 0; i < v.size(); i++) d[i] = v[i];
      return d;
    };
    auto exact_sums = [](const std::vector<unsigned char>& o,
                         const std::vector<unsigned char>& s, int ch) {
      for (int by = 0; by < 16; by++)
        for (int bx = 0; bx < 16; bx++)
          for (int c = 0; c < ch; c++) {
            long sum = 0;
            for (int dy = 0; dy < 2; dy++)
              for (int dx = 0; dx < 2; dx++)
                sum += o[((size_t)(by * 2 + dy) * 32 + bx * 2 + dx) * ch + c];
            if (sum != 4L * s[((size_t)by * 16 + bx) * ch + c]) return false;
          }
      return true;
    };
    // Guards: residual stays -1 on bad arguments.
    std::vector<unsigned char> bad(16 * 16 * 3, 100), badOut(32 * 32 * 3, 0);
    CHECK(vice::upscale_auto_rgb(nullptr, 16, 16, 3, 2, badOut.data(), pol).residual < 0.0);
    CHECK(vice::upscale_auto_rgb(bad.data(), 16, 16, 2, 2, badOut.data(), pol).residual < 0.0);
    CHECK(vice::upscale_auto_rgb(bad.data(), 16, 16, 3, 4, badOut.data(), pol).residual < 0.0);
    // K2b savings: flat RGBA → every channel stops at the minimum.
    {
      std::vector<unsigned char> in(16 * 16 * 4, 100);
      std::vector<unsigned char> oFix(32 * 32 * 4), oAuto(32 * 32 * 4);
      CHECK(vice_upscale(in.data(), 16, 16, 4, 2, oFix.data()) == 0);
      auto r = vice::upscale_auto_rgb(in.data(), 16, 16, 4, 2, oAuto.data(), pol);
      int total = r.iters_used[0] + r.iters_used[1] + r.iters_used[2] + r.iters_used[3];
      std::printf("info: h8-flat iters=[%d,%d,%d,%d] total=%d residual=%.3e\n", r.iters_used[0],
                  r.iters_used[1], r.iters_used[2], r.iters_used[3], total, r.residual);
      CHECK(total < 16);
      CHECK(r.residual >= 0.0 && r.residual < 1e-5);
      CHECK(exact_sums(oAuto, in, 4));
      CHECK(oAuto == oFix);  // constants: budgets change nothing
    }
    // K2a gain + mixed budgets: RGB step (structured) + flat alpha.
    {
      std::vector<unsigned char> in(16 * 16 * 4);
      for (int y = 0; y < 16; y++)
        for (int x = 0; x < 16; x++) {
          unsigned char c = x < 8 ? 0 : 255;
          in[((size_t)y * 16 + x) * 4] = c;
          in[((size_t)y * 16 + x) * 4 + 1] = c;
          in[((size_t)y * 16 + x) * 4 + 2] = c;
          in[((size_t)y * 16 + x) * 4 + 3] = 255;
        }
      std::vector<double> hr(32 * 32 * 4, 0.0);
      for (int y = 0; y < 32; y++)
        for (int x = 0; x < 32; x++) {
          double c = x < 16 ? 0.0 : 255.0;
          hr[((size_t)y * 32 + x) * 4] = c;
          hr[((size_t)y * 32 + x) * 4 + 1] = c;
          hr[((size_t)y * 32 + x) * 4 + 2] = c;
          hr[((size_t)y * 32 + x) * 4 + 3] = 255.0;
        }
      std::vector<unsigned char> oFix(32 * 32 * 4), oAuto(32 * 32 * 4);
      CHECK(vice_upscale(in.data(), 16, 16, 4, 2, oFix.data()) == 0);
      auto r = vice::upscale_auto_rgb(in.data(), 16, 16, 4, 2, oAuto.data(), pol);
      double pF = psnr(todb(oFix), hr), pA = psnr(todb(oAuto), hr);
      std::printf("info: h8-step psnr fixed=%.2f auto=%.2f iters=[%d,%d,%d,%d] residual=%.3e\n",
                  pF, pA, r.iters_used[0], r.iters_used[1], r.iters_used[2], r.iters_used[3],
                  r.residual);
      // Byte-level steps quantize trivially perfect under exact sums, so the
      // gain evidence lives at float level (H6: +18 dB). Here: no regression
      // plus the budget shape — structured channels run on, flat alpha stops.
      CHECK(pA >= pF - 1e-9);
      CHECK(r.iters_used[3] < r.iters_used[0]);  // flat alpha stops early
      CHECK(r.residual >= 0.0 && r.residual < 1e-5);
      CHECK(exact_sums(oAuto, in, 4));
    }
    // K1 no-regression: sine texture + chroma texture within −0.05.
    {
      auto tex_case = [&](bool chroma) {
        std::vector<unsigned char> in(16 * 16 * 3);
        std::vector<double> truth(32 * 32 * 3);
        for (int y = 0; y < 32; y++)
          for (int x = 0; x < 32; x++) {
            double r, g, b;
            if (!chroma) {
              double v = 128.0 + 60.0 * std::sin(2.0 * 3.141592653589793 * x / 9.0) +
                         40.0 * std::sin(2.0 * 3.141592653589793 * y / 13.0 + 1.0);
              r = g = b = v;
            } else {
              r = 128.0 + 100.0 * std::sin(2.0 * 3.141592653589793 * x / 7.0) +
                  27.0 * std::sin(2.0 * 3.141592653589793 * y / 5.0 + 1.0);
              g = 0.0;
              b = 128.0 + 100.0 * std::sin(2.0 * 3.141592653589793 * y / 6.0 + 2.0) +
                  27.0 * std::sin(2.0 * 3.141592653589793 * x / 11.0);
            }
            auto cl = [](double v) { return v < 0.0 ? 0.0 : v > 255.0 ? 255.0 : v; };
            truth[((size_t)y * 32 + x) * 3] = cl(r);
            truth[((size_t)y * 32 + x) * 3 + 1] = cl(g);
            truth[((size_t)y * 32 + x) * 3 + 2] = cl(b);
            // LR samples the truth's even lattice (same input for both
            // methods, so the comparison is relative and exact).
            if (x % 2 == 0 && y % 2 == 0) {
              int lx = x / 2, ly = y / 2;
              in[((size_t)ly * 16 + lx) * 3] = (unsigned char)(cl(r) + 0.5);
              in[((size_t)ly * 16 + lx) * 3 + 1] = (unsigned char)(cl(g) + 0.5);
              in[((size_t)ly * 16 + lx) * 3 + 2] = (unsigned char)(cl(b) + 0.5);
            }
          }
        return std::make_pair(in, truth);
      };
      for (int tc = 0; tc < 2; tc++) {
        bool chroma = tc == 1;
        auto [in, truth] = tex_case(chroma);
        std::vector<unsigned char> oFix(32 * 32 * 3), oAuto(32 * 32 * 3);
        CHECK(vice_upscale(in.data(), 16, 16, 3, 2, oFix.data()) == 0);
        auto r = vice::upscale_auto_rgb(in.data(), 16, 16, 3, 2, oAuto.data(), pol);
        double pF = psnr(todb(oFix), truth), pA = psnr(todb(oAuto), truth);
        std::printf("info: h8-%s psnr fixed=%.2f auto=%.2f iters=[%d,%d,%d]\n",
                    chroma ? "chroma" : "texture", pF, pA, r.iters_used[0], r.iters_used[1],
                    r.iters_used[2]);
        CHECK(pA >= pF - 0.05);
        CHECK(r.residual >= 0.0 && r.residual < 1e-5);
        CHECK(exact_sums(oAuto, in, 3));
      }
    }
  }

  // H9 linear-light pipeline: camera-honest synthetics (linear truth →
  // linear box → gamma-encoded LR), judged in linear space.
  {
    // Camera model: box-mean in linear light, then gamma-encode to bytes.
    auto camera_lr = [](const std::vector<double>& truthLin, int hw) {
      int lw = hw / 2;
      std::vector<unsigned char> lr((size_t)lw * lw * 3);
      for (int y = 0; y < lw; y++)
        for (int x = 0; x < lw; x++) {
          double m[3] = {0.0, 0.0, 0.0};
          for (int dy = 0; dy < 2; dy++)
            for (int dx = 0; dx < 2; dx++)
              for (int c = 0; c < 3; c++)
                m[c] += truthLin[((size_t)(y * 2 + dy) * hw + x * 2 + dx) * 3 + c];
          for (int c = 0; c < 3; c++) {
            double byte = vice::linear_to_srgb(m[c] / 4.0 / 255.0) * 255.0;
            lr[((size_t)y * lw + x) * 3 + c] = (unsigned char)(byte + 0.5);
          }
        }
      return lr;
    };
    auto to_linear = [](const std::vector<unsigned char>& bytes) {
      std::vector<double> d(bytes.size());
      for (size_t i = 0; i < bytes.size(); i++)
        d[i] = vice::srgb_to_linear(bytes[i] / 255.0) * 255.0;
      return d;
    };
    auto lin_psnr = [](const std::vector<double>& a, const std::vector<double>& b) {
      double se = 0.0;
      for (size_t i = 0; i < a.size(); i++) {
        double d = a[i] - b[i];
        se += d * d;
      }
      if (se == 0.0) return 1e9;
      return 10.0 * std::log10(65025.0 / (se / a.size()));
    };
    // Guards.
    std::vector<unsigned char> bad(16 * 16 * 3, 100), badOut(32 * 32 * 3, 0);
    CHECK(vice::linear_upscale(nullptr, 16, 16, 3, 2, badOut.data(), 4) < 0.0);
    CHECK(vice::linear_upscale(bad.data(), 16, 16, 2, 2, badOut.data(), 4) < 0.0);
    CHECK(vice::linear_upscale(bad.data(), 16, 16, 3, 5, badOut.data(), 4) < 0.0);
    CHECK(vice::linear_upscale(bad.data(), 16, 16, 3, 2, badOut.data(), -1) < 0.0);
    // K2: constants pass through byte-identical (roundtrip transparency).
    {
      std::vector<unsigned char> in(8 * 8 * 3, 100), out(16 * 16 * 3, 0);
      double r = vice::linear_upscale(in.data(), 8, 8, 3, 2, out.data(), 4);
      CHECK(r >= 0.0 && r < 1e-5);
      CHECK(out == std::vector<unsigned char>(16 * 16 * 3, 100));
    }
    // K1: linear-truth texture + zoneplate, gamma path vs linear path.
    auto lin_case = [&](bool zone) {
      std::vector<double> truth(32 * 32 * 3);
      for (int y = 0; y < 32; y++)
        for (int x = 0; x < 32; x++) {
          double v;
          if (!zone) {
            v = 128.0 + 60.0 * std::sin(2.0 * 3.141592653589793 * x / 9.0) +
                40.0 * std::sin(2.0 * 3.141592653589793 * y / 13.0 + 1.0);
          } else {
            double dx = x - 16.0, dy = y - 16.0;
            double rr = std::sqrt(dx * dx + dy * dy);
            v = 128.0 + 100.0 * std::sin(3.141592653589793 * rr * rr / 32.0);
          }
          if (v < 0.0) v = 0.0;
          if (v > 255.0) v = 255.0;
          truth[((size_t)y * 32 + x) * 3] = v;
          truth[((size_t)y * 32 + x) * 3 + 1] = v;
          truth[((size_t)y * 32 + x) * 3 + 2] = v;
        }
      return truth;
    };
    for (int zc = 0; zc < 2; zc++) {
      bool zone = zc == 1;
      auto truth = lin_case(zone);
      auto lr = camera_lr(truth, 32);
      std::vector<unsigned char> oGam(32 * 32 * 3), oLin(32 * 32 * 3);
      CHECK(vice_upscale(lr.data(), 16, 16, 3, 2, oGam.data()) == 0);
      double rLin = vice::linear_upscale(lr.data(), 16, 16, 3, 2, oLin.data(), 4);
      CHECK(rLin >= 0.0 && rLin < 1e-5);
      // K3: RGB exact sums on the linear path output.
      bool exact = true;
      for (int by = 0; by < 16 && exact; by++)
        for (int bx = 0; bx < 16 && exact; bx++)
          for (int c = 0; c < 3 && exact; c++) {
            long sum = 0;
            for (int dy = 0; dy < 2; dy++)
              for (int dx = 0; dx < 2; dx++)
                sum += oLin[((size_t)(by * 2 + dy) * 32 + bx * 2 + dx) * 3 + c];
            if (sum != 4L * lr[((size_t)by * 16 + bx) * 3 + c]) exact = false;
          }
      CHECK(exact);
      double pG = lin_psnr(to_linear(oGam), truth), pL = lin_psnr(to_linear(oLin), truth);
      std::printf("info: h9-%s linear-psnr gamma=%.2f linear=%.2f\n", zone ? "zoneplate" : "texture",
                  pG, pL);
      CHECK(pL >= pG - 0.05);
    }
  }

  // H10 JPEG block handling: detect both sides, strict boundary win on
  // synthetic blocks, clean-identity, cap, envelope. Kill criteria: K1 the
  // present-gate keeps clean content byte-identical; K2 boundary energy
  // strictly down + PSNR non-regression on synthetic-JPEG; failure kills.
  {
    // Smooth 32x32 truth; LR pairs: clean box means vs block-flattened
    // (each 8x8 LR block snapped 75% toward its mean — DC-coarse JPEG).
    std::vector<double> truth(1024, 0.0);
    for (int y = 0; y < 32; y++)
      for (int x = 0; x < 32; x++)
        truth[(size_t)y * 32 + x] = 30.0 + 180.0 * (x + y) / 62.0;
    auto lrClean = vice::box_downsample(truth, 32, 32, 2);
    std::vector<double> lrBlock = lrClean;
    for (int by = 0; by < 2; by++)
      for (int bx = 0; bx < 2; bx++) {
        double m = 0.0;
        for (int dy = 0; dy < 8; dy++)
          for (int dx = 0; dx < 8; dx++) m += lrClean[(size_t)(by * 8 + dy) * 16 + bx * 8 + dx];
        m /= 64.0;
        for (int dy = 0; dy < 8; dy++)
          for (int dx = 0; dx < 8; dx++) {
            size_t i = (size_t)(by * 8 + dy) * 16 + bx * 8 + dx;
            lrBlock[i] = m + (lrClean[i] - m) * 0.25;
          }
      }
    auto aClean = vice::analyze_artifacts(lrClean, 16, 16);
    auto aBlock = vice::analyze_artifacts(lrBlock, 16, 16);
    std::printf("info: h10 ratios clean=%.3f/%.3f blocky=%.3f/%.3f strength=%.3f\n",
                aClean.block_ratio_h, aClean.block_ratio_v, aBlock.block_ratio_h,
                aBlock.block_ratio_v, aBlock.jpeg_strength);
    CHECK(!aClean.jpeg_present);
    CHECK(aBlock.jpeg_present);
    CHECK(aBlock.jpeg_strength > 0.0);
    vice::DeblockParams db{0.1, 0.5};
    auto bnd_energy = [](const std::vector<double>& rec) {
      double e = 0.0;  // HR adjacent pairs straddling multiples of 16
      for (int y = 0; y < 32; y++)
        for (int xx = 1; xx < 32; xx++) {
          if (xx % 16 == 0) {
            double d = rec[(size_t)y * 32 + xx] - rec[(size_t)y * 32 + xx - 1];
            e += d * d;
          }
        }
      for (int y = 1; y < 32; y++)
        for (int xx = 0; xx < 32; xx++) {
          if (y % 16 == 0) {
            double d = rec[(size_t)y * 32 + xx] - rec[(size_t)(y - 1) * 32 + xx];
            e += d * d;
          }
        }
      return e;
    };
    auto rBase = vice::reconstruct_ibp(lrBlock, 16, 16, 2, 4);
    auto rDb = vice::reconstruct_ibp(lrBlock, 16, 16, 2, 4, nullptr, nullptr, &db);
    double eB = bnd_energy(rBase.x), eD = bnd_energy(rDb.x);
    std::printf("info: h10 boundary energy base=%.1f deblocked=%.1f\n", eB, eD);
    CHECK(eD < eB);
    double pB = psnr(truth, rBase.x), pD = psnr(truth, rDb.x);
    std::printf("info: h10 psnr base=%.2f deblocked=%.2f\n", pB, pD);
    CHECK(pD >= pB - 0.05);
    // K1: gate shut on clean content → bit-identical bytes of floats.
    auto cBase = vice::reconstruct_ibp(lrClean, 16, 16, 2, 4);
    auto cDb = vice::reconstruct_ibp(lrClean, 16, 16, 2, 4, nullptr, nullptr, &db);
    CHECK(cDb.x == cBase.x);
    // Cap: adversarial strength/eta on a max-laplacian checkerboard.
    std::vector<double> chk(1024, 0.0);
    for (int y = 0; y < 32; y++)
      for (int x = 0; x < 32; x++) chk[(size_t)y * 32 + x] = ((x + y) & 1) ? 0.0 : 255.0;
    vice::DeblockParams huge{10.0, 0.5};
    auto cc = vice::deblock_correction(chk, 32, 32, 2, 1.0, huge);
    double worst = 0.0;
    for (double v : cc) worst = std::max(worst, std::fabs(v));
    CHECK(worst <= 0.5 + 1e-12);
      // Envelope on the deblocked run.
    for (size_t i = 1; i < rDb.residuals.size(); i++)
      CHECK(rDb.residuals[i] <= rDb.residuals[i - 1] + 1e-9);
    CHECK(rDb.residuals.back() < 1e-5);

    // Phase detection test on offset block grid (phase_x = 3, phase_y = 5).
    {
      const int W_off = 24, H_off = 24;
      std::vector<double> lrOff((size_t)W_off * H_off, 128.0);
      for (int y = 0; y < H_off; y++) {
        for (int x = 0; x < W_off; x++) {
          int bx = (x - 3 + 16) / 8;
          int by = (y - 5 + 16) / 8;
          lrOff[(size_t)y * W_off + x] = 50.0 + 35.0 * bx + 45.0 * by + 0.5 * (x + y);
        }
      }
      auto aOff = vice::analyze_artifacts(lrOff, W_off, H_off);
      std::printf("info: h10-offset detected phase=(%d,%d) ratios=(%.2f,%.2f)\n",
                  aOff.phase_x, aOff.phase_y, aOff.block_ratio_h, aOff.block_ratio_v);
      CHECK(aOff.jpeg_present);
      CHECK(aOff.phase_x == 3);
      CHECK(aOff.phase_y == 5);
      auto rBaseOff = vice::reconstruct_ibp(lrOff, W_off, H_off, 2, 4);
      auto rDbOff = vice::reconstruct_ibp(lrOff, W_off, H_off, 2, 4, nullptr, nullptr, &db);
      auto bnd_energy_off = [&](const std::vector<double>& rec) {
        double e = 0.0;
        const int s = 2, ow = W_off * s, oh = H_off * s;
        const int per = 8 * s;
        for (int y = 0; y < oh; y++)
          for (int xx = 1; xx < ow; xx++) {
            if (((xx - 3 * s) % per + per) % per == 0) {
              double d = rec[(size_t)y * ow + xx] - rec[(size_t)y * ow + xx - 1];
              e += d * d;
            }
          }
        for (int y = 1; y < oh; y++)
          for (int xx = 0; xx < ow; xx++) {
            if (((y - 5 * s) % per + per) % per == 0) {
              double d = rec[(size_t)y * ow + xx] - rec[(size_t)(y - 1) * ow + xx];
              e += d * d;
            }
          }
        return e;
      };
      double eBOff = bnd_energy_off(rBaseOff.x), eDOff = bnd_energy_off(rDbOff.x);
      std::printf("info: h10-offset boundary energy base=%.1f deblocked=%.1f\n", eBOff, eDOff);
      CHECK(eDOff < eBOff);
    }

    // Product path vice_upscale: exact block sums on blocky input,
    // plus scale 4 progressive staging with deblock.
    {
      std::vector<unsigned char> lrBytes(256);
      for (size_t i = 0; i < 256; i++) lrBytes[i] = (unsigned char)(lrBlock[i] + 0.5);
      std::vector<unsigned char> out2(32 * 32), out4(64 * 64);
      CHECK(vice_upscale(lrBytes.data(), 16, 16, 1, 2, out2.data()) == 0);
      CHECK(vice_last_residual() < 1e-5);
      bool exact2 = true;
      for (int by = 0; by < 16 && exact2; by++)
        for (int bx = 0; bx < 16 && exact2; bx++) {
          long s = 0;
          for (int dy = 0; dy < 2; dy++)
            for (int dx = 0; dx < 2; dx++)
              s += out2[(size_t)(by * 2 + dy) * 32 + bx * 2 + dx];
          if (s != 4L * lrBytes[(size_t)by * 16 + bx]) exact2 = false;
        }
      CHECK(exact2);

      CHECK(vice_upscale(lrBytes.data(), 16, 16, 1, 4, out4.data()) == 0);
      CHECK(vice_last_residual() < 1e-5);
      bool exact4 = true;
      for (int by = 0; by < 16 && exact4; by++)
        for (int bx = 0; bx < 16 && exact4; bx++) {
          long s = 0;
          for (int dy = 0; dy < 4; dy++)
            for (int dx = 0; dx < 4; dx++)
              s += out4[(size_t)(by * 4 + dy) * 64 + bx * 4 + dx];
          if (s != 16L * lrBytes[(size_t)by * 16 + bx]) exact4 = false;
        }
      CHECK(exact4);
    }
  }

  std::printf(failures == 0 ? "ALL PASS\n" : "FAILURES=%d\n", failures);
  return failures == 0 ? 0 : 1;
}
