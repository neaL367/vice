// No-dep native tests: covers spec sec 10 unit gates.
#include "vice.h"
#include "vice_metrics.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#define CHECK(cond)                                                 \
  do {                                                              \
    if (!(cond)) {                                                  \
      printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);        \
      std::fflush(stdout);                                          \
      std::abort();                                                 \
    }                                                               \
  } while (0)

static void test_project_exact() {
  int w = 5, h = 4, s = 2, c = 3;
  std::vector<float> y(w * h * c), raw(w * s * h * s * c);
  for (size_t i = 0; i < y.size(); i++) y[i] = (float)(i % 17) / 17.0f;
  for (size_t i = 0; i < raw.size(); i++) raw[i] = (float)(i % 31) / 31.0f;
  vice_project_box(y.data(), raw.data(), w, h, s, c);
  double worst = 0;
  int W = w * s;
  for (int by = 0; by < h; by++)
    for (int bx = 0; bx < w; bx++)
      for (int ch = 0; ch < c; ch++) {
        double sum = 0;
        for (int dy = 0; dy < s; dy++)
          for (int dx = 0; dx < s; dx++)
            sum += raw[((by * s + dy) * W + bx * s + dx) * c + ch];
        double mean = sum / (s * s);
        double e = std::abs(mean - y[(by * w + bx) * c + ch]);
        if (e > worst) worst = e;
      }
  printf("project_exact worst=%g\n", worst);
  CHECK(worst < 1e-5);
}

static void test_scales() {
  for (int s : {2, 3, 4}) {
    int w = 7, h = 5, c = 4;
    std::vector<float> y(w * h * c, 0.5f), raw(w * s * h * s * c, 0.25f);
    vice_project_box(y.data(), raw.data(), w, h, s, c);
    for (float v : raw) CHECK(std::abs(v - 0.5f) < 1e-5);
  }
  printf("scales ok\n");
}

static void test_ctx_roundtrip() {
  vice_ctx* ctx = vice_create(4, 4, 2, 3);
  CHECK(ctx);
  std::vector<float> y(4 * 4 * 3, 0.4f);
  CHECK(vice_set_input(ctx, y.data(), (int)y.size()) == 0);
  std::vector<float> tile(8 * 8 * 3, 0.9f);
  CHECK(vice_submit_raw_tile(ctx, 0, 0, tile.data(), 8, 8, (int)tile.size()) == 0);
  CHECK(vice_project(ctx) == 0);
  double r = vice_last_residual(ctx);
  printf("residual=%g\n", r);
  CHECK(r < 1e-5);
  std::vector<unsigned char> png(10 * 1024 * 1024);
  size_t written = 0;
  CHECK(vice_finish_png(ctx, png.data(), png.size(), &written) == 0);
  CHECK(written > 8);
  CHECK(png[0] == 137 && png[1] == 80); // PNG sig
  printf("png bytes=%zu\n", written);
  vice_destroy(ctx);
}

static void test_icc_profile() {
  vice_ctx* ctx = vice_create(4, 4, 2, 3);
  CHECK(ctx);
  std::vector<float> y(4 * 4 * 3, 0.4f);
  CHECK(vice_set_input(ctx, y.data(), (int)y.size()) == 0);
  const unsigned char dummy_icc[] = {0x00, 0x01, 0x02, 0x03, 'I', 'C', 'C', 'P'};
  CHECK(vice_set_icc_profile(ctx, dummy_icc, sizeof(dummy_icc)) == 0);
  std::vector<unsigned char> png(1024 * 1024);
  size_t written = 0;
  CHECK(vice_finish_png(ctx, png.data(), png.size(), &written) == 0);
  // Search for "iCCP" chunk tag
  bool found_iccp = false;
  for (size_t i = 0; i + 4 <= written; i++) {
    if (png[i] == 'i' && png[i + 1] == 'C' && png[i + 2] == 'C' && png[i + 3] == 'P') {
      found_iccp = true;
      break;
    }
  }
  CHECK(found_iccp);
  printf("icc ok\n");
  vice_destroy(ctx);
}

