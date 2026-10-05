// No-dep native tests: covers spec sec 10 unit gates.
#include "vice.h"
#include "vice_metrics.h"
#include "miniz.h"
#include "png_filters.h"
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>
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
  // Tall band (one band = image height): the old "full image" path is just
  // the stream engine with band_h = out_h.
  int w = 4, h = 4, scale = 2, c = 3;
  int out_w = w * scale, out_h = h * scale;
  vice_stream_ctx* sctx = vice_stream_create(w, h, scale, c, out_h);
  CHECK(sctx != nullptr);
  std::vector<float> y((size_t)w * h * c, 0.4f);
  CHECK(vice_stream_push_input_rows(sctx, y.data(), h) == 0);
  CHECK(vice_stream_has_next_band(sctx) == 1);
  std::vector<unsigned char> band((size_t)out_h * out_w * c);
  int rows = 0;
  int rc = vice_stream_pull_band(sctx, band.data(), &rows);
  CHECK(rc == 1 && rows == out_h);
  double r = vice_stream_last_residual(sctx);
  printf("residual=%g\n", r);
  CHECK(r < 1e-5);
  std::vector<unsigned char> png(10 * 1024 * 1024);
  size_t written = 0;
  CHECK(vice_stream_finish_png(sctx, band.data(), (int)band.size(), png.data(), png.size(),
                              &written) == 0);
  CHECK(written > 8);
  CHECK(png[0] == 137 && png[1] == 80); // PNG sig
  printf("png bytes=%zu\n", written);
  vice_stream_destroy(sctx);
}

static void test_icc_profile() {
  int w = 4, h = 4, scale = 2, c = 3;
  int out_w = w * scale, out_h = h * scale;
  vice_stream_ctx* sctx = vice_stream_create(w, h, scale, c, out_h);
  CHECK(sctx != nullptr);
  std::vector<float> y((size_t)w * h * c, 0.4f);
  CHECK(vice_stream_push_input_rows(sctx, y.data(), h) == 0);
  const unsigned char dummy_icc[] = {0x00, 0x01, 0x02, 0x03, 'I', 'C', 'C', 'P'};
  CHECK(vice_stream_set_icc_profile(sctx, dummy_icc, sizeof(dummy_icc)) == 0);
  std::vector<unsigned char> band((size_t)out_h * out_w * c);
  int rows = 0;
  CHECK(vice_stream_pull_band(sctx, band.data(), &rows) == 1);
  CHECK(rows == out_h);
  std::vector<unsigned char> png(1024 * 1024);
  size_t written = 0;
  CHECK(vice_stream_finish_png(sctx, band.data(), (int)band.size(), png.data(), png.size(),
                              &written) == 0);
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
  vice_stream_destroy(sctx);
}

static void test_color_nan_safety() {
  // NaN must map to black, never index the LUT out of bounds.
  const float qnan = std::numeric_limits<float>::quiet_NaN();
  CHECK(vice_fast_linear_to_srgb(qnan) == 0.0f);
  CHECK(vice_fast_srgb_to_linear(qnan) == 0.0f);
  CHECK(vice_linear_to_srgb(qnan) == 0.0f);
  CHECK(vice_srgb_to_linear(qnan) == 0.0f);
  // Non-NaN behavior unchanged at the rails.
  CHECK(vice_fast_linear_to_srgb(0.0f) == 0.0f);
  CHECK(vice_fast_linear_to_srgb(1.0f) == 1.0f);
  CHECK(vice_fast_srgb_to_linear(0.0f) == 0.0f);
  CHECK(vice_fast_srgb_to_linear(1.0f) == 1.0f);
  printf("color_nan ok\n");
}

