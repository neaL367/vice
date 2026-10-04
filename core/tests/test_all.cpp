// No-dep native tests: covers spec sec 10 unit gates.
#include "vice.h"
#include "vice_metrics.h"
#include "miniz.h"
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>
// C++-linkage checksum helpers defined in core/src/png.cpp.
uint32_t vice_crc32(const unsigned char* d, size_t n);

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

static void test_stream_options() {
  // Guards: bad dims and absurd band sizes are rejected.
  CHECK(vice_stream_create(0, 48, 2, 4, 16) == nullptr);
  CHECK(vice_stream_create(32, 48, 5, 4, 16) == nullptr);
  CHECK(vice_stream_create(32, 48, 2, 2, 16) == nullptr);
  CHECK(vice_stream_create(200000, 200000, 2, 4, 16) == nullptr);

  // Stream push and pull: valid band output produced.
  {
    vice_stream_ctx* sctx = vice_stream_create(16, 16, 2, 3, 16);
    CHECK(sctx != nullptr);
    std::vector<float> chunk(16 * 16 * 3, 0.4f);
    CHECK(vice_stream_push_input_rows(sctx, chunk.data(), 16) == 0);
    std::vector<unsigned char> band(16 * 32 * 3);
    int rows = 0;
    CHECK(vice_stream_pull_band(sctx, band.data(), &rows) >= 0);
    CHECK(rows > 0);
    vice_stream_destroy(sctx);
  }

  // ICC finish: stored profile lands in the PNG as iCCP.
  {
    vice_stream_ctx* sctx = vice_stream_create(8, 8, 2, 4, 16);
    CHECK(sctx != nullptr);
    const unsigned char fake[] = {1, 2, 3, 4, 5, 6, 7, 8};
    CHECK(vice_stream_set_icc_profile(sctx, fake, sizeof(fake)) == 0);
    CHECK(vice_stream_set_icc_profile(sctx, nullptr, 0) == 0); // clear ok
    CHECK(vice_stream_set_icc_profile(sctx, fake, sizeof(fake)) == 0);
    std::vector<float> chunk(8 * 8 * 4, 0.5f);
    CHECK(vice_stream_push_input_rows(sctx, chunk.data(), 8) == 0);
    std::vector<unsigned char> rgba(16 * 16 * 4);
    std::vector<unsigned char> band(16 * 16 * 4);
    int got = 0;
    while (got < 16) {
      int rows = 0;
      int rc = vice_stream_pull_band(sctx, band.data(), &rows);
      CHECK(rc >= 0 && rows > 0);
      std::memcpy(rgba.data() + (size_t)got * 16 * 4, band.data(), (size_t)rows * 16 * 4);
      got += rows;
    }
    std::vector<unsigned char> cap(16 * 16 * 4 + 1024 * 1024);
    size_t written = 0;
    CHECK(vice_stream_finish_png(sctx, rgba.data(), (int)rgba.size(), cap.data(), cap.size(), &written) == 0);
    CHECK(written > 8 && cap[0] == 137 && cap[1] == 80);
    CHECK(vice_stream_last_residual(sctx) < 1e-5);
    bool found = false;
    for (size_t i = 0; i + 4 <= written; i++)
      if (cap[i] == 'i' && cap[i + 1] == 'C' && cap[i + 2] == 'C' && cap[i + 3] == 'P') { found = true; break; }
    CHECK(found);
    // Wrong row count is rejected.
    CHECK(vice_stream_finish_png(sctx, rgba.data(), 10, cap.data(), cap.size(), &written) != 0);
    vice_stream_destroy(sctx);
  }
  printf("stream_options ok\n");
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

// --- Infinite-export PNG plumbing -------------------------------------------
// Minimal strict PNG decoder for tests: verifies signature, chunk CRCs, IHDR,
// inflates the concatenated IDAT zlib stream (adler-checked by miniz), and
// reverses all 5 filters. Returns false on any structural defect.
static uint32_t rd32(const unsigned char* p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

static bool decode_png_rows(const std::vector<unsigned char>& png, int* w, int* h,
                            int* ch, std::vector<unsigned char>& px, bool* has_iccp) {
  if (png.size() < 8) return false;
  static const unsigned char sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
  if (std::memcmp(png.data(), sig, 8) != 0) return false;
  size_t pos = 8;
  int W = 0, H = 0, C = 0;
  bool iccp = false, seen_ihdr = false, seen_iend = false;
  std::vector<unsigned char> idat;
  auto chunk_ok = [&](const char* type, const unsigned char* d, size_t n) -> bool {
    if (std::memcmp(type, "IHDR", 4) == 0) {
      if (n != 13 || seen_ihdr) return false;
      W = (int)rd32(d);
      H = (int)rd32(d + 4);
      if (W <= 0 || H <= 0 || d[8] != 8) return false;
      if (d[9] == 2) C = 3;
      else if (d[9] == 6) C = 4;
      else return false;
      if (d[10] != 0 || d[11] != 0 || d[12] != 0) return false;
      seen_ihdr = true;
    } else if (std::memcmp(type, "iCCP", 4) == 0) {
      iccp = true;
    } else if (std::memcmp(type, "IDAT", 4) == 0) {
      if (!seen_ihdr || seen_iend) return false;
      idat.insert(idat.end(), d, d + n);
    } else if (std::memcmp(type, "IEND", 4) == 0) {
      if (n != 0) return false;
      seen_iend = true;
    }
    return true;
  };
  while (pos + 8 <= png.size()) {
    uint32_t n = rd32(png.data() + pos);
    if (n > 16u * 1024u * 1024u) return false;
    if (pos + 12 + n > png.size()) return false;
    const char* type = (const char*)png.data() + pos + 4;
    const unsigned char* d = png.data() + pos + 8;
    uint32_t want = vice_crc32((const unsigned char*)type, 4 + n);
    if (rd32(png.data() + pos + 8 + n) != want) return false;
    if (!chunk_ok(type, d, n)) return false;
    pos += 12 + n;
    if (seen_iend) break;
  }
  if (!seen_ihdr || !seen_iend || pos != png.size() || idat.empty()) return false;
  size_t stride = (size_t)W * C;
  std::vector<unsigned char> raw((stride + 1) * (size_t)H);
  mz_ulong rawlen = (mz_ulong)raw.size();
  CHECK(idat.size() <= (size_t)0xffffffffu);
  if (mz_uncompress(raw.data(), &rawlen, idat.data(), (mz_ulong)idat.size()) != MZ_OK)
    return false;
  if (rawlen != raw.size()) return false;
  px.resize(stride * (size_t)H);
  std::vector<unsigned char> prev(stride, 0), cur(stride, 0);
  for (int y = 0; y < H; y++) {
    const unsigned char* frow = raw.data() + (size_t)y * (stride + 1);
    int f = frow[0];
    if (f < 0 || f > 4) return false;
    for (size_t i = 0; i < stride; i++) {
      int a = i >= (size_t)C ? cur[i - C] : 0;
      int b = prev[i];
      int cc = i >= (size_t)C ? prev[i - C] : 0;
      int pred = 0;
      if (f == 1) pred = a;
      else if (f == 2) pred = b;
      else if (f == 3) pred = (a + b) >> 1;
      else if (f == 4) {
        int p = a + b - cc, pa = std::abs(p - a), pb = std::abs(p - b), pc = std::abs(p - cc);
        pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cc);
      }
      cur[i] = (unsigned char)(frow[1 + i] + pred);
    }
    std::memcpy(px.data() + (size_t)y * stride, cur.data(), stride);
    prev = cur;
  }
  *w = W;
  *h = H;
  *ch = C;
  if (has_iccp) *has_iccp = iccp;
  return true;
}

static void test_png_stream_decode_equiv() {
  // Odd row splits + tiny drain caps; decoded pixels must equal the input,
  // IHDR/iCCP must survive, and multi-IDAT output is exercised by the caps.
  for (int trial = 0; trial < 2; trial++) {
    int W = 37, H = 23;
    int in_ch = 4, out_ch = (trial == 0) ? 3 : 4;
    std::vector<unsigned char> img((size_t)W * H * 4);
    for (int y = 0; y < H; y++)
      for (int x = 0; x < W; x++) {
        size_t i = ((size_t)y * W + x) * 4;
        img[i + 0] = (unsigned char)((x * 37 + y * 91) & 255);
        img[i + 1] = (unsigned char)((x * 11 + y * 57 + 40) & 255);
        img[i + 2] = (unsigned char)((x * 5 + y * 131 + 90) & 255);
        img[i + 3] = (trial == 0) ? 255 : (unsigned char)((x < 20) ? 255 : (y * 10) & 255);
      }
    const unsigned char icc[] = {9, 8, 7, 6, 5, 'X'};
    vice_png_stream* st = vice_png_open(W, H, in_ch, out_ch, icc, sizeof(icc));
    CHECK(st != nullptr);
    std::vector<unsigned char> png;
    std::vector<unsigned char> piece(997); // prime cap: splits chunks arbitrarily
    auto drain_all = [&]() {
      for (;;) {
        size_t got = 0;
        CHECK(vice_png_drain(st, piece.data(), piece.size(), &got) == 0);
        if (!got) break;
        png.insert(png.end(), piece.data(), piece.data() + got);
      }
    };
    drain_all(); // header must already be drainable before any rows
    CHECK(!png.empty() && png[0] == 137);
    int fed = 0;
    int splits[] = {1, 5, 2, 7, 3};
    for (int k = 0; fed < H; k++) {
      int s = splits[k % 5];
      int n = (fed + s <= H) ? s : H - fed;
      CHECK(vice_png_write_rows(st, img.data() + (size_t)fed * W * 4, n) == 0);
      fed += n;
      drain_all();
    }
    CHECK(fed == H);
    CHECK(vice_png_close(st) == 0);
    CHECK(vice_png_close(st) == 0); // idempotent
    CHECK(vice_png_write_rows(st, img.data(), 1) != 0); // frozen after close
    drain_all();
    CHECK(vice_png_peak_pending(st) < 1u << 20);
    vice_png_destroy(st);
    int dW = 0, dH = 0, dC = 0;
    bool iccp = false;
    std::vector<unsigned char> px;
    CHECK(decode_png_rows(png, &dW, &dH, &dC, px, &iccp));
    CHECK(dW == W && dH == H && dC == out_ch && iccp);
    for (int y = 0; y < H; y++)
      for (int x = 0; x < W; x++)
        for (int c = 0; c < out_ch; c++) {
          unsigned char want = img[((size_t)y * W + x) * 4 + c];
          unsigned char got = px[((size_t)y * W + x) * (size_t)out_ch + c];
          CHECK(want == got);
        }
    printf("png_stream_decode_equiv trial=%d bytes=%zu\n", trial, png.size());
  }
}

static void test_png_stream_misuse() {
  CHECK(vice_png_open(0, 10, 4, 4, nullptr, 0) == nullptr);
  CHECK(vice_png_open(10, 10, 2, 2, nullptr, 0) == nullptr);
  CHECK(vice_png_open(10, 10, 3, 4, nullptr, 0) == nullptr);
  CHECK(vice_png_open(200000, 10, 4, 4, nullptr, 0) == nullptr);
  vice_png_stream* st = vice_png_open(8, 4, 4, 4, nullptr, 0);
  CHECK(st != nullptr);
  std::vector<unsigned char> rows((size_t)8 * 4 * 4, 128);
  CHECK(vice_png_write_rows(st, rows.data(), 0) != 0);
  CHECK(vice_png_write_rows(st, nullptr, 1) != 0);
  CHECK(vice_png_write_rows(st, rows.data(), 2) == 0);
  CHECK(vice_png_write_rows(st, rows.data(), 3) != 0); // overrun
  CHECK(vice_png_close(st) != 0); // incomplete
  CHECK(vice_png_write_rows(st, rows.data(), 2) == 0);
  CHECK(vice_png_close(st) == 0);
  size_t got = 0;
  unsigned char tmp[64];
  CHECK(vice_png_drain(nullptr, tmp, sizeof(tmp), &got) != 0);
  CHECK(vice_png_drain(st, nullptr, sizeof(tmp), &got) != 0);
  CHECK(vice_png_peak_pending(nullptr) == 0);
  vice_png_destroy(st);
  printf("png_stream_misuse ok\n");
}

// 500 MP through the writer with a fixed drain cadence: peak retained bytes
// must stay flat while every chunk CRC, the zlib adler, and sampled rows
// verify. Decodes the IDAT stream incrementally (no full-image buffer).
static void test_png_stream_soak() {
  const int W = 25000, H = 20000; // 500 MP
  const int C = 3;
  vice_png_stream* st = vice_png_open(W, H, C, C, nullptr, 0);
  CHECK(st != nullptr);
  std::vector<unsigned char> band(64 * (size_t)W * C);
  std::vector<unsigned char> piece(1u << 20);
  std::vector<unsigned char> idat;
  idat.reserve(64u << 20);
  bool seen_sig = false, seen_ihdr = false;
  std::vector<unsigned char> carry; // unparsed drained bytes across calls
  auto feed_drained = [&]() {
    for (;;) {
      size_t got = 0;
      CHECK(vice_png_drain(st, piece.data(), piece.size(), &got) == 0);
      if (!got) break;
      carry.insert(carry.end(), piece.data(), piece.data() + got);
      if (!seen_sig) {
        CHECK(carry.size() >= 8);
        CHECK(carry[0] == 137 && carry[1] == 80);
        seen_sig = true;
      }
      size_t cursor = 0;
      if (!seen_ihdr && carry.size() >= 8u + 25u) {
        // sig(8) + IHDR chunk(25)
        CHECK(rd32(carry.data() + 8) == 13);
        CHECK(std::memcmp(carry.data() + 12, "IHDR", 4) == 0);
        CHECK((int)rd32(carry.data() + 16) == W);
        CHECK((int)rd32(carry.data() + 20) == H);
        seen_ihdr = true;
        cursor = 8 + 25;
      } else if (seen_ihdr) {
        cursor = 0;
      } else {
        continue;
      }
      while (seen_ihdr && carry.size() - cursor >= 12) {
        uint32_t nn = rd32(carry.data() + cursor);
        if (carry.size() - cursor < 12u + nn) break;
        const char* type = (const char*)carry.data() + cursor + 4;
        uint32_t want = vice_crc32((const unsigned char*)type, 4 + nn);
        CHECK(rd32(carry.data() + cursor + 8 + nn) == want);
        if (std::memcmp(type, "IDAT", 4) == 0) {
          idat.insert(idat.end(), carry.data() + cursor + 8,
                      carry.data() + cursor + 8 + nn);
        } else if (std::memcmp(type, "IEND", 4) == 0) {
          CHECK(nn == 0);
        }
        cursor += 12 + nn;
      }
      if (cursor > 0) carry.erase(carry.begin(), carry.begin() + (ptrdiff_t)cursor);
    }
  };
  for (int y0 = 0; y0 < H; y0 += 64) {
    int n = (H - y0 < 64) ? H - y0 : 64;
    for (int r = 0; r < n; r++)
      for (int x = 0; x < W; x++) {
        size_t i = ((size_t)r * W + x) * C;
        band[i + 0] = (unsigned char)((x + y0 + r) & 255);
        band[i + 1] = (unsigned char)(((x * 3 + y0 + r) >> 2) & 255);
        band[i + 2] = (unsigned char)(((y0 + r) * 7 + x) & 255);
      }
    CHECK(vice_png_write_rows(st, band.data(), n) == 0);
    feed_drained();
    CHECK(vice_png_peak_pending(st) < 1u << 20);
  }
  CHECK(vice_png_close(st) == 0);
  feed_drained();
  CHECK(vice_png_peak_pending(st) < 1u << 20);
  CHECK(seen_sig && seen_ihdr);
  vice_png_destroy(st);
  // Incremental inflate of the full IDAT stream: verify row count, sampled
  // rows, and (via miniz) the zlib adler; no full-frame allocation.
  mz_stream zs{};
  CHECK(mz_inflateInit(&zs) == MZ_OK);
  size_t stride = (size_t)W * C;
  std::vector<unsigned char> ibuf(1u << 20);
  std::vector<unsigned char> rowbuf(stride + 1);
  std::vector<unsigned char> prev(stride, 0), cur(stride, 0);
  size_t in_pos = 0, row_fill = 0, rows_done = 0;
  auto check_row = [&](int y) {
    if (y != 0 && y != H / 2 && y != H - 1) return;
    for (int x = 0; x < 16; x++) {
      unsigned char e0 = (unsigned char)((x + y) & 255);
      unsigned char e1 = (unsigned char)(((x * 3 + y) >> 2) & 255);
      unsigned char e2 = (unsigned char)((y * 7 + x) & 255);
      CHECK(cur[(size_t)x * C + 0] == e0);
      CHECK(cur[(size_t)x * C + 1] == e1);
      CHECK(cur[(size_t)x * C + 2] == e2);
    }
  };
  bool stream_end = false;
  while (!stream_end) {
    if (zs.avail_in == 0 && in_pos < idat.size()) {
      size_t take = idat.size() - in_pos > ibuf.size() ? ibuf.size() : idat.size() - in_pos;
      std::memcpy(ibuf.data(), idat.data() + in_pos, take);
      in_pos += take;
      zs.next_in = ibuf.data();
      zs.avail_in = (unsigned int)take;
    }
    zs.next_out = rowbuf.data() + row_fill;
    zs.avail_out = (unsigned int)(rowbuf.size() - row_fill);
    int rc = mz_inflate(&zs, MZ_NO_FLUSH);
    size_t produced = rowbuf.size() - row_fill - zs.avail_out;
    row_fill += produced;
    if (rc == MZ_STREAM_END) stream_end = true;
    else CHECK(rc == MZ_OK || rc == MZ_BUF_ERROR);
    while (row_fill == rowbuf.size()) {
      int f = rowbuf[0];
      CHECK(f >= 0 && f <= 4);
      for (size_t i = 0; i < stride; i++) {
        int a = i >= (size_t)C ? cur[i - C] : 0;
        int b = prev[i];
        int cc = i >= (size_t)C ? prev[i - C] : 0;
        int pred = 0;
        if (f == 1) pred = a;
        else if (f == 2) pred = b;
        else if (f == 3) pred = (a + b) >> 1;
        else if (f == 4) {
          int p = a + b - cc, pa = std::abs(p - a), pb = std::abs(p - b),
              pc = std::abs(p - cc);
          pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cc);
        }
        cur[i] = (unsigned char)(rowbuf[1 + i] + pred);
      }
      check_row((int)rows_done);
      rows_done++;
      prev = cur;
      row_fill = 0;
      zs.next_out = rowbuf.data();
      zs.avail_out = (unsigned int)rowbuf.size();
      if (rows_done > (size_t)H) break;
    }
    if (rows_done > (size_t)H) break;
  }
  mz_inflateEnd(&zs);
  CHECK(rows_done == (size_t)H);
  CHECK(in_pos == idat.size());
  printf("png_stream_soak 500MP rows=%zu idat=%zuMB\n", rows_done,
         idat.size() >> 20);
}