static void test_color_roundtrip() {
  for (int i = 0; i <= 255; i++) {
    float s = i / 255.0f;
    float lin = vice_srgb_to_linear(s);
    float back = vice_linear_to_srgb(lin);
    CHECK(std::abs(back - s) < 0.002f);
  }
  printf("color ok\n");
}

static void test_metrics() {
  std::vector<float> a(16 * 16 * 3), b(16 * 16 * 3);
  for (size_t i = 0; i < a.size(); i++) {
    a[i] = (float)(i % 11) / 11.0f;
    b[i] = a[i];
  }
  CHECK(vice_psnr(a.data(), b.data(), 16, 16, 3) > 99.0); // identical
  CHECK(std::abs(vice_ssim(a.data(), b.data(), 16, 16, 3) - 1.0) < 1e-9);
  std::vector<float> flat(32 * 32 * 3, 0.4f);
  CHECK(std::abs(vice_seam_ratio(flat.data(), 32, 32, 2, 3) - 1.0) < 1e-9);
  b[0] += 0.1f;
  double p = vice_psnr(a.data(), b.data(), 16, 16, 3);
  CHECK(p > 20.0 && p < 99.0);
  // box downscale of constant stays constant
  std::vector<float> lr(8 * 8 * 3);
  vice_box_downscale(flat.data(), lr.data(), 8, 8, 4, 3);
  for (float v : lr) CHECK(std::abs(v - 0.4f) < 1e-6);
  printf("metrics ok\n");
}

static void test_upscale_lanczos_adaptive() {
  for (int s : {2, 3, 4}) {
    int w = 12, h = 10, c = 4;
    std::vector<float> src(w * h * c);
    for (int y = 0; y < h; ++y) {
      for (int x = 0; x < w; ++x) {
        for (int ch = 0; ch < c; ++ch) {
          src[(y * w + x) * c + ch] = (float)(x + y) / (float)(w + h);
        }
      }
    }
    int out_w = w * s;
    int out_h = h * s;
    std::vector<float> dst(out_w * out_h * c, 0.0f);
    CHECK(vice_upscale_lanczos_adaptive(src.data(), w, h, c, s, dst.data()) == 0);
    vice_project_box(src.data(), dst.data(), w, h, s, c);
    double worst = 0;
    int W = w * s;
    for (int by = 0; by < h; by++)
      for (int bx = 0; bx < w; bx++)
        for (int ch = 0; ch < c; ch++) {
          double sum = 0;
          for (int dy = 0; dy < s; dy++)
            for (int dx = 0; dx < s; dx++)
              sum += dst[((by * s + dy) * W + bx * s + dx) * c + ch];
          double mean = sum / (s * s);
          double e = std::abs(mean - src[(by * w + bx) * c + ch]);
          if (e > worst) worst = e;
        }
    printf("native upscale scale=%d exact_residual=%g\n", s, worst);
    CHECK(worst < 1e-5);

    // Box downscale consistency on ctx
    vice_ctx* ctx = vice_create(w, h, s, c);
    CHECK(ctx);
    CHECK(vice_set_input(ctx, src.data(), (int)src.size()) == 0);
    CHECK(vice_upscale(ctx) == 0);
    CHECK(vice_project(ctx) == 0);
    double r = vice_last_residual(ctx);
    CHECK(r < 0.005);
    vice_destroy(ctx);
  }
  printf("upscale ok\n");
}

