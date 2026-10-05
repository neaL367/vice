#include "vice.h"
#include "block_project.h"
#include "fused_4x.h"
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
  std::vector<float> scratch_d;
};

static constexpr int kFusedHalo = 6;
// Extra input rows each side feeding the band-local smooth back-projection:
// the bilinear correction taps residual blocks at most one block away, but
// strip-edge clamp artifacts (lanczos taps, sharp/shock spread) propagate
// inward about a block per smooth iteration. Halo 4 keeps owned rows clear
// of the edge with margin, which also makes mid-image slabs byte-identical
// to the tall-band render (pinned by test_stream_slab_origin).
static constexpr int kSmoothHalo = 4;

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

void vice_stream_halo_rows(int scale, int fused, int* top, int* bottom) {
  int t = 0, b = 0;
  if ((scale == 2 || scale == 3 || scale == 4) && (fused == 0 || fused == 1 || fused == 2)) {
    // floor() in the req math costs one row beyond taps+halos on each side:
    // top = 1 + (3 lanczos) + HE + smooth, bottom mirrors it.
    int he = (fused && scale == 4) ? kFusedHalo : 0;
    t = 1 + 3 + he + kSmoothHalo;
    b = 1 + 3 + he + kSmoothHalo;
  }
  if (top) *top = t;
  if (bottom) *bottom = b;
}

int vice_stream_begin_slab(vice_stream_ctx* sctx, int in_y0, int out_y0) {  if (!sctx) return VICE_E_ARG;
  if (!sctx->in_buf.empty() || sctx->out_rows_emitted != 0 || sctx->in_rows_pushed != 0)
    return VICE_E_STATE; // slabs start on a fresh ctx only
  if (in_y0 < 0 || out_y0 < 0 || out_y0 % sctx->scale != 0) return VICE_E_ARG;
  if (in_y0 > sctx->in_h || out_y0 > sctx->out_h) return VICE_E_ARG;
  sctx->in_buf_start_y = in_y0;
  sctx->in_rows_pushed = in_y0;
  sctx->out_rows_emitted = out_y0;
  return VICE_OK;
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
      std::min(sctx->in_h - 1, (int)std::floor(max_src_y) + 4 + sctx->halo_extra + kSmoothHalo);
  return (sctx->in_rows_pushed > needed_in_y_max || sctx->in_rows_pushed >= sctx->in_h) ? 1 : 0;
}