static std::vector<unsigned char> render_stream_rows(int in_w, int in_h, int scale,
                                                     int ch, int band_h, int fused,
                                                     const std::vector<float>& input,
                                                     double* residual) {
  vice_stream_ctx* sctx = vice_stream_create(in_w, in_h, scale, ch, band_h);
  CHECK(sctx != nullptr);
  if (fused) CHECK(vice_stream_set_fused(sctx, fused) == 0);
  int out_w = in_w * scale, out_h = in_h * scale;
  const int PUSH = 16;
  int pushed = 0, emitted = 0;
  std::vector<unsigned char> band((size_t)band_h * out_w * ch);
  std::vector<unsigned char> out((size_t)out_w * out_h * ch);
  while (emitted < out_h) {
    while (pushed < in_h && !vice_stream_has_next_band(sctx)) {
      int n = (in_h - pushed < PUSH) ? in_h - pushed : PUSH;
      CHECK(vice_stream_push_input_rows(
                sctx, input.data() + (size_t)pushed * in_w * ch, n) == 0);
      pushed += n;
    }
    CHECK(vice_stream_has_next_band(sctx) == 1);
    int rows = 0;
    int rc = vice_stream_pull_band(sctx, band.data(), &rows);
    CHECK(rc >= 0 && rows > 0);
    std::memcpy(out.data() + (size_t)emitted * out_w * ch, band.data(),
                (size_t)rows * out_w * ch);
    emitted += rows;
  }
  *residual = vice_stream_last_residual(sctx);
  vice_stream_destroy(sctx);
  return out;
}