static void test_project_smooth() {
  const int w = 24, h = 24, c = 3;
  for (int s = 2; s <= 4; s++) {
    std::vector<float> y((size_t)w * h * c);
    for (int py = 0; py < h; py++)
      for (int px = 0; px < w; px++)
        for (int ch = 0; ch < c; ch++)
          y[((size_t)py * w + px) * c + ch] =
              0.2f + 0.5f * (float)(((px + ch) / 5 + py / 7) % 2) + 0.08f * std::sin(0.9f * px + 0.7f * py);
    const int W = w * s, H = h * s;
    std::vector<float> raw((size_t)W * H * c);
    CHECK(vice_upscale_lanczos_adaptive(y.data(), w, h, c, s, raw.data()) == 0);
    std::vector<float> box = raw, smooth = raw;
    vice_project_box(y.data(), box.data(), w, h, s, c);
    vice_project_smooth(y.data(), smooth.data(), w, h, s, c, VICE_SMOOTH_ITERS);
    vice_project_box(y.data(), smooth.data(), w, h, s, c);
    double worst = 0;
    for (int by = 0; by < h; by++)
      for (int bx = 0; bx < w; bx++)
        for (int ch = 0; ch < c; ch++) {
          double sum = 0;
          for (int dy = 0; dy < s; dy++)
            for (int dx = 0; dx < s; dx++)
              sum += smooth[((size_t)(by * s + dy) * W + bx * s + dx) * c + ch];
          worst = std::max(worst, std::abs(sum / (s * s) - y[((size_t)by * w + bx) * c + ch]));
        }
    double seam_box = vice_seam_ratio(box.data(), W, H, s, c);
    double seam_smooth = vice_seam_ratio(smooth.data(), W, H, s, c);
    printf("project_smooth s=%d worst=%g seam box=%.3f smooth=%.3f\n", s, worst,
           seam_box, seam_smooth);
    CHECK(worst < 1e-5);
    // Tolerance 0.05: smooth+box usually beats box-only, but the margin depends
    // on upscale tuning (sharpness/shock affect input edge energy). Guards against
    // seam explosions, not sub-percent wiggles (shipped defaults: 0.35/0.35).
    CHECK(seam_smooth <= seam_box + 0.05);
  }
}

static void test_project_multigrid() {
  int w = 16, h = 12, s = 2, c = 4;
  int W = w * s, H = h * s;
  std::vector<float> y(w * h * c), raw(W * H * c);
  for (size_t i = 0; i < y.size(); i++) y[i] = (float)(i % 13) / 13.0f;
  for (size_t i = 0; i < raw.size(); i++) raw[i] = (float)(i % 29) / 29.0f;
  vice_project_multigrid(y.data(), raw.data(), w, h, s, c, 2);
  double worst = 0;
  for (int by = 0; by < h; by++) {
    for (int bx = 0; bx < w; bx++) {
      for (int ch = 0; ch < c; ch++) {
        double sum = 0;
        for (int dy = 0; dy < s; dy++)
          for (int dx = 0; dx < s; dx++)
            sum += raw[((size_t)(by * s + dy) * W + bx * s + dx) * c + ch];
        double mean = sum / (s * s);
        worst = std::max(worst, std::abs(mean - y[((size_t)by * w + bx) * c + ch]));
      }
    }
  }
  printf("multigrid worst=%g\n", worst);
  CHECK(worst < 1e-5);
}

static void test_streaming_strip() {
  int in_w = 32, in_h = 48, scale = 2, c = 4, band_h = 16;
  int out_w = in_w * scale, out_h = in_h * scale;
  vice_stream_ctx* sctx = vice_stream_create(in_w, in_h, scale, c, band_h);
  CHECK(sctx != nullptr);

  std::vector<float> chunk(16 * in_w * c, 0.4f);
  CHECK(vice_stream_push_input_rows(sctx, chunk.data(), 16) == 0);
  CHECK(vice_stream_push_input_rows(sctx, chunk.data(), 16) == 0);
  CHECK(vice_stream_push_input_rows(sctx, chunk.data(), 16) == 0);

  int total_emitted = 0;
  std::vector<unsigned char> out_band(band_h * out_w * c);
  while (total_emitted < out_h) {
    CHECK(vice_stream_has_next_band(sctx) == 1);
    int written_rows = 0;
    int res = vice_stream_pull_band(sctx, out_band.data(), &written_rows);
    CHECK(res >= 0);
    CHECK(written_rows > 0);
    total_emitted += written_rows;
  }
  CHECK(total_emitted == out_h);
  vice_stream_destroy(sctx);
  printf("streaming_strip ok total_emitted=%d\n", total_emitted);
}