// Band-local smooth back-projection: raw += Ubilinear(y - A(raw)), iterated.
// Same operator as vice_project_smooth, restricted to the extended strip
// (owned rows plus the one-block halo), so band joints match the full-image
// smooth path up to the missing global low frequencies. Runs in place over
// the whole strip; the caller extracts the owned band afterwards and finishes
// with the exact clamp-aware box projection, which keeps the residual exact.
// Global output coordinates drive the bilinear map, so strip position never
// affects the math; taps clamp to the strip, which equals image-edge clamping
// wherever the strip touches the image border.
static void vice_stream_smooth_strip(
    const float* y_ext, float* raw_ext,
    int in_w, int in_h, int ext_rows, int ext_y0,
    int s, int c, std::vector<float>& scratch_d) {
  const int W = in_w * s;
  const int ext_out_rows = ext_rows * s;
  const double inv = 1.0 / (double(s) * s);
  const float alpha = (s == 2) ? 1.35f : 1.15f;
  scratch_d.assign((size_t)ext_rows * in_w * c, 0.0f);
  float* d = scratch_d.data();
  for (int it = 0; it < VICE_SMOOTH_ITERS; ++it) {
    for (int by = 0; by < ext_rows; ++by)
      for (int bx = 0; bx < in_w; ++bx)
        for (int ch = 0; ch < c; ++ch) {
          double sum = 0.0;
          for (int dy = 0; dy < s; ++dy)
            for (int dx = 0; dx < s; ++dx)
              sum += raw_ext[((size_t)(by * s + dy) * W + bx * s + dx) * c + ch];
          d[((size_t)by * in_w + bx) * c + ch] =
              y_ext[((size_t)by * in_w + bx) * c + ch] - (float)(sum * inv);
        }
    vice_parallel_for_rows(0, ext_out_rows, [&](int ey) {
      int py = ext_y0 * s + ey; // global output row
      float fy = ((float)py + 0.5f) / (float)s - 0.5f;
      int y0 = fy < 0 ? -1 : (int)fy;
      float ty = fy - (float)y0;
      int ya = y0 < 0 ? 0 : (y0 > in_h - 1 ? in_h - 1 : y0);
      int yb = y0 + 1 > in_h - 1 ? in_h - 1 : (y0 + 1 < 0 ? 0 : y0 + 1);
      int lya = ya - ext_y0, lyb = yb - ext_y0;
      if (lya < 0) lya = 0;
      if (lya > ext_rows - 1) lya = ext_rows - 1;
      if (lyb < 0) lyb = 0;
      if (lyb > ext_rows - 1) lyb = ext_rows - 1;
      for (int px = 0; px < W; ++px) {
        float fx = ((float)px + 0.5f) / (float)s - 0.5f;
        int x0 = fx < 0 ? -1 : (int)fx;
        float tx = fx - (float)x0;
        int xa = x0 < 0 ? 0 : (x0 > in_w - 1 ? in_w - 1 : x0);
        int xb = x0 + 1 > in_w - 1 ? in_w - 1 : (x0 + 1 < 0 ? 0 : x0 + 1);
        for (int ch = 0; ch < c; ++ch) {
          float a = d[((size_t)lya * in_w + xa) * c + ch];
          float b = d[((size_t)lya * in_w + xb) * c + ch];
          float cc = d[((size_t)lyb * in_w + xa) * c + ch];
          float e = d[((size_t)lyb * in_w + xb) * c + ch];
          float top = a + (b - a) * tx;
          float bot = cc + (e - cc) * tx;
          raw_ext[((size_t)ey * W + px) * c + ch] += alpha * (top + (bot - top) * ty);
        }
      }
    });
  }
}