static void test_stream_seam_bands() {
  // Edge + gradient synthetic: band joints must not exceed interior
  // row-to-row variation, at every band cadence, scales 2 and 4-direct.
  for (int scale : {2, 4}) {
    int in_w = 40, in_h = 40, ch = 4;
    std::vector<float> input((size_t)in_w * in_h * ch);
    for (int y = 0; y < in_h; y++)
      for (int x = 0; x < in_w; x++)
        for (int c = 0; c < ch; c++) {
          float v = (float)(x + y * 2 + c * 7) / (float)(in_w + in_h * 2 + 21);
          if (x >= in_w / 2) v = 1.0f - v * 0.2f; // hard vertical edge
          input[((size_t)y * in_w + x) * ch + c] = v;
        }
    int out_w = in_w * scale, out_h = in_h * scale;
    for (int band : {16, 32, 48, 64}) {
      int bh = ((band + scale - 1) / scale) * scale; // multiple of scale
      double res = 0;
      auto out = render_stream_rows(in_w, in_h, scale, ch, bh, 0, input, &res);
      CHECK(res < 1e-5);
      double interior = 0;
      for (int y = 1; y < out_h; y++) {
        if (y % bh == 0) continue;
        for (int x = 0; x < out_w; x++)
          for (int c = 0; c < ch; c++) {
            double d = std::abs((double)out[((size_t)y * out_w + x) * ch + c] -
                                (double)out[((size_t)(y - 1) * out_w + x) * ch + c]);
            if (d > interior) interior = d;
          }
      }
      for (int y = bh; y < out_h; y += bh)
        for (int x = 0; x < out_w; x++)
          for (int c = 0; c < ch; c++) {
            double d = std::abs((double)out[((size_t)y * out_w + x) * ch + c] -
                                (double)out[((size_t)(y - 1) * out_w + x) * ch + c]);
            CHECK(d <= interior + 1.0);
          }
      printf("seam scale=%d band=%d interior=%.1f\n", scale, bh, interior);
    }
  }
}