static void test_transparency() {
  // White at 50% alpha: in linear premultiplied float space:
  // RGB = 1.0 * 0.5 = 0.5, A = 0.5.
  int w = 4, h = 4, scale = 2, c = 4;
  vice_ctx* ctx = vice_create(w, h, scale, c);
  CHECK(ctx != nullptr);
  std::vector<float> y((size_t)w * h * c);
  for (size_t i = 0; i < (size_t)w * h; ++i) {
    y[i * 4 + 0] = 0.5f;
    y[i * 4 + 1] = 0.5f;
    y[i * 4 + 2] = 0.5f;
    y[i * 4 + 3] = 0.5f;
  }
  CHECK(vice_set_input(ctx, y.data(), (int)y.size()) == 0);
  CHECK(vice_upscale(ctx) == 0);
  CHECK(vice_project(ctx) == 0);

  int out_w = w * scale;
  std::vector<unsigned char> rows((size_t)64 * out_w * c);
  int row_count = 0;
  CHECK(vice_process_band(ctx, 0, rows.data(), &row_count) == 0);
  CHECK(row_count == h * scale);

  // Check that white un-premultiplies back to ~255 and alpha is linearly ~128
  for (int i = 0; i < out_w * (h * scale); ++i) {
    unsigned char r = rows[i * 4 + 0];
    unsigned char g = rows[i * 4 + 1];
    unsigned char b = rows[i * 4 + 2];
    unsigned char a = rows[i * 4 + 3];
    CHECK(r >= 254 && r <= 255);
    CHECK(g >= 254 && g <= 255);
    CHECK(b >= 254 && b <= 255);
    CHECK(a >= 127 && a <= 128);
  }
  vice_destroy(ctx);
  printf("transparency ok\n");
}

static void test_saturated_residual() {
  // Test image with pure black and fully saturated colors
  int w = 8, h = 8, scale = 2, c = 3;
  vice_ctx* ctx = vice_create(w, h, scale, c);
  CHECK(ctx != nullptr);
  std::vector<float> y((size_t)w * h * c);
  for (int py = 0; py < h; ++py) {
    for (int px = 0; px < w; ++px) {
      size_t idx = ((size_t)py * w + px) * c;
      if (py < 4) {
        // Pure black and pure saturated primaries
        y[idx + 0] = (px % 2 == 0) ? 0.0f : 1.0f;
        y[idx + 1] = (px % 3 == 0) ? 0.0f : 1.0f;
        y[idx + 2] = (px % 4 == 0) ? 0.0f : 1.0f;
      } else {
        // High contrast saturated edges
        y[idx + 0] = (px < 4) ? 0.0f : 1.0f;
        y[idx + 1] = (px < 4) ? 1.0f : 0.0f;
        y[idx + 2] = (px < 4) ? 0.0f : 1.0f;
      }
    }
  }
  CHECK(vice_set_input(ctx, y.data(), (int)y.size()) == 0);
  CHECK(vice_upscale(ctx) == 0);
  CHECK(vice_project(ctx) == 0);
  double r = vice_last_residual(ctx);
  printf("saturated content residual=%g\n", r);
  CHECK(r <= 1.1e-7);
  vice_destroy(ctx);
  printf("saturated residual ok\n");
}

int main() {
  test_project_exact();
  test_scales();
  test_ctx_roundtrip();
  test_icc_profile();
  test_color_roundtrip();
  test_metrics();
  test_upscale_lanczos_adaptive();
  test_project_smooth();
  test_project_multigrid();
  test_streaming_strip();
  test_transparency();
  test_saturated_residual();
  printf("ALL PASS\n");
  return 0;
}
