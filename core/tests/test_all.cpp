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

int main() {
  test_project_exact();
  test_scales();
  test_ctx_roundtrip();
  test_color_roundtrip();
  test_metrics();
  printf("ALL PASS\n");
  return 0;
}
