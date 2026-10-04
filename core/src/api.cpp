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
  std::vector<unsigned char> icc;
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
  vice_project_multigrid(ctx->y.data(), ctx->raw.data(), ctx->in_w, ctx->in_h,
                         ctx->scale, ctx->channels, 2);
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

int vice_upscale_ex(vice_ctx* ctx, const ViceTuning* tuning) {
  if (!ctx || ctx->y.empty() || ctx->raw.empty()) return -1;
  ViceTuning t;
  if (tuning) {
    t = *tuning;
  } else {
    vice_tuning_defaults(&t);
  }
  return vice_upscale_lanczos_adaptive_ex(ctx->y.data(), ctx->in_w, ctx->in_h,
                                          ctx->channels, ctx->scale,
                                          ctx->raw.data(), &t);
}

int vice_upscale(vice_ctx* ctx) {
  return vice_upscale_ex(ctx, nullptr);
}

int vice_process_band(vice_ctx* ctx, int band, unsigned char* out_rows,
                      int* out_row_count) {
  if (!ctx || !out_rows || !out_row_count) return -1;
  const int band_h = 64;
  int y0 = band * band_h;
  if (y0 >= ctx->out_h) {
    *out_row_count = 0;
    return 0;
  }
  int rows = band_h < ctx->out_h - y0 ? band_h : ctx->out_h - y0;
  for (int y = 0; y < rows; ++y) {
    int py = y0 + y;
    for (int x = 0; x < ctx->out_w; ++x) {
      for (int c = 0; c < ctx->channels; ++c) {
        float lin = clamp01(
            ctx->raw[((py) * ctx->out_w + x) * ctx->channels + c]);
        float srgb = vice_fast_linear_to_srgb(lin);
        float dither = vice_spatial_triangular_dither(x, py, c);
        int q = (int)(srgb * 255.0f + dither + 0.5f);
        if (q < 0) q = 0;
        if (q > 255) q = 255;
        out_rows[(y * ctx->out_w + x) * ctx->channels + c] =
            (unsigned char)q;
      }
    }
  }
  *out_row_count = rows;
  return 0;
}

int vice_finish_png(vice_ctx* ctx, unsigned char* out, size_t cap,
                    size_t* written) {
  if (!ctx || !out || !written) return -1;
  std::vector<unsigned char> rgba((size_t)ctx->out_w * ctx->out_h *
                                  ctx->channels);
  for (int y = 0; y < ctx->out_h; ++y) {
    size_t row_offset = (size_t)y * ctx->out_w;
    for (int x = 0; x < ctx->out_w; ++x) {
      size_t idx = row_offset + x;
      for (int c = 0; c < ctx->channels; ++c) {
        float lin = clamp01(ctx->raw[idx * ctx->channels + c]);
        float srgb = vice_fast_linear_to_srgb(lin);
        float dither = vice_spatial_triangular_dither(x, y, c);
        int q = (int)(srgb * 255.0f + dither + 0.5f);
        if (q < 0) q = 0;
        if (q > 255) q = 255;
        rgba[idx * ctx->channels + c] = (unsigned char)q;
      }
    }
  }
  std::vector<unsigned char> png;
  const unsigned char* icc_ptr = ctx->icc.empty() ? nullptr : ctx->icc.data();
  size_t icc_len = ctx->icc.size();
  if (vice_encode_png_ex(rgba.data(), ctx->out_w, ctx->out_h, ctx->channels,
                         icc_ptr, icc_len, png) != 0)
    return -1;
  if (png.size() > cap) return -2;
  std::memcpy(out, png.data(), png.size());
  *written = png.size();
  return 0;
}

