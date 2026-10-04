// vice_bench4x: 4x policy comparison (not a gate; prints a table).
// Policies: A full direct 4x | B full chained 2x2 clean (shipped default)
//           C stream direct | D stream fused clean | E stream fused detail.
// Reference for PSNR/SSIM: B. All policies must hold residual < 1e-5.
//
// Measured verdict (Set5/BSD100/Urban100 SRF_4 + procedural edge): all five
// policies land within ~1dB of each other against HR ground truth; D tracks
// B at 39-53dB. E (detail) never beats D and costs ~1.7x time, so only
// Clean (fused mode 1) and Direct ship in the UI; mode 2 stays engine-only.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include <chrono>
#include "vice.h"
#include "vice_metrics.h"
#include "stb_image.h"

namespace {
using clock = std::chrono::steady_clock;

float srgb_to_linear_exact(unsigned v) {
  double x = v / 255.0;
  double l = (x <= 0.04045) ? x / 12.92 : std::pow((x + 0.055) / 1.055, 2.4);
  return (float)l;
}

std::vector<float> load_rgb(const char* path, int* w, int* h) {
  int ww = 0, hh = 0, cn = 0;
  unsigned char* px = stbi_load(path, &ww, &hh, &cn, 3);
  if (!px) {
    printf("skip (missing): %s\n", path);
    return {};
  }
  std::vector<float> f((size_t)ww * hh * 3);
  for (size_t i = 0; i < f.size(); i++) f[i] = srgb_to_linear_exact(px[i]);
  stbi_image_free(px);
  *w = ww;
  *h = hh;
  return f;
}

void set_tuning(vice_ctx* ctx, bool clean_second) {
  ViceTuning t;
  vice_tuning_defaults(&t);
  if (clean_second) {
    t.sharpness = 0.0f;
    t.shock = 0.0f;
  }
  if (vice_upscale_ex(ctx, &t) != 0) {
    printf("upscale_ex failed\n");
    std::abort();
  }
}

// Full-image render to float. chained: 2x o 2x with optional clean 2nd pass.
std::vector<float> render_full(const float* in, int w, int h, bool chained,
                               bool clean_second, double* residual, double* ms) {
  auto t0 = clock::now();
  std::vector<float> out;
  if (!chained) {
    vice_ctx* ctx = vice_create(w, h, 4, 3);
    if (!ctx) abort();
    std::vector<float> y(in, in + (size_t)w * h * 3);
    vice_set_input(ctx, y.data(), (int)y.size());
    set_tuning(ctx, false);
    vice_project(ctx);
    *residual = vice_last_residual(ctx);
    out.resize((size_t)w * 4 * h * 4 * 3);
    vice_download_raw(ctx, out.data(), (int)out.size());
    vice_destroy(ctx);
  } else {
    vice_ctx* c1 = vice_create(w, h, 2, 3);
    if (!c1) abort();
    std::vector<float> y(in, in + (size_t)w * h * 3);
    vice_set_input(c1, y.data(), (int)y.size());
    set_tuning(c1, false);
    vice_project(c1);
    std::vector<float> mid((size_t)w * 2 * h * 2 * 3);
    vice_download_raw(c1, mid.data(), (int)mid.size());
    vice_destroy(c1);
    vice_ctx* c2 = vice_create(w * 2, h * 2, 2, 3);
    if (!c2) abort();
    vice_set_input(c2, mid.data(), (int)mid.size());
    set_tuning(c2, clean_second);
    vice_project(c2);
    *residual = vice_last_residual(c2);
    out.resize((size_t)w * 4 * h * 4 * 3);
    vice_download_raw(c2, out.data(), (int)out.size());
    vice_destroy(c2);
  }
  *ms = std::chrono::duration<double, std::milli>(clock::now() - t0).count();
  return out;
}

// Stream render to float (8-bit bands, like the shipped path).
std::vector<float> render_stream(const float* in, int w, int h, int fused,
                                 double* residual, double* ms) {
  auto t0 = clock::now();
  vice_stream_ctx* s = vice_stream_create(w, h, 4, 3, 64);
  if (!s) abort();
  if (fused && vice_stream_set_fused(s, fused) != 0) abort();
  int W = w * 4, H = h * 4;
  int pushed = 0, emitted = 0;
  std::vector<unsigned char> band((size_t)64 * W * 3);
  std::vector<float> out((size_t)W * H * 3);
  while (emitted < H) {
    while (pushed < h && !vice_stream_has_next_band(s)) {
      int n = h - pushed < 16 ? h - pushed : 16;
      vice_stream_push_input_rows(s, in + (size_t)pushed * w * 3, n);
      pushed += n;
    }
    if (!vice_stream_has_next_band(s)) {
      printf("stream stalled\n");
      abort();
    }
    int rows = 0;
    if (vice_stream_pull_band(s, band.data(), &rows) < 0 || rows <= 0) abort();
    for (int r = 0; r < rows; r++)
      for (int x = 0; x < W; x++)
        for (int c = 0; c < 3; c++)
          out[((size_t)(emitted + r) * W + x) * 3 + c] =
              srgb_to_linear_exact(band[((size_t)r * W + x) * 3 + c]);
    emitted += rows;
  }
  *residual = vice_stream_last_residual(s);
  vice_stream_destroy(s);
  *ms = std::chrono::duration<double, std::milli>(clock::now() - t0).count();
  return out;
}

void bench_image(const char* name, const float* in, int w, int h,
                 const float* ref /* W x H ground truth, may be null */) {
  int W = w * 4, H = h * 4;
  printf("\n== %s (%dx%d -> %dx%d) ==\n", name, w, h, W, H);
  printf("%-16s %10s %10s %10s %10s %10s %10s %10s\n", "policy", "ms", "residual",
         "seam", "psnr/ref", "ssim/ref", "psnr/B", "psnr/A");
  double rA = 0, mA = 0, rB = 0, mB = 0, rC = 0, mC = 0, rD = 0, mD = 0, rE = 0,
         mE = 0;
  auto A = render_full(in, w, h, false, false, &rA, &mA);
  auto B = render_full(in, w, h, true, true, &rB, &mB);
  auto C = render_stream(in, w, h, 0, &rC, &mC);
  auto D = render_stream(in, w, h, 1, &rD, &mD);
  auto E = render_stream(in, w, h, 2, &rE, &mE);
  auto row = [&](const char* tag, const std::vector<float>& img, double res, double ms) {
    double psnr_ref = ref ? vice_psnr(img.data(), ref, W, H, 3) : 0;
    double ssim_ref = ref ? vice_ssim(img.data(), ref, W, H, 3) : 0;
    double psnr_b = vice_psnr(img.data(), B.data(), W, H, 3);
    double psnr_a = vice_psnr(img.data(), A.data(), W, H, 3);
    auto pdb = [](double v) { return v > 100 ? 999.0 : v; };
    printf("%-16s %10.0f %10.2g %10.3f %10.2f %10.4f %10.2f %10.2f\n", tag, ms, res,
           vice_seam_ratio(img.data(), W, H, 4, 3), pdb(psnr_ref), ssim_ref,
           pdb(psnr_b), pdb(psnr_a));
  };
  row("A full-direct", A, rA, mA);
  row("B full-chained", B, rB, mB);
  row("C stream-direct", C, rC, mC);
  row("D fused-clean", D, rD, mD);
  row("E fused-detail", E, rE, mE);
  for (double r : {rA, rB, rC, rD, rE})
    if (!(r < 1e-5)) {
      printf("RESIDUAL GATE FAIL\n");
      std::abort();
    }
}
} // namespace