// Encoded-domain integer-exact quantization.
// Per owned block: plain-round every sample (no dither), then move single
// levels — largest rounding error first, multi-pass — until the stored
// integer sum equals s*s x source byte. Source bytes invert the decode:
// sRGB-encoded premultiplied linear for RGB, linear-direct for alpha.
//
// Translucent pixels store UN-premultiplied bytes, whose sums have no reason
// to equal premultiplied-domain targets (forcing them darkens edges: 255
// would collapse toward 188 at 50% alpha). So the RGB fix applies only to
// fully opaque blocks (alpha byte 255 everywhere; premult == direct there);
// translucent blocks keep plain rounding. Alpha sums are always fixed.
static void vice_exact_sum_band(
    const float* band_raw, const float* in_strip,
    int in_w, int out_w, int cur_band_h, int out_y0,
    int req_in_y0, int req_in_rows, int s, int c, unsigned char* out_bytes) {
  const int N = s * s;
  for (int by = 0; by < cur_band_h / s; ++by) {
    int global_in_y = (out_y0 / s) + by;
    int local_in_y = global_in_y - req_in_y0;
    if (local_in_y < 0 || local_in_y >= req_in_rows) continue; // mirrors box guard
    for (int bx = 0; bx < in_w; ++bx) {
      // Opacity + alpha bytes first: alpha target is always meaningful.
      bool opaque = true;
      int a_byte[16];
      for (int dy = 0; dy < s; ++dy) {
        for (int dx = 0; dx < s; ++dx) {
          int k = dy * s + dx;
          float a_lin = 1.0f;
          if (c == 4) {
            a_lin = band_raw[(((size_t)by * s + dy) * out_w + bx * s + dx) * c + 3];
            if (a_lin < 0.0f) a_lin = 0.0f;
            if (a_lin > 1.0f) a_lin = 1.0f;
          }
          // Alpha is quantized from the POST-box value like the main path.
          int ab = (int)(a_lin * 255.0f + 0.5f);
          if (ab < 0) ab = 0;
          if (ab > 255) ab = 255;
          a_byte[k] = ab;
          if (ab != 255) opaque = false;
        }
      }
      int ch_end = (c == 4) ? 3 : c;
      for (int ch = 0; ch < ch_end; ++ch) {
        float y_lin = in_strip[((size_t)local_in_y * in_w + bx) * c + ch];
        float yc = y_lin < 0.0f ? 0.0f : (y_lin > 1.0f ? 1.0f : y_lin);
        float v_raw[16];
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            int k = dy * s + dx;
            float pix = band_raw[(((size_t)by * s + dy) * out_w + bx * s + dx) * c + ch];
            if (c == 4) {
              float a = band_raw[(((size_t)by * s + dy) * out_w + bx * s + dx) * c + 3];
              float inv = (a > 1e-6f) ? (1.0f / a) : 0.0f;
              pix *= inv; // un-premultiply (premult pipeline stores linear*a)
            }
            if (pix < 0.0f) pix = 0.0f;
            if (pix > 1.0f) pix = 1.0f;
            v_raw[k] = vice_linear_to_srgb(pix) * 255.0f;
          }
        }
        int q[16];
        double frac[16];
        int sum = 0;
        for (int k = 0; k < N; ++k) {
          float v = v_raw[k];
          if (v < 0.0f) v = 0.0f;
          if (v > 255.0f) v = 255.0f;
          int qi = (int)v; // floor of clamped value
          q[k] = qi;
          frac[k] = (double)v - qi;
          sum += qi;
        }
        // Fix sums only where the target is meaningful: opaque blocks (and
        // all of C==3). Translucent RGB keeps plain rounding.
        bool fix = (c == 3) || opaque;
        int target = 0;
        if (fix) {
          float src_f = vice_linear_to_srgb(yc) * 255.0f;
          int src_byte = (int)(src_f + 0.5f);
          if (src_byte < 0) src_byte = 0;
          if (src_byte > 255) src_byte = 255;
          target = N * src_byte;
        }
        int need = fix ? (target - sum) : 0;
        // Insertion order by fractional error (N <= 16, trivial).
        int order[16];
        for (int k = 0; k < N; ++k) order[k] = k;
        for (int a = 1; a < N; ++a) {
          int m = order[a];
          int b = a - 1;
          bool more = need > 0 ? (frac[m] > frac[order[b]]) : (frac[m] < frac[order[b]]);
          while (b >= 0 && more) {
            order[b + 1] = order[b];
            b--;
            more = (b >= 0) && (need > 0 ? (frac[m] > frac[order[b]]) : (frac[m] < frac[order[b]]));
          }
          order[b + 1] = m;
        }
        // Multi-pass: sRGB concavity (Jensen gap) can exceed N levels, so
        // cycle largest-error-first until the sum lands or no level moves.
        while (need != 0) {
          bool moved = false;
          if (need > 0) {
            for (int k = 0; k < N && need > 0; ++k) {
              if (q[order[k]] < 255) {
                q[order[k]]++;
                need--;
                moved = true;
              }
            }
          } else {
            for (int k = 0; k < N && need < 0; ++k) {
              if (q[order[k]] > 0) {
                q[order[k]]--;
                need++;
                moved = true;
              }
            }
          }
          if (!moved) break; // saturated: keep rounded values
        }
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            out_bytes[(((size_t)by * s + dy) * out_w + bx * s + dx) * c + ch] =
                (unsigned char)q[dy * s + dx];
      }
      if (c == 4) {
        // Alpha sums are always fixed: stored alpha is linear-direct, so the
        // target is always meaningful (no un-premultiply involved).
        float y_a = in_strip[((size_t)local_in_y * in_w + bx) * c + 3];
        if (y_a < 0.0f) y_a = 0.0f;
        if (y_a > 1.0f) y_a = 1.0f;
        int a_src = (int)(y_a * 255.0f + 0.5f);
        if (a_src < 0) a_src = 0;
        if (a_src > 255) a_src = 255;
        int aq[16];
        double afrac[16];
        int asum = 0;
        for (int dy = 0; dy < s; ++dy) {
          for (int dx = 0; dx < s; ++dx) {
            int k = dy * s + dx;
            float av = band_raw[(((size_t)by * s + dy) * out_w + bx * s + dx) * c + 3];
            if (av < 0.0f) av = 0.0f;
            if (av > 1.0f) av = 1.0f;
            float v = av * 255.0f;
            int qi = (int)v;
            aq[k] = qi;
            afrac[k] = (double)v - qi;
            asum += qi;
          }
        }
        int need = N * a_src - asum;
        int order[16];
        for (int k = 0; k < N; ++k) order[k] = k;
        for (int a = 1; a < N; ++a) {
          int m = order[a];
          int b = a - 1;
          bool more = need > 0 ? (afrac[m] > afrac[order[b]]) : (afrac[m] < afrac[order[b]]);
          while (b >= 0 && more) {
            order[b + 1] = order[b];
            b--;
            more = (b >= 0) && (need > 0 ? (afrac[m] > afrac[order[b]]) : (afrac[m] < afrac[order[b]]));
          }
          order[b + 1] = m;
        }
        while (need != 0) {
          bool moved = false;
          if (need > 0) {
            for (int k = 0; k < N && need > 0; ++k) {
              if (aq[order[k]] < 255) {
                aq[order[k]]++;
                need--;
                moved = true;
              }
            }
          } else {
            for (int k = 0; k < N && need < 0; ++k) {
              if (aq[order[k]] > 0) {
                aq[order[k]]--;
                need++;
                moved = true;
              }
            }
          }
          if (!moved) break;
        }
        for (int dy = 0; dy < s; ++dy)
          for (int dx = 0; dx < s; ++dx)
            out_bytes[(((size_t)by * s + dy) * out_w + bx * s + dx) * c + 3] =
                (unsigned char)aq[dy * s + dx];
      }
    }
  }
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
  int req_in_y0 = std::max(0, (int)std::floor(min_src_y) - 3 - HE - kSmoothHalo);
  int req_in_y1 = std::min(sctx->in_h, (int)std::floor(max_src_y) + 5 + HE + kSmoothHalo);
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

  // Render the extended strip, smooth it in place, then extract the owned
  // band: the halo rows make the smooth correction match across joints.
  float* strip_raw = nullptr;
  int strip_out_h = 0;
  if (sctx->fused && sctx->scale == 4) {
    if (vice_render_fused_4x_strip(in_strip, sctx->in_w, req_in_rows,
                                   sctx->channels, sctx->fused,
                                   sctx->scratch_tmp, sctx->scratch_big) != 0)
      return -1;
    strip_out_h = req_in_rows * 4;
    sctx->scratch_big.resize((size_t)strip_out_h * out_row_stride);
    strip_raw = sctx->scratch_big.data();
  } else {
    strip_out_h = req_in_rows * sctx->scale;
    sctx->scratch_up.resize((size_t)strip_out_h * out_row_stride);
    strip_raw = sctx->scratch_up.data();

    if (vice_upscale_lanczos_adaptive(in_strip, sctx->in_w, req_in_rows,
                                      sctx->channels, sctx->scale,
                                      strip_raw) != 0)
      return -1;
  }

  vice_stream_smooth_strip(in_strip, strip_raw, sctx->in_w, sctx->in_h,
                           req_in_rows, req_in_y0, sctx->scale, sctx->channels,
                           sctx->scratch_d);

  {
    int strip_global_out_y0 = req_in_y0 * sctx->scale;
    int local_band_offset = out_y0 - strip_global_out_y0;

    for (int by = 0; by < cur_band_h; ++by) {
      int src_row = local_band_offset + by;
      if (src_row < 0 || src_row >= strip_out_h)
        return -3; // missing strip row: never emit zeros
      std::memcpy(band_raw + (size_t)by * out_row_stride,
                  strip_raw + (size_t)src_row * out_row_stride,
                  out_row_stride * sizeof(float));
    }
  }

  // Exact clamp-aware box consistency on band blocks (single copy in
  // block_project.h; blocks are independent across threads).
  int s = sctx->scale;
  vice_parallel_for_rows(0, cur_band_h / s, [&](int by) {
    int global_in_y = (out_y0 / s) + by;
    int local_in_y = global_in_y - req_in_y0;
    if (local_in_y < 0 || local_in_y >= req_in_rows) return;

    for (int bx = 0; bx < sctx->in_w; ++bx) {
      const float* y_px =
          in_strip + ((size_t)local_in_y * sctx->in_w + bx) * sctx->channels;
      float* raw_block = band_raw + (((size_t)by * s * sctx->out_w + bx * s) * sctx->channels);
      vice_clamp_project_block(y_px, raw_block, sctx->out_w, s, sctx->channels);
    }
  });

  double inv_s2 = 1.0 / (double)(s * s);
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

  // Encoded-domain integer-exact output: plain round (no dither), then a
  // per-block integer fix so stored sums equal s^2 x source byte. Writes
  // every owned byte; see vice_exact_sum_band.
  vice_exact_sum_band(band_raw, in_strip, sctx->in_w, sctx->out_w, cur_band_h, out_y0,
                      req_in_y0, req_in_rows, s, sctx->channels, out_bytes);

  sctx->out_rows_emitted += cur_band_h;
  *written_rows = cur_band_h;

  int lookback = 3 + sctx->halo_extra + kSmoothHalo;
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