int vice_set_icc_profile(vice_ctx* ctx, const unsigned char* data, size_t size) {
  if (!ctx) return -1;
  if (!data || size == 0) {
    ctx->icc.clear();
    return 0;
  }
  ctx->icc.assign(data, data + size);
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

// ---------------------------------------------------------------------------
// Streaming Strip Pipeline (Out-of-Core Processing for Gigapixel Images)
// ---------------------------------------------------------------------------

struct vice_stream_ctx {
  int in_w, in_h, scale, channels;
  int out_w, out_h;
  int band_h;
  int in_rows_pushed;
  int out_rows_emitted;
  std::vector<float> in_buf;
  int in_buf_start_y;
  int in_buf_row_count;
  ViceTuning tuning;
};

vice_stream_ctx* vice_stream_create(int in_w, int in_h, int scale, int channels, int band_h) {
  if (in_w <= 0 || in_h <= 0 || (scale != 2 && scale != 3 && scale != 4) ||
      (channels != 3 && channels != 4) || band_h <= 0)
    return nullptr;
  auto* sctx = new (std::nothrow) vice_stream_ctx();
  if (!sctx) return nullptr;
  sctx->in_w = in_w;
  sctx->in_h = in_h;
  sctx->scale = scale;
  sctx->channels = channels;
  sctx->out_w = in_w * scale;
  sctx->out_h = in_h * scale;
  sctx->band_h = ((band_h + scale - 1) / scale) * scale;
  sctx->in_rows_pushed = 0;
  sctx->out_rows_emitted = 0;
  sctx->in_buf_start_y = 0;
  sctx->in_buf_row_count = 0;
  vice_tuning_defaults(&sctx->tuning);
  return sctx;
}

int vice_stream_push_input_rows(vice_stream_ctx* sctx, const float* in_rows, int row_count) {
  if (!sctx || !in_rows || row_count <= 0) return -1;
  size_t row_stride = (size_t)sctx->in_w * sctx->channels;
  size_t new_floats = (size_t)row_count * row_stride;
  size_t old_size = sctx->in_buf.size();
  sctx->in_buf.resize(old_size + new_floats);
  std::memcpy(sctx->in_buf.data() + old_size, in_rows, new_floats * sizeof(float));
  sctx->in_buf_row_count += row_count;
  sctx->in_rows_pushed += row_count;
  return 0;
}

int vice_stream_has_next_band(const vice_stream_ctx* sctx) {
  if (!sctx || sctx->out_rows_emitted >= sctx->out_h) return 0;
  int next_out_y1 = std::min(sctx->out_h, sctx->out_rows_emitted + sctx->band_h);
  double max_src_y = ((double)(next_out_y1 - 1) + 0.5) / (double)sctx->scale - 0.5;
  int needed_in_y_max = std::min(sctx->in_h - 1, (int)std::floor(max_src_y) + 4);
  return (sctx->in_rows_pushed > needed_in_y_max || sctx->in_rows_pushed >= sctx->in_h) ? 1 : 0;
}

int vice_stream_pull_band(vice_stream_ctx* sctx, unsigned char* out_bytes, int* written_rows) {
  if (!sctx || !out_bytes || !written_rows) return -1;
  if (sctx->out_rows_emitted >= sctx->out_h) {
    *written_rows = 0;
    return 1;
  }

  int out_y0 = sctx->out_rows_emitted;
  int cur_band_h = std::min(sctx->band_h, sctx->out_h - out_y0);
  int out_y1 = out_y0 + cur_band_h;

  double min_src_y = ((double)out_y0 + 0.5) / (double)sctx->scale - 0.5;
  double max_src_y = ((double)(out_y1 - 1) + 0.5) / (double)sctx->scale - 0.5;
  int req_in_y0 = std::max(0, (int)std::floor(min_src_y) - 3);
  int req_in_y1 = std::min(sctx->in_h, (int)std::floor(max_src_y) + 5);
  int req_in_rows = req_in_y1 - req_in_y0;

  if (sctx->in_rows_pushed < req_in_y1 && sctx->in_rows_pushed < sctx->in_h) {
    *written_rows = 0;
    return -2;
  }

  size_t in_row_stride = (size_t)sctx->in_w * sctx->channels;
  std::vector<float> in_strip((size_t)req_in_rows * in_row_stride);
  for (int iy = 0; iy < req_in_rows; ++iy) {
    int src_global_y = req_in_y0 + iy;
    int local_buf_y = src_global_y - sctx->in_buf_start_y;
    if (local_buf_y >= 0 && local_buf_y < sctx->in_buf_row_count) {
      std::memcpy(in_strip.data() + (size_t)iy * in_row_stride,
                  sctx->in_buf.data() + (size_t)local_buf_y * in_row_stride,
                  in_row_stride * sizeof(float));
    }
  }

  size_t out_row_stride = (size_t)sctx->out_w * sctx->channels;
  int strip_out_h = req_in_rows * sctx->scale;
  std::vector<float> strip_upscaled((size_t)strip_out_h * out_row_stride);

  vice_upscale_lanczos_adaptive_ex(in_strip.data(), sctx->in_w, req_in_rows,
                                   sctx->channels, sctx->scale,
                                   strip_upscaled.data(), &sctx->tuning);

  int strip_global_out_y0 = req_in_y0 * sctx->scale;
  int local_band_offset = out_y0 - strip_global_out_y0;

  std::vector<float> band_raw((size_t)cur_band_h * out_row_stride);
  for (int by = 0; by < cur_band_h; ++by) {
    int src_row = local_band_offset + by;
    if (src_row >= 0 && src_row < strip_out_h) {
      std::memcpy(band_raw.data() + (size_t)by * out_row_stride,
                  strip_upscaled.data() + (size_t)src_row * out_row_stride,
                  out_row_stride * sizeof(float));
    }
  }

  // Exact box consistency on band blocks
  int s = sctx->scale;
  double inv_s2 = 1.0 / (double(s) * s);
  for (int by = 0; by < cur_band_h / s; ++by) {
    int global_in_y = (out_y0 / s) + by;
    int local_in_y = global_in_y - req_in_y0;
    if (local_in_y < 0 || local_in_y >= req_in_rows) continue;

    for (int bx = 0; bx < sctx->in_w; ++bx) {
      for (int c = 0; c < sctx->channels; ++c) {
        double sum = 0.0;
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            sum += band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c];
          }
        }
        float orig = in_strip[((size_t)local_in_y * sctx->in_w + bx) * sctx->channels + c];
        float d = (float)(orig - sum * inv_s2);
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c] += d;
          }
        }
      }
    }
  }

  // Convert to 8-bit sRGB with dither directly into caller output buffer
  for (int y = 0; y < cur_band_h; ++y) {
    int global_y = out_y0 + y;
    for (int x = 0; x < sctx->out_w; ++x) {
      for (int c = 0; c < sctx->channels; ++c) {
        float lin = clamp01(band_raw[((size_t)y * sctx->out_w + x) * sctx->channels + c]);
        float srgb = vice_fast_linear_to_srgb(lin);
        float dither = vice_spatial_triangular_dither(x, global_y, c);
        int q = (int)(srgb * 255.0f + dither + 0.5f);
        if (q < 0) q = 0;
        if (q > 255) q = 255;
        out_bytes[((size_t)y * sctx->out_w + x) * sctx->channels + c] = (unsigned char)q;
      }
    }
  }

  sctx->out_rows_emitted += cur_band_h;
  *written_rows = cur_band_h;

  // Evict consumed input rows
  int min_in_y_needed_next = std::max(0, (int)std::floor(((double)sctx->out_rows_emitted + 0.5) / (double)sctx->scale - 0.5) - 3);
  int rows_to_drop = min_in_y_needed_next - sctx->in_buf_start_y;
  if (rows_to_drop > 0 && rows_to_drop <= sctx->in_buf_row_count) {
    size_t floats_to_drop = (size_t)rows_to_drop * in_row_stride;
    sctx->in_buf.erase(sctx->in_buf.begin(), sctx->in_buf.begin() + floats_to_drop);
    sctx->in_buf_start_y += rows_to_drop;
    sctx->in_buf_row_count -= rows_to_drop;
  }

  return sctx->out_rows_emitted >= sctx->out_h ? 1 : 0;
}

void vice_stream_destroy(vice_stream_ctx* sctx) {
  delete sctx;
}