static void test_stream_readiness_agreement() {
  // has_next_band and pull_band must agree: a ready band pulls rows,
  // an unready one reports backpressure (-2), never -3 and never zeros.
  // Pins the +4 (advertise) / +5 (require) halo invariant.
  for (int scale : {2, 3, 4}) {
    int w = 16, h = 16, c = 3;
    int out_w = w * scale, out_h = h * scale;
    vice_stream_ctx* sctx = vice_stream_create(w, h, scale, c, 32);
    CHECK(sctx != nullptr);
    std::vector<float> row((size_t)w * c, 0.3f);
    std::vector<unsigned char> band((size_t)64 * out_w * c, 0xAB);
    int pushed = 0, emitted = 0;
    while (emitted < out_h) {
      if (vice_stream_has_next_band(sctx)) {
        int rows = -1;
        int rc = vice_stream_pull_band(sctx, band.data(), &rows);
        CHECK(rc >= 0 && rows > 0);
        emitted += rows;
      } else {
        CHECK(pushed < h);
        CHECK(vice_stream_push_input_rows(sctx, row.data(), 1) == 0);
        pushed += 1;
      }
    }
    CHECK(emitted == out_h);
    vice_stream_destroy(sctx);
  }
  printf("stream_readiness ok\n");
}

static void test_color_roundtrip() {  for (int i = 0; i <= 255; i++) {
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
  }
  printf("upscale ok\n");
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
  // RGB = 1.0 * 0.5 = 0.5, A = 0.5. Tall band render.
  int w = 4, h = 4, scale = 2, c = 4;
  int out_w = w * scale, out_h = h * scale;
  vice_stream_ctx* sctx = vice_stream_create(w, h, scale, c, out_h);
  CHECK(sctx != nullptr);
  std::vector<float> y((size_t)w * h * c);
  for (size_t i = 0; i < (size_t)w * h; ++i) {
    y[i * 4 + 0] = 0.5f;
    y[i * 4 + 1] = 0.5f;
    y[i * 4 + 2] = 0.5f;
    y[i * 4 + 3] = 0.5f;
  }
  CHECK(vice_stream_push_input_rows(sctx, y.data(), h) == 0);
  std::vector<unsigned char> rows((size_t)out_h * out_w * c);
  int row_count = 0;
  CHECK(vice_stream_pull_band(sctx, rows.data(), &row_count) == 1);
  CHECK(row_count == out_h);
  CHECK(vice_stream_last_residual(sctx) < 1e-5);

  // Check that white un-premultiplies back to ~255 and alpha is linearly ~128
  for (int i = 0; i < out_w * out_h; ++i) {
    unsigned char r = rows[i * 4 + 0];
    unsigned char g = rows[i * 4 + 1];
    unsigned char b = rows[i * 4 + 2];
    unsigned char a = rows[i * 4 + 3];
    CHECK(r >= 254 && r <= 255);
    CHECK(g >= 254 && g <= 255);
    CHECK(b >= 254 && b <= 255);
    CHECK(a >= 127 && a <= 128);
  }
  vice_stream_destroy(sctx);
  printf("transparency ok\n");
}