int main(int argc, char** argv) {
  std::string dir = argc > 1 ? argv[1] : "tools/eval/data";
  // Procedural edge case (always runs, no ground truth).
  {
    int w = 192, h = 128;
    std::vector<float> edge((size_t)w * h * 3);
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        float v = (float)(x + y * 2) / (float)(w + h * 2);
        if (x >= w / 2) v = 1.0f - v * 0.2f;
        edge[((size_t)y * w + x) * 3 + 0] = v;
        edge[((size_t)y * w + x) * 3 + 1] = v * 0.7f;
        edge[((size_t)y * w + x) * 3 + 2] = 1.0f - v;
      }
    bench_image("procedural-edge", edge.data(), w, h, nullptr);
  }
  // SRF_4 pairs: upscale LR, score against HR ground truth.
  const struct {
    const char* lr;
    const char* hr;
  } pairs[] = {
      {"Set5/Set5/image_SRF_4/img_001_SRF_4_LR.png",
       "Set5/Set5/image_SRF_4/img_001_SRF_4_HR.png"},
      {"BSD100/BSD100/image_SRF_4/img_001_SRF_4_HR.png", nullptr}, // HR only: box-downscale LR
      {"Urban100/Urban100_HR/img_001.png", nullptr},
  };
  for (const auto& pr : pairs) {
    int w = 0, h = 0, gw = 0, gh = 0;
    auto lr = load_rgb((dir + "/" + pr.lr).c_str(), &w, &h);
    if (lr.empty()) continue;
    std::vector<float> gt;
    if (pr.hr) {
      gt = load_rgb((dir + "/" + pr.hr).c_str(), &gw, &gh);
      if (gt.empty() || gw != w * 4 || gh != h * 4) {
        printf("skip (HR mismatch): %s\n", pr.lr);
        continue;
      }
    } else {
      // No LR pair: synthesize LR from HR with the guarantee-matching box filter.
      std::vector<float> hr = std::move(lr);
      int hw = w, hh = h;
      w = hw / 4;
      h = hh / 4;
      lr.assign((size_t)w * h * 3, 0);
      vice_box_downscale(hr.data(), lr.data(), w, h, 4, 3);
      gt = std::move(hr);
      gw = hw;
      gh = hh;
    }
    bench_image(pr.lr, lr.data(), w, h, gt.data());
  }
  printf("\nBENCH DONE\n");
  return 0;
}
