#include "vice.h"
#include "fused_4x.h"
#include "quantize.h"
#include "png.h"
#include "parallel_runtime.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

struct vice_stream_ctx {
  int in_w, in_h, scale, channels;
  int out_w, out_h;
  int band_h;
  int in_rows_pushed;
  int out_rows_emitted;
  std::vector<float> in_buf;
  int in_buf_start_y;
  int in_buf_row_count;
  std::vector<unsigned char> icc;
  double worst = 0.0;
  int fused = 0;
  int halo_extra = 0;
  // Reused across pull_band calls: sized to the largest band seen so far,
  // so steady-state rendering performs zero allocations per band.
  std::vector<float> scratch_in;
  std::vector<float> scratch_band;
  std::vector<float> scratch_up;
  std::vector<float> scratch_tmp;
  std::vector<float> scratch_big;
};

static constexpr int kFusedHalo = 6;

vice_stream_ctx* vice_stream_create(int in_w, int in_h, int scale, int channels, int band_h) {
  if (in_w <= 0 || in_h <= 0 || (scale != 2 && scale != 3 && scale != 4) ||
      (channels != 3 && channels != 4) || band_h <= 0)
    return nullptr;
  if (band_h > 4096) band_h = 4096;
  uint64_t outw = (uint64_t)in_w * (uint64_t)scale;
  uint64_t outh = (uint64_t)in_h * (uint64_t)scale;
  if (outw > 100000 || outh > 100000) return nullptr;
  uint64_t outcells = outw * outh * (uint64_t)channels;
  if (outcells > (uint64_t)SIZE_MAX) return nullptr;
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
  sctx->fused = 0;
  sctx->halo_extra = 0;
  return sctx;
}

int vice_stream_set_icc_profile(vice_stream_ctx* sctx, const unsigned char* data, size_t size) {
  if (!sctx) return -1;
  if (!data || size == 0) {
    sctx->icc.clear();
    return 0;
  }
  if (size > 16 * 1024 * 1024) return -1;
  sctx->icc.assign(data, data + size);
  return 0;
}