static void test_saturated_residual() {
  // Test image with pure black and fully saturated colors, tall band render.
  int w = 8, h = 8, scale = 2, c = 3;
  int out_h = h * scale;
  vice_stream_ctx* sctx = vice_stream_create(w, h, scale, c, out_h);
  CHECK(sctx != nullptr);
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
  CHECK(vice_stream_push_input_rows(sctx, y.data(), h) == 0);
  int out_w = w * scale;
  std::vector<unsigned char> band((size_t)out_h * out_w * c);
  int rows = 0;
  CHECK(vice_stream_pull_band(sctx, band.data(), &rows) == 1);
  CHECK(rows == out_h);
  double r = vice_stream_last_residual(sctx);
  printf("saturated content residual=%g\n", r);
  CHECK(r <= 1.1e-7);
  vice_stream_destroy(sctx);
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

static void test_png_segments() {
  // adler_combine unit check on literals.
  {
    const unsigned char* a = (const unsigned char*)"hello ";
    const unsigned char* b = (const unsigned char*)"world";
    uint32_t ad_a = vice_adler32(a, 6);
    uint32_t ad_b = vice_adler32(b, 5);
    std::vector<unsigned char> both(a, a + 6);
    both.insert(both.end(), b, b + 5);
    CHECK(vice_adler32_combine(ad_a, ad_b, 5) == vice_adler32(both.data(), both.size()));
  }
  // Two slabs -> segments -> coordinator-style assembly -> strict decode.
  // Assembly: sig + IHDR + ordered IDATs over (zlib_hdr + seg0 + seg1 +
  // combined adler) + IEND. decode_png_rows inflates and checks the adler.
  int W = 37, H = 23;
  std::vector<unsigned char> img((size_t)W * H * 4);
  for (int y = 0; y < H; y++)
    for (int x = 0; x < W; x++) {
      size_t i = ((size_t)y * W + x) * 4;
      img[i + 0] = (unsigned char)((x * 37 + y * 91) & 255);
      img[i + 1] = (unsigned char)((x * 11 + y * 57 + 40) & 255);
      img[i + 2] = (unsigned char)((x * 5 + y * 131 + 90) & 255);
      img[i + 3] = (x < 20) ? 255 : (unsigned char)((y * 10) & 255);
    }
  struct Seg {
    std::vector<unsigned char> bytes;
    uint32_t adler = 1;
    size_t raw_len = 0;
  };
  auto render_slab = [&](int y0, int rows, bool last) {
    Seg sg;
    vice_png_segment* st = vice_png_segment_open(W, rows, 4, 4);
    CHECK(st != nullptr);
    CHECK(vice_png_segment_write_rows(st, img.data() + (size_t)y0 * W * 4, rows) == 0);
    CHECK(vice_png_segment_finish(st, last ? 1 : 0, &sg.adler, &sg.raw_len) == 0);
    CHECK(sg.raw_len == (size_t)rows * (W * 4 + 1));
    std::vector<unsigned char> piece(997);
    for (;;) {
      size_t got = 0;
      CHECK(vice_png_segment_drain(st, piece.data(), piece.size(), &got) == 0);
      if (!got) break;
      sg.bytes.insert(sg.bytes.end(), piece.data(), piece.data() + got);
    }
    vice_png_segment_destroy(st);
    CHECK(!sg.bytes.empty());
    return sg;
  };
  Seg s0 = render_slab(0, 11, false);
  Seg s0b = render_slab(0, 11, false);
  CHECK(s0.bytes == s0b.bytes && s0.adler == s0b.adler); // deterministic
  Seg s1 = render_slab(11, 12, true);

  std::vector<unsigned char> idat_all = {0x78, 0x9c};
  idat_all.insert(idat_all.end(), s0.bytes.begin(), s0.bytes.end());
  idat_all.insert(idat_all.end(), s1.bytes.begin(), s1.bytes.end());
  uint32_t ad = vice_adler32_combine(s0.adler, s1.adler, s1.raw_len);
  idat_all.push_back((unsigned char)(ad >> 24));
  idat_all.push_back((unsigned char)(ad >> 16));
  idat_all.push_back((unsigned char)(ad >> 8));
  idat_all.push_back((unsigned char)ad);

  std::vector<unsigned char> full = {137, 80, 78, 71, 13, 10, 26, 10};
  unsigned char ihdr13[13] = {(unsigned char)(W >> 24), (unsigned char)(W >> 16),
                              (unsigned char)(W >> 8),  (unsigned char)W,
                              (unsigned char)(H >> 24), (unsigned char)(H >> 16),
                              (unsigned char)(H >> 8),  (unsigned char)H,
                              8,                       6, 0, 0, 0};
  png_chunk(full, "IHDR", ihdr13, 13);
  size_t off = 0;
  while (off < idat_all.size()) {
    size_t n = idat_all.size() - off > 32768 ? 32768 : idat_all.size() - off;
    png_chunk(full, "IDAT", idat_all.data() + off, n);
    off += n;
  }
  png_chunk(full, "IEND", nullptr, 0);

  int dW = 0, dH = 0, dC = 0;
  std::vector<unsigned char> px;
  CHECK(decode_png_rows(full, &dW, &dH, &dC, px, nullptr));
  CHECK(dW == W && dH == H && dC == 4);
  CHECK(px.size() == img.size());
  for (size_t i = 0; i < px.size(); i++) CHECK(px[i] == img[i]);
  printf("png_segments assembled=%zu seg0=%zu seg1=%zu\n", full.size(), s0.bytes.size(),
         s1.bytes.size());

  // Misuse: bad dims rejected, overrun rejected, finish needs exact rows.
  CHECK(vice_png_segment_open(0, 8, 4, 4) == nullptr);
  CHECK(vice_png_segment_open(8, 8, 2, 2) == nullptr);
  {
    vice_png_segment* st = vice_png_segment_open(8, 4, 4, 4);
    CHECK(st != nullptr);
    std::vector<unsigned char> rows((size_t)8 * 4 * 4, 128);
    CHECK(vice_png_segment_write_rows(st, rows.data(), 0) != 0);
    CHECK(vice_png_segment_write_rows(st, nullptr, 1) != 0);
    CHECK(vice_png_segment_write_rows(st, rows.data(), 2) == 0);
    CHECK(vice_png_segment_write_rows(st, rows.data(), 3) != 0); // overrun
    uint32_t fad = 0;
    size_t frl = 0;
    CHECK(vice_png_segment_finish(st, 0, &fad, &frl) != 0); // incomplete
    CHECK(vice_png_segment_write_rows(st, rows.data(), 2) == 0);
    CHECK(vice_png_segment_finish(st, 0, &fad, &frl) == 0);
    CHECK(frl == (size_t)4 * (8 * 4 + 1));
    unsigned char tmp[64];
    size_t got = 0;
    CHECK(vice_png_segment_drain(nullptr, tmp, sizeof(tmp), &got) != 0);
    vice_png_segment_destroy(st);
  }
  printf("png_segments ok\n");
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
  // The stream context rounds band_h up to a multiple of scale (e.g. 64 ->
  // 66 at 3x): size the byte buffer for the rounded value, not band_h.
  int band_alloc = ((band_h + scale - 1) / scale) * scale;
  std::vector<unsigned char> band((size_t)band_alloc * out_w * ch);
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
  std::vector<unsigned char> outs[3];
  double res[3] = {0, 0, 0};
  for (int mode : {1, 2}) {
    outs[mode] = render_stream_rows(in_w, in_h, 4, ch, 32, mode, input, &res[mode]);
    CHECK((int)outs[mode].size() == 96 * 96 * ch);
    printf("fused4x mode=%d residual=%g\n", mode, res[mode]);
    CHECK(res[mode] < 1e-5);
  }
  // Clean (mode 1) skips sharpness/shock on the second pass, detail (mode 2)
  // does not: the two modes must produce different bytes by construction.
  CHECK(outs[1].size() == outs[2].size());
  CHECK(std::memcmp(outs[1].data(), outs[2].data(), outs[1].size()) != 0);
  printf("fused clean-vs-detail differ ok\n");
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
    double fres = 0;
    auto out = render_stream_rows(fw, fh, 4, fch, 64, 1, edge, &fres);
    CHECK(fres < 1e-5);
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

static void test_stream_band_smooth() {  // Band-local smooth back-projection must actually run: on a hard vertical
  // edge the stream seam at 3x/4x must beat the old box-only path (~3.9-4.4
  // on this content) while the residual stays exact.
  for (int scale : {3, 4}) {
    int in_w = 32, in_h = 32, ch = 3;
    std::vector<float> input((size_t)in_w * in_h * ch);
    for (int y = 0; y < in_h; y++)
      for (int x = 0; x < in_w; x++)
        for (int c = 0; c < ch; c++)
          input[((size_t)y * in_w + x) * ch + c] = (x < in_w / 2) ? 0.05f : 0.95f;
    double res = 0;
    auto bytes = render_stream_rows(in_w, in_h, scale, ch, 64, 0, input, &res);
    CHECK(res < 1e-5);
    int W = in_w * scale, H = in_h * scale;
    std::vector<float> out((size_t)W * H * ch);
    for (size_t i = 0; i < out.size(); i++) out[i] = bytes[i] / 255.0f;
    double seam = vice_seam_ratio(out.data(), W, H, scale, ch);
    printf("stream_band_smooth scale=%d seam=%.3f\n", scale, seam);
    CHECK(seam < 3.5);
  }
}

static void test_stream_opaque_rgba_sums() {
  // Opaque RGBA through the stream engine: every RGB block sum equals
  // s^2 x source byte (decode-inverse) and every alpha sum s^2 x alpha byte.
  for (int scale : {2, 4}) {
    int in_w = 16, in_h = 16, ch = 4;
    std::vector<float> input((size_t)in_w * in_h * ch);
    for (int y = 0; y < in_h; y++)
      for (int x = 0; x < in_w; x++) {
        float v = (float)(x + y * 3) / (float)(in_w + in_h * 3);
        input[((size_t)y * in_w + x) * 4 + 0] = v;
        input[((size_t)y * in_w + x) * 4 + 1] = v * 0.6f;
        input[((size_t)y * in_w + x) * 4 + 2] = 1.0f - v;
        input[((size_t)y * in_w + x) * 4 + 3] = 1.0f; // opaque
      }
    double res = 0;
    auto bytes = render_stream_rows(in_w, in_h, scale, ch, 64, 0, input, &res);
    CHECK(res < 1e-5);
    int W = in_w * scale, H = in_h * scale;
    CHECK((int)bytes.size() == W * H * ch);
    int N = scale * scale;
    for (int by = 0; by < in_h; by++)
      for (int bx = 0; bx < in_w; bx++)
        for (int c = 0; c < ch; c++) {
          float y_lin = input[((size_t)by * in_w + bx) * ch + c];
          float src_f = (c == 3) ? y_lin * 255.0f
                                 : vice_linear_to_srgb(y_lin < 0.0f    ? 0.0f
                                                       : (y_lin > 1.0f ? 1.0f : y_lin)) *
                                       255.0f;
          int src_byte = (int)(src_f + 0.5f);
          if (src_byte < 0) src_byte = 0;
          if (src_byte > 255) src_byte = 255;
          int sum = 0;
          for (int dy = 0; dy < scale; dy++)
            for (int dx = 0; dx < scale; dx++)
              sum += bytes[(((size_t)(by * scale + dy) * W + bx * scale + dx) * ch) + c];
          CHECK(sum == N * src_byte);
        }
    printf("stream_opaque_rgba scale=%d sums exact ok\n", scale);
  }
}

static void test_stream_slab_origin() {
  // Slab contract: halo query matches the strip math, begin_slab rejects
  // misuse, and a mid-image slab renders owned rows byte-identical to the
  // sequential full render. Pre-proves the P3 slab-equivalence mechanism.
  {
    int top = -1, bottom = -1;
    vice_stream_halo_rows(2, 0, &top, &bottom);
    CHECK(top == 8 && bottom == 8);
    vice_stream_halo_rows(4, 1, &top, &bottom);
    CHECK(top == 14 && bottom == 14);
    vice_stream_halo_rows(5, 0, &top, &bottom);
    CHECK(top == 0 && bottom == 0);
    vice_stream_halo_rows(4, 0, nullptr, nullptr); // null sinks ok
  }
  for (int pass = 0; pass < 2; pass++) {
    int s = (pass == 0) ? 2 : 4;
    int fused = (pass == 0) ? 0 : 1;
    int w = 64, h = 64, c = 3;
    int out_w = w * s, out_h = h * s;
    std::vector<float> input((size_t)w * h * c);
    for (size_t i = 0; i < input.size(); i++) input[i] = (float)(i % 251) / 251.0f;

    // Reference: tall-band render (one band = image height). Banded renders
    // may wobble ≤ 1 LSB at joints; the tall render has no interior strip
    // edges, so a correct slab must match it exactly.
    std::vector<unsigned char> full;
    {
      vice_stream_ctx* seq = vice_stream_create(w, h, s, c, out_h);
      CHECK(seq != nullptr);
      if (fused) CHECK(vice_stream_set_fused(seq, fused) == 0);
      CHECK(vice_stream_push_input_rows(seq, input.data(), h) == 0);
      CHECK(vice_stream_has_next_band(seq) == 1);
      full.assign((size_t)out_w * out_h * c, 0);
      int rows = 0;
      CHECK(vice_stream_pull_band(seq, full.data(), &rows) == 1);
      CHECK(rows == out_h);
      vice_stream_destroy(seq);
    }

    // Slab: owned output rows deep interior (strip touches no image edge),
    // so only the halo stands between slab and tall bytes.
    int out_y0 = (out_h / 2 / s) * s; // block-aligned mid image
    int out_y1 = out_y0 + 32;
    int in_owned0 = out_y0 / s;
    int top = 0, bottom = 0;
    vice_stream_halo_rows(s, fused, &top, &bottom);
    int in_y0 = in_owned0 - top < 0 ? 0 : in_owned0 - top;
    vice_stream_ctx* slab = vice_stream_create(w, h, s, c, 32);
    CHECK(slab != nullptr);
    if (fused) CHECK(vice_stream_set_fused(slab, fused) == 0);
    CHECK(vice_stream_begin_slab(slab, in_y0, out_y0) == VICE_OK);
    CHECK(vice_stream_begin_slab(slab, in_y0, out_y0) == VICE_E_STATE); // once only
    CHECK(vice_stream_begin_slab(nullptr, 0, 0) == VICE_E_ARG);
    int pushed = in_y0, emitted = out_y0;
    std::vector<unsigned char> band((size_t)64 * out_w * c);
    std::vector<unsigned char> got((size_t)(out_y1 - out_y0) * out_w * c);
    while (emitted < out_y1) {
      while (pushed < h && !vice_stream_has_next_band(slab)) {
        int n = (h - pushed < 8) ? h - pushed : 8;
        CHECK(vice_stream_push_input_rows(slab, input.data() + (size_t)pushed * w * c, n) == 0);
        pushed += n;
      }
      CHECK(vice_stream_has_next_band(slab) == 1);
      int rows = 0;
      int rc = vice_stream_pull_band(slab, band.data(), &rows);
      CHECK(rc >= 0 && rows > 0);
      int take = rows;
      if (emitted + take > out_y1) take = out_y1 - emitted;
      std::memcpy(got.data() + (size_t)(emitted - out_y0) * out_w * c, band.data(),
                  (size_t)take * out_w * c);
      emitted += rows;
      if (rc == 1) break;
    }
    vice_stream_destroy(slab);
    CHECK(emitted >= out_y1);
    // Degenerate slab (origin 0,0): must match bit-exact, else bookkeeping bug.
    {
      vice_stream_ctx* dgen = vice_stream_create(w, h, s, c, 32);
      CHECK(dgen != nullptr);
      if (fused) CHECK(vice_stream_set_fused(dgen, fused) == 0);
      CHECK(vice_stream_begin_slab(dgen, 0, 0) == VICE_OK);
      int dp = 0, de = 0;
      std::vector<unsigned char> dgot(full.size(), 0);
      while (de < out_h) {
        while (dp < h && !vice_stream_has_next_band(dgen)) {
          int n = (h - dp < 8) ? h - dp : 8;
          CHECK(vice_stream_push_input_rows(dgen, input.data() + (size_t)dp * w * c, n) == 0);
          dp += n;
        }
        CHECK(vice_stream_has_next_band(dgen) == 1);
        int rows = 0;
        int rc = vice_stream_pull_band(dgen, band.data(), &rows);
        CHECK(rc >= 0 && rows > 0);
        std::memcpy(dgot.data() + (size_t)de * out_w * c, band.data(), (size_t)rows * out_w * c);
        de += rows;
        if (rc == 1) break;
      }
      vice_stream_destroy(dgen);
      CHECK(de == out_h);
      if (std::memcmp(dgot.data(), full.data(), full.size()) != 0)
        printf("SLABDBG degenerate slab DIFFERS scale=%d fused=%d\n", s, fused);
      else
        printf("SLABDBG degenerate slab identical scale=%d fused=%d\n", s, fused);
    }
    if (std::memcmp(got.data(), full.data() + (size_t)out_y0 * out_w * c, got.size()) != 0) {
      double worst = 0;
      int worst_r = -1;
      std::string profile;
      for (int r = 0; r < out_y1 - out_y0; r++) {
        double row_worst = 0;
        for (int i = 0; i < out_w * c; i++) {
          double d = std::abs((double)got[(size_t)r * out_w * c + i] -
                              (double)full[((size_t)out_y0 + r) * out_w * c + i]);
          if (d > row_worst) row_worst = d;
        }
        if (row_worst > worst) {
          worst = row_worst;
          worst_r = r;
        }
        if (row_worst > 0) {
          char buf[64];
          std::snprintf(buf, sizeof(buf), " r%d=%.0f", r, row_worst);
          profile += buf;
        }
      }
      printf("SLABDBG scale=%d fused=%d out_y0=%d rows=%d worst=%.1f at slab-row %d (global %d)\n",
             s, fused, out_y0, out_y1 - out_y0, worst, worst_r, out_y0 + worst_r);
      printf("SLABDBG profile:%s\n", profile.c_str());
      CHECK(false);
    }
    printf("stream_slab scale=%d fused=%d identical ok\n", s, fused);
  }
  // Misaligned origin rejected.
  {
    vice_stream_ctx* sctx = vice_stream_create(16, 16, 2, 3, 16);
    CHECK(sctx != nullptr);
    CHECK(vice_stream_begin_slab(sctx, 0, 1) == VICE_E_ARG);
    vice_stream_destroy(sctx);
  }
}

// Golden: fixed slab boundaries tile the image; concatenated owned rows equal
// the tall-band render byte-exactly. Slab geometry (never worker count)
// determines bytes — the P4+ determinism story rests on this test.
static void test_stream_slab_tiling() {
  for (int pass = 0; pass < 2; pass++) {
    int s = (pass == 0) ? 2 : 4;
    int fused = (pass == 0) ? 0 : 1;
    int w = 48, h = 48, c = 3;
    int out_w = w * s, out_h = h * s;
    std::vector<float> input((size_t)w * h * c);
    for (size_t i = 0; i < input.size(); i++) input[i] = (float)(i % 251) / 251.0f;

    // Tall reference: one band = image height.
    std::vector<unsigned char> tall((size_t)out_w * out_h * c);
    {
      vice_stream_ctx* t = vice_stream_create(w, h, s, c, out_h);
      CHECK(t != nullptr);
      if (fused) CHECK(vice_stream_set_fused(t, fused) == 0);
      CHECK(vice_stream_push_input_rows(t, input.data(), h) == 0);
      CHECK(vice_stream_has_next_band(t) == 1);
      int rows = 0;
      CHECK(vice_stream_pull_band(t, tall.data(), &rows) == 1);
      CHECK(rows == out_h);
      vice_stream_destroy(t);
    }

    // Fixed slabs of 32 output rows cover the image; halo per query.
    int top = 0, bottom = 0;
    vice_stream_halo_rows(s, fused, &top, &bottom);
    const int SLAB = 32;
    std::vector<unsigned char> tiled((size_t)out_w * out_h * c, 0);
    std::vector<unsigned char> band((size_t)64 * out_w * c);
    for (int out_y0 = 0; out_y0 < out_h; out_y0 += SLAB) {
      int out_y1 = out_y0 + SLAB < out_h ? out_y0 + SLAB : out_h;
      int in_y0 = out_y0 / s - top < 0 ? 0 : out_y0 / s - top;
      vice_stream_ctx* slab = vice_stream_create(w, h, s, c, SLAB);
      CHECK(slab != nullptr);
      if (fused) CHECK(vice_stream_set_fused(slab, fused) == 0);
      CHECK(vice_stream_begin_slab(slab, in_y0, out_y0) == VICE_OK);
      int pushed = in_y0, emitted = out_y0;
      while (emitted < out_y1) {
        while (pushed < h && !vice_stream_has_next_band(slab)) {
          int n = (h - pushed < 8) ? h - pushed : 8;
          CHECK(vice_stream_push_input_rows(slab, input.data() + (size_t)pushed * w * c, n) == 0);
          pushed += n;
        }
        CHECK(vice_stream_has_next_band(slab) == 1);
        int rows = 0;
        int rc = vice_stream_pull_band(slab, band.data(), &rows);
        CHECK(rc >= 0 && rows > 0);
        int take = rows;
        if (emitted + take > out_y1) take = out_y1 - emitted;
        std::memcpy(tiled.data() + (size_t)emitted * out_w * c, band.data(),
                    (size_t)take * out_w * c);
        emitted += rows;
        if (rc == 1) break;
      }
      vice_stream_destroy(slab);
      CHECK(emitted >= out_y1);
    }
    CHECK(std::memcmp(tiled.data(), tall.data(), tall.size()) == 0);
    printf("stream_slab_tiling scale=%d fused=%d identical ok\n", s, fused);
  }
}

static void test_stream_memory_estimator() {
  // Bad geometry -> 0. Estimate always covers the obvious floor (full linear
  // input + stored output + WASM base heap): it must never under-predict.
  CHECK(vice_stream_memory_bytes(0, 8, 2, 3, 64, 0) == 0);
  CHECK(vice_stream_memory_bytes(8, 8, 5, 3, 64, 0) == 0);
  CHECK(vice_stream_memory_bytes(8, 8, 2, 2, 64, 0) == 0);
  CHECK(vice_stream_memory_bytes(8, 8, 2, 3, 64, 3) == 0);
  for (int s : {2, 3, 4}) {
    size_t e = vice_stream_memory_bytes(64, 48, s, 4, 64, 0);
    size_t floor = (size_t)64 * 48 * 4 * 4 + (size_t)(64 * s) * (48 * s) * 4 + 67108864u;
    CHECK(e >= floor);
    // Monotonic in every dimension; fused costs at least direct.
    CHECK(vice_stream_memory_bytes(128, 48, s, 4, 64, 0) > e);
    CHECK(vice_stream_memory_bytes(64, 96, s, 4, 64, 0) > e);
    if (s == 4) CHECK(vice_stream_memory_bytes(64, 48, s, 4, 64, 1) >= e);
  }
  // Absurd dims saturate instead of overflowing.
  CHECK(vice_stream_memory_bytes(2000000000, 2000000000, 4, 4, 64, 0) == SIZE_MAX);
  printf("stream_memory ok\n");
}

static void test_stream_no_silent_zeros() {  // Pulling without enough input must report backpressure (-2) and leave the
  // caller's buffer untouched — never emit silent black rows.
  vice_stream_ctx* sctx = vice_stream_create(16, 16, 2, 3, 16);
  CHECK(sctx != nullptr);
  std::vector<unsigned char> band(16 * 32 * 3, 0xAB);
  int rows = -1;
  CHECK(vice_stream_pull_band(sctx, band.data(), &rows) == -2);
  CHECK(rows == 0);
  for (unsigned char b : band) CHECK(b == 0xAB);
  vice_stream_destroy(sctx);
  printf("stream_no_silent_zeros ok\n");
}

int main() {
  test_project_exact();
  test_scales();
  test_ctx_roundtrip();
  test_icc_profile();
  test_color_nan_safety();
  test_color_roundtrip();
  test_metrics();
  test_upscale_lanczos_adaptive();
  test_streaming_strip();
  test_stream_readiness_agreement();
  test_stream_options();
  test_transparency();
  test_saturated_residual();
  test_png_stream_decode_equiv();
  test_png_stream_misuse();
  test_png_segments();
  test_png_stream_soak();
  test_stream_seam_bands();
  test_stream_band_smooth();
  test_stream_opaque_rgba_sums();
  test_stream_slab_origin();
  test_stream_slab_tiling();
  test_stream_memory_estimator();
  test_fused4x();
  test_stream_no_silent_zeros();
  printf("ALL PASS\n");
  return 0;
}