size_t vice_stream_memory_bytes(int in_w, int in_h, int scale, int ch, int band_h, int fused) {
  if (in_w <= 0 || in_h <= 0 || (scale != 2 && scale != 3 && scale != 4) ||
      (ch != 3 && ch != 4) || band_h <= 0)
    return 0;
  if (fused < 0 || fused > 2) return 0;
  auto sat_add = [](uint64_t a, uint64_t b) {
    uint64_t r = a + b;
    return r < a ? (uint64_t)SIZE_MAX : r;
  };
  auto sat_mul = [](uint64_t a, uint64_t b) -> uint64_t {
    if (a == 0 || b == 0) return 0;
    if (a > (uint64_t)SIZE_MAX / b) return (uint64_t)SIZE_MAX;
    return a * b;
  };
  uint64_t W = (uint64_t)in_w * (uint64_t)scale;
  uint64_t H = (uint64_t)in_h * (uint64_t)scale;
  uint64_t px_in = (uint64_t)in_w * (uint64_t)in_h * (uint64_t)ch;
  uint64_t px_out = W * H * (uint64_t)ch;
  uint64_t total = 0;
  // WASM base heap (INITIAL_MEMORY) + instance overhead.
  total = sat_add(total, 67108864ull + (1ull << 20));
  // Retained input worst case: full linear image + push staging.
  total = sat_add(total, sat_mul(px_in, 4));
  total = sat_add(total, sat_mul((uint64_t)in_w * (uint64_t)ch * 256, 4));
  // Strip scratch: input strip + upscaled strip (+ fused tmp/big) + smooth d
  // + band float/bytes. Halo overestimated flat.
  uint64_t strip_in_rows = (uint64_t)band_h / (uint64_t)scale + 64;
  uint64_t strip_out_rows = (uint64_t)band_h + 256;
  total = sat_add(total, sat_mul(strip_in_rows * (uint64_t)in_w * (uint64_t)ch, 4));
  total = sat_add(total, sat_mul(strip_out_rows * W * (uint64_t)ch, 4));
  if (fused && scale == 4)
    total = sat_add(total, sat_mul(strip_out_rows * W * (uint64_t)ch, 8));
  total = sat_add(total, sat_mul(strip_in_rows * (uint64_t)in_w * (uint64_t)ch, 4));
  total = sat_add(total, sat_mul((uint64_t)band_h * W * (uint64_t)ch, 5));
  // PNG writer: row scratch + deflate window + undrained chunks (soak < 1 MB).
  total = sat_add(total, sat_mul(W * (uint64_t)ch, 8));
  total = sat_add(total, 2ull << 20);
  // Blob-route output accumulation + PNG overhead + bounded preview.
  total = sat_add(total, sat_mul(px_out, 2));
  total = sat_add(total, (1600ull * 1600ull * 4) + (1600ull * 4 * 4));
  size_t out = total > (uint64_t)SIZE_MAX ? (size_t)SIZE_MAX : (size_t)total;
  return out;
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