static void test_fused4x() {
  CHECK(vice_stream_set_fused(nullptr, 1) != 0);
  int in_w = 24, in_h = 24, ch = 4;
  std::vector<float> input((size_t)in_w * in_h * ch);
  for (size_t i = 0; i < input.size(); i++) input[i] = (float)(i % 251) / 251.0f;
  for (int mode : {1, 2}) {
    double res = 0;
    auto out = render_stream_rows(in_w, in_h, 4, ch, 32, mode, input, &res);
    CHECK((int)out.size() == 96 * 96 * ch);
    printf("fused4x mode=%d residual=%g\n", mode, res);
    CHECK(res < 1e-5);
  }
  // Fused is scale-4 only.
  vice_stream_ctx* sctx = vice_stream_create(16, 16, 2, 4, 16);
  CHECK(sctx != nullptr);
  CHECK(vice_stream_set_fused(sctx, 1) != 0);
  CHECK(vice_stream_set_fused(sctx, 3) != 0);
  vice_stream_destroy(sctx);
  // Fused seam: hard edge must cross the 64-row joint cleanly.
  {
    int fw = 32, fh = 32, fch = 4;
    std::vector<float> edge((size_t)fw * fh * fch);
    for (int y = 0; y < fh; y++)
      for (int x = 0; x < fw; x++)
        for (int c = 0; c < fch; c++)
          edge[((size_t)y * fw + x) * fch + c] =
              (x < fw / 2) ? 0.05f : 0.95f;
    double res = 0;
    auto out = render_stream_rows(fw, fh, 4, fch, 64, 1, edge, &res);
    CHECK(res < 1e-5);
    int oW = fw * 4, oH = fh * 4;
    double interior = 0, joint = 0;
    for (int y = 1; y < oH; y++)
      for (int x = 0; x < oW; x++)
        for (int c = 0; c < fch; c++) {
          double d = std::abs((double)out[((size_t)y * oW + x) * fch + c] -
                              (double)out[((size_t)(y - 1) * oW + x) * fch + c]);
          if (y % 64 == 0) {
            if (d > joint) joint = d;
          } else if (d > interior) {
            interior = d;
          }
        }
    printf("fused seam joint=%.1f interior=%.1f\n", joint, interior);
    CHECK(joint <= interior + 1.0);
  }
  printf("fused4x ok\n");
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
  test_stream_options();
  test_transparency();
  test_saturated_residual();
  test_png_stream_decode_equiv();
  test_png_stream_misuse();
  test_png_stream_soak();
  test_stream_seam_bands();
  test_fused4x();
  printf("ALL PASS\n");
  return 0;
}
