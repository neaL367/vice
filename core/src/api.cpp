#include "vice.h"
#include "png.h"
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

struct vice_ctx {
  int in_w, in_h, scale, channels;
  int out_w, out_h;
  std::vector<float> y;   // in_h*in_w*C linear premult
  std::vector<float> raw; // out_h*out_w*C linear premult
  double last_residual = 0.0;
};

static bool mul_overflow(int a, int b, int c, uint64_t& out) {
  uint64_t r = (uint64_t)a * (uint64_t)b * (uint64_t)c;
  out = r;
  return r > (uint64_t)SIZE_MAX / sizeof(float);
}

vice_ctx* vice_create(int in_w, int in_h, int scale, int channels) {
  if (in_w <= 0 || in_h <= 0) return nullptr;
  if (scale != 2 && scale != 3 && scale != 4) return nullptr;
  if (channels != 3 && channels != 4) return nullptr;
  uint64_t cells = 0;
  if (mul_overflow(in_w, in_h, channels, cells)) return nullptr;
  uint64_t outw = (uint64_t)in_w * (uint64_t)scale;
  uint64_t outh = (uint64_t)in_h * (uint64_t)scale;
  if (outw > 100000 || outh > 100000) return nullptr;
  uint64_t outcells = outw * outh * (uint64_t)channels;
  if (outcells > (uint64_t)SIZE_MAX / sizeof(float)) return nullptr;
  // 4x memory guard ~ matches spec streaming limits (reject absurd now)
  if (outcells > (uint64_t)500 * 1000 * 1000) return nullptr;
  auto* ctx = new (std::nothrow) vice_ctx();
  if (!ctx) return nullptr;
  ctx->in_w = in_w;
  ctx->in_h = in_h;
  ctx->scale = scale;
  ctx->channels = channels;
  ctx->out_w = (int)outw;
  ctx->out_h = (int)outh;
#ifdef __EMSCRIPTEN__
  // -fno-exceptions: allocation failure aborts (Emscripten default).
  ctx->y.assign((size_t)cells, 0.0f);
  ctx->raw.assign((size_t)outcells, 0.0f);
#else
  try {
    ctx->y.assign((size_t)cells, 0.0f);
    ctx->raw.assign((size_t)outcells, 0.0f);
  } catch (...) {
    delete ctx;
    return nullptr;
  }
#endif
  return ctx;
}

int vice_set_input(vice_ctx* ctx, const float* y, int n) {
  if (!ctx || !y) return -1;
  size_t want = (size_t)ctx->in_w * ctx->in_h * ctx->channels;
  if (n != (int)want && (size_t)n != want) return -1;
  std::memcpy(ctx->y.data(), y, want * sizeof(float));
  // init raw as nearest-neighbor U(y) so empty submit still consistent
  for (int by = 0; by < ctx->in_h; ++by)
    for (int bx = 0; bx < ctx->in_w; ++bx)
      for (int dy = 0; dy < ctx->scale; ++dy)
        for (int dx = 0; dx < ctx->scale; ++dx)
          for (int c = 0; c < ctx->channels; ++c)
            ctx->raw[((by * ctx->scale + dy) * ctx->out_w + bx * ctx->scale + dx) *
                         ctx->channels +
                     c] = ctx->y[(by * ctx->in_w + bx) * ctx->channels + c];
  return 0;
}

int vice_submit_raw_tile(vice_ctx* ctx, int tx, int ty, const float* tile,
                         int tw, int th, int n) {
  if (!ctx || !tile) return -1;
  if (tw <= 0 || th <= 0) return -1;
  if (tx < 0 || ty < 0 || tx + tw > ctx->out_w || ty + th > ctx->out_h) return -1;
  if (n != tw * th * ctx->channels) return -1;
  for (int y = 0; y < th; ++y)
    for (int x = 0; x < tw; ++x)
      for (int c = 0; c < ctx->channels; ++c)
        ctx->raw[((ty + y) * ctx->out_w + tx + x) * ctx->channels + c] =
            tile[(y * tw + x) * ctx->channels + c];
  return 0;
}

static float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