int vice_stream_set_fused(vice_stream_ctx* sctx, int mode) {
  if (!sctx || (mode != 0 && mode != 1 && mode != 2)) return -1;
  if (mode != 0 && sctx->scale != 4) return -1;
  sctx->fused = mode;
  sctx->halo_extra = mode ? kFusedHalo : 0;
  return 0;
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
  int needed_in_y_max =
      std::min(sctx->in_h - 1, (int)std::floor(max_src_y) + 4 + sctx->halo_extra);
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
  int HE = sctx->halo_extra;
  int req_in_y0 = std::max(0, (int)std::floor(min_src_y) - 3 - HE);
  int req_in_y1 = std::min(sctx->in_h, (int)std::floor(max_src_y) + 5 + HE);
  int req_in_rows = req_in_y1 - req_in_y0;

  if (sctx->in_rows_pushed < req_in_y1 && sctx->in_rows_pushed < sctx->in_h) {
    *written_rows = 0;
    return -2;
  }

  size_t in_row_stride = (size_t)sctx->in_w * sctx->channels;
  sctx->scratch_in.resize((size_t)req_in_rows * in_row_stride);
  float* in_strip = sctx->scratch_in.data();
  for (int iy = 0; iy < req_in_rows; ++iy) {
    int src_global_y = req_in_y0 + iy;
    int local_buf_y = src_global_y - sctx->in_buf_start_y;
    if (local_buf_y < 0 || local_buf_y >= sctx->in_buf_row_count)
      return -3; // required input row evicted or never pushed: never emit zeros
    std::memcpy(in_strip + (size_t)iy * in_row_stride,
                sctx->in_buf.data() + (size_t)local_buf_y * in_row_stride,
                in_row_stride * sizeof(float));
  }

  size_t out_row_stride = (size_t)sctx->out_w * sctx->channels;
  sctx->scratch_band.resize((size_t)cur_band_h * out_row_stride);
  float* band_raw = sctx->scratch_band.data();

  if (sctx->fused && sctx->scale == 4) {
    if (vice_render_fused_4x_strip(in_strip, sctx->in_w, req_in_rows,
                                   sctx->channels, sctx->fused,
                                   out_y0, cur_band_h, req_in_y0,
                                   band_raw,
                                   sctx->scratch_tmp, sctx->scratch_big) != 0)
      return -3;
  } else {
    int strip_out_h = req_in_rows * sctx->scale;
    sctx->scratch_up.resize((size_t)strip_out_h * out_row_stride);
    float* strip_upscaled = sctx->scratch_up.data();

    if (vice_upscale_lanczos_adaptive(in_strip, sctx->in_w, req_in_rows,
                                      sctx->channels, sctx->scale,
                                      strip_upscaled) != 0)
      return -1;

    int strip_global_out_y0 = req_in_y0 * sctx->scale;
    int local_band_offset = out_y0 - strip_global_out_y0;

    for (int by = 0; by < cur_band_h; ++by) {
      int src_row = local_band_offset + by;
      if (src_row < 0 || src_row >= strip_out_h)
        return -3; // missing strip row: never emit zeros
      std::memcpy(band_raw + (size_t)by * out_row_stride,
                  strip_upscaled + (size_t)src_row * out_row_stride,
                  out_row_stride * sizeof(float));
    }
  }

  // Exact clamp-aware box consistency on band blocks
  int s = sctx->scale;
  int N = s * s;
  double inv_s2 = 1.0 / (double)N;
  vice_parallel_for_rows(0, cur_band_h / s, [&](int by) {
    int global_in_y = (out_y0 / s) + by;
    int local_in_y = global_in_y - req_in_y0;
    if (local_in_y < 0 || local_in_y >= req_in_rows) return;

    for (int bx = 0; bx < sctx->in_w; ++bx) {
      for (int c = 0; c < sctx->channels; ++c) {
        float orig = in_strip[((size_t)local_in_y * sctx->in_w + bx) * sctx->channels + c];
        if (orig <= 0.0f) {
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c] = 0.0f;
          continue;
        }
        if (orig >= 1.0f) {
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c] = 1.0f;
          continue;
        }

        float vals[16];
        float min_v = 1e30f, max_v = -1e30f;
        double sum = 0.0;
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            int idx = dy * s + dx;
            float v = band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c];
            vals[idx] = v;
            if (v < min_v) min_v = v;
            if (v > max_v) max_v = v;
            sum += v;
          }
        }
        double d_linear = (double)orig - sum * inv_s2;
        if ((double)min_v + d_linear >= 0.0 && (double)max_v + d_linear <= 1.0) {
          float d = (float)d_linear;
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c] += d;
          continue;
        }

        double lo = -(double)max_v;
        double hi = 1.0 - (double)min_v;
        for (int it = 0; it < 36; ++it) {
          double mid = 0.5 * (lo + hi);
          double cur_sum = 0.0;
          for (int k = 0; k < N; ++k) {
            double v = (double)vals[k] + mid;
            if (v < 0.0) v = 0.0;
            else if (v > 1.0) v = 1.0;
            cur_sum += v;
          }
          if (cur_sum * inv_s2 < (double)orig) lo = mid;
          else hi = mid;
        }
        double d_opt = 0.5 * (lo + hi);
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            float v = (float)((double)vals[dy * s + dx] + d_opt);
            if (v < 0.0f) v = 0.0f;
            else if (v > 1.0f) v = 1.0f;
            band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) * sctx->channels + c] = v;
          }
        }
      }
    }
  });

  for (int by = 0; by < cur_band_h / s; ++by) {
    int global_in_y = (out_y0 / s) + by;
    int local_in_y = global_in_y - req_in_y0;
    if (local_in_y < 0 || local_in_y >= req_in_rows) continue;
    for (int bx = 0; bx < sctx->in_w; ++bx) {
      for (int c = 0; c < sctx->channels; ++c) {
        double sum = 0.0;
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            sum += band_raw[(((size_t)by * s + dy) * sctx->out_w + bx * s + dx) *
                             sctx->channels +
                         c];
        double want = in_strip[((size_t)local_in_y * sctx->in_w + bx) * sctx->channels + c];
        double e = std::abs(sum * inv_s2 - want);
        if (e > sctx->worst) sctx->worst = e;
      }
    }
  }

  for (int y = 0; y < cur_band_h; ++y) {
    int global_y = out_y0 + y;
    for (int x = 0; x < sctx->out_w; ++x) {
      size_t idx = ((size_t)y * sctx->out_w + x) * sctx->channels;
      quantize_pixel(&band_raw[idx], &out_bytes[idx], sctx->channels, x, global_y);
    }
  }

  sctx->out_rows_emitted += cur_band_h;
  *written_rows = cur_band_h;

  int lookback = 3 + sctx->halo_extra;
  int min_in_y_needed_next = std::max(0, (int)std::floor(((double)sctx->out_rows_emitted + 0.5) / (double)sctx->scale - 0.5) - lookback);
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

double vice_stream_last_residual(const vice_stream_ctx* sctx) {
  return sctx ? sctx->worst : -1.0;
}

int vice_stream_finish_png(vice_stream_ctx* sctx, const unsigned char* rgba_rows, int n,
                           unsigned char* out, size_t cap, size_t* written) {
  if (!sctx || !rgba_rows || !out || !written) return -1;
  size_t want = (size_t)sctx->out_w * sctx->out_h * sctx->channels;
  if (n != (int)want && (size_t)n != want) return -1;
  std::vector<unsigned char> png;
  const unsigned char* icc_ptr = sctx->icc.empty() ? nullptr : sctx->icc.data();
  if (vice_encode_png_ex(rgba_rows, sctx->out_w, sctx->out_h, sctx->channels,
                         icc_ptr, sctx->icc.size(), png) != 0)
    return -1;
  if (png.size() > cap) return -2;
  std::memcpy(out, png.data(), png.size());
  *written = png.size();
  return 0;
}