static double measure_residual(const vice_ctx* ctx, const std::vector<float>& buf) {
  double worst = 0.0;
  const int s = ctx->scale, W = ctx->out_w;
  double inv = 1.0 / ((double)s * s);
  for (int by = 0; by < ctx->in_h; ++by)
    for (int bx = 0; bx < ctx->in_w; ++bx)
      for (int c = 0; c < ctx->channels; ++c) {
        double sum = 0;
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            sum += buf[((by * s + dy) * W + bx * s + dx) * ctx->channels + c];
        double mean = sum * inv;
        double want = ctx->y[(by * ctx->in_w + bx) * ctx->channels + c];
        double e = std::abs(mean - want);
        if (e > worst) worst = e;
      }
  return worst;
}

int vice_project(vice_ctx* ctx) {
  if (!ctx) return -1;
  for (int iter = 0; iter < 3; ++iter) {
    vice_project_box(ctx->y.data(), ctx->raw.data(), ctx->in_w, ctx->in_h,
                     ctx->scale, ctx->channels);
    bool oob = false;
    for (float& v : ctx->raw) {
      if (v < 0.0f || v > 1.0f) {
        oob = true;
        v = clamp01(v);
      }
    }
    ctx->last_residual = measure_residual(ctx, ctx->raw);
    if (!oob) break;
  }
  return 0;
}

int vice_process_band(vice_ctx* ctx, int band, unsigned char* out_rows,
                      int* out_row_count) {
  if (!ctx || !out_rows || !out_row_count) return -1;
  // v1: band = index of output row start / band_h fixed 64? Use full rows.
  // Caller passes band = y0; we emit 64 rows (or remainder).
  const int band_h = 64;
  int y0 = band * band_h;
  if (y0 >= ctx->out_h) {
    *out_row_count = 0;
    return 0;
  }
  int rows = band_h < ctx->out_h - y0 ? band_h : ctx->out_h - y0;
  for (int y = 0; y < rows; ++y)
    for (int x = 0; x < ctx->out_w; ++x)
      for (int c = 0; c < ctx->channels; ++c) {
        float lin = clamp01(
            ctx->raw[((y0 + y) * ctx->out_w + x) * ctx->channels + c]);
        float srgb = vice_linear_to_srgb(lin);
        int q = (int)(srgb * 255.0f + 0.5f);
        if (q < 0) q = 0;
        if (q > 255) q = 255;
        out_rows[(y * ctx->out_w + x) * ctx->channels + c] =
            (unsigned char)q;
      }
  *out_row_count = rows;
  return 0;
}

int vice_finish_png(vice_ctx* ctx, unsigned char* out, size_t cap,
                    size_t* written) {
  if (!ctx || !out || !written) return -1;
  std::vector<unsigned char> rgba((size_t)ctx->out_w * ctx->out_h *
                                  ctx->channels);
  for (int y = 0; y < ctx->out_h; ++y)
    for (int x = 0; x < ctx->out_w; ++x)
      for (int c = 0; c < ctx->channels; ++c) {
        float lin =
            clamp01(ctx->raw[((size_t)y * ctx->out_w + x) * ctx->channels + c]);
        float srgb = vice_linear_to_srgb(lin);
        int q = (int)(srgb * 255.0f + 0.5f);
        if (q < 0) q = 0;
        if (q > 255) q = 255;
        rgba[((size_t)y * ctx->out_w + x) * ctx->channels + c] =
            (unsigned char)q;
      }
  std::vector<unsigned char> png;
  if (vice_encode_png(rgba.data(), ctx->out_w, ctx->out_h, ctx->channels,
                      png) != 0)
    return -1;
  if (png.size() > cap) return -2;
  std::memcpy(out, png.data(), png.size());
  *written = png.size();
  return 0;
}

double vice_last_residual(const vice_ctx* ctx) {
  return ctx ? ctx->last_residual : -1.0;
}

void vice_destroy(vice_ctx* ctx) { delete ctx; }

int vice_download_raw(vice_ctx* ctx, float* out, int n) {
  if (!ctx || !out) return -1;
  size_t want = ctx->raw.size();
  if (n != (int)want && (size_t)n != want) return -1;
  std::memcpy(out, ctx->raw.data(), want * sizeof(float));
  return 0;
}
