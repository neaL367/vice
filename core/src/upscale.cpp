#include "vice.h"
#include "parallel.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace {

static double sinc(double x) {
  if (x == 0.0) return 1.0;
  double px = M_PI * x;
  return std::sin(px) / px;
}

static double lanczos3(double x) {
  double ax = std::abs(x);
  if (ax == 0.0) return 1.0;
  if (ax >= 3.0) return 0.0;
  return sinc(ax) * sinc(ax / 3.0);
}

constexpr int LANCZOS_LUT_STEPS = 256;

struct LanczosTable {
  float table[LANCZOS_LUT_STEPS * 6];

  LanczosTable() {
    for (int s = 0; s < LANCZOS_LUT_STEPS; ++s) {
      double frac = (double)s / (double)LANCZOS_LUT_STEPS;
      double sum = 0.0;
      double weights[6];
      for (int tap = -2; tap <= 3; ++tap) {
        double w = lanczos3(frac - (double)tap);
        weights[tap + 2] = w;
        sum += w;
      }
      double inv_sum = sum != 0.0 ? 1.0 / sum : 1.0;
      for (int i = 0; i < 6; ++i) {
        table[s * 6 + i] = (float)(weights[i] * inv_sum);
      }
    }
  }
};

static const LanczosTable g_lanczos_table;

inline int clamp_idx(int idx, int max_val) {
  return idx < 0 ? 0 : (idx > max_val ? max_val : idx);
}

} // namespace

void vice_tuning_defaults(ViceTuning* t) {
  if (!t) return;
  t->noise_floor = 0.008f;
  t->boost = 0.45f;
  t->boost_slope = 6.0f;
  t->wide_weight = 0.5f;
  t->steer_thresh = 0.15f;
  t->steer_weight = 0.2f;
  t->dering = 1.0f;
  t->sharpness = 0.35f;
  t->preset = 0;
  t->shock = 0.35f;
}

int vice_thread_workers(void) {
  return vice_worker_count(128); // representative band height for telemetry
}

int vice_upscale_lanczos_adaptive(const float* src, int w, int h, int c, int scale, float* dst) {
  ViceTuning t;
  vice_tuning_defaults(&t);
  return vice_upscale_lanczos_adaptive_ex(src, w, h, c, scale, dst, &t);
}

int vice_upscale_lanczos_adaptive_ex(const float* src, int w, int h, int c, int scale, float* dst,
                                     const ViceTuning* tuning) {
  if (!src || !dst || !tuning || w <= 0 || h <= 0 || (c != 3 && c != 4) ||
      (scale != 2 && scale != 3 && scale != 4))
    return -1;

  const int W = w * scale;
  const int H = h * scale;

  // Preset 2: Pixel Art (exact nearest-neighbor integer box expansion)
  if (tuning->preset == 2) {
    for (int by = 0; by < h; ++by) {
      for (int bx = 0; bx < w; ++bx) {
        for (int dy = 0; dy < scale; ++dy) {
          for (int dx = 0; dx < scale; ++dx) {
            for (int ch = 0; ch < c; ++ch) {
              dst[(((size_t)by * scale + dy) * W + bx * scale + dx) * c + ch] =
                  src[((size_t)by * w + bx) * c + ch];
            }
          }
        }
      }
    }
    return 0;
  }

  const float NOISE_FLOOR = tuning->noise_floor;
  // Preset 1 (Smooth / CGI): suppress acutance boosting to avoid ringing on rendered surfaces
  const float BOOST = tuning->preset == 1 ? 0.0f : tuning->boost;
  const float BOOST_SLOPE = tuning->boost_slope;
  const float WIDE_W = tuning->wide_weight;
  const float STEER_T = tuning->steer_thresh;
  const float STEER_W = tuning->steer_weight;
  const float DERING = std::max(0.0f, std::min(1.0f, tuning->dering));
  const float SHARPNESS = std::max(0.0f, std::min(1.0f, tuning->sharpness));

  // Pass 1: Horizontal scale (w x h -> W x h)
  std::vector<float> tmp((size_t)W * h * c);

  struct SampleCoordX {
    int base_idx;
    float frac;
    const float* weights;
  };
  std::vector<SampleCoordX> x_coords(W);
  for (int x = 0; x < W; ++x) {
    double src_x = ((double)x + 0.5) / (double)scale - 0.5;
    int base_idx = (int)std::floor(src_x);
    double frac = src_x - (double)base_idx;
    int lut_idx = (int)(frac * (double)LANCZOS_LUT_STEPS);
    if (lut_idx < 0) lut_idx = 0;
    if (lut_idx >= LANCZOS_LUT_STEPS) lut_idx = LANCZOS_LUT_STEPS - 1;
    x_coords[x].base_idx = base_idx;
    x_coords[x].frac = (float)frac;
    x_coords[x].weights = &g_lanczos_table.table[lut_idx * 6];
  }

  vice_parallel_for(0, h, [&](int y) {
    const size_t row_src = (size_t)y * w;
    const size_t row_dst = (size_t)y * W;

    for (int x = 0; x < W; ++x) {
      const SampleCoordX& sc = x_coords[x];
      const int base_idx = sc.base_idx;
      const float frac = sc.frac;
      const float* weights = sc.weights;

      for (int ch = 0; ch < c; ++ch) {
        float val = 0.0f;
        float min4 = 1e30f;
        float max4 = -1e30f;

        const float p0 = src[(row_src + clamp_idx(base_idx, w - 1)) * c + ch];
        const float p1 = src[(row_src + clamp_idx(base_idx + 1, w - 1)) * c + ch];
        const float pm1 = src[(row_src + clamp_idx(base_idx - 1, w - 1)) * c + ch];
        const float p2 = src[(row_src + clamp_idx(base_idx + 2, w - 1)) * c + ch];

        for (int tap = -2; tap <= 3; ++tap) {
          int sx = clamp_idx(base_idx + tap, w - 1);
          float pixel = src[(row_src + sx) * c + ch];
          val += pixel * weights[tap + 2];

          if (tap >= -1 && tap <= 2) {
            if (pixel < min4) min4 = pixel;
            if (pixel > max4) max4 = pixel;
          }
        }

        // Noise-gated multi-scale acutance boost
        if (BOOST > 0.0f) {
          float local_delta = std::abs(p1 - p0);
          float wide_delta = std::abs(p2 - pm1);
          float edge_energy = std::max(local_delta, WIDE_W * wide_delta);

          if (edge_energy > NOISE_FLOOR) {
            float linear_center = p0 + frac * (p1 - p0);
            float wide_center = 0.5f * (pm1 + p2);
            float curvature = linear_center - wide_center;
            float boost = BOOST * std::min(1.0f, (edge_energy - NOISE_FLOOR) * BOOST_SLOPE);
            val += boost * curvature;
          }
        }

        // Anti-ringing local envelope clamp (interpolated by DERING weight)
        if (DERING > 0.0f) {
          float clamped = val < min4 ? min4 : (val > max4 ? max4 : val);
          val = (1.0f - DERING) * val + DERING * clamped;
        }
        tmp[(row_dst + x) * c + ch] = val;
      }
    }
  });

  // Pass 2: Vertical scale with Diagonal Edge Steering (W x h -> W x H)
  const int step_x = scale;

  vice_parallel_for(0, H, [&](int y) {
    double src_y = ((double)y + 0.5) / (double)scale - 0.5;
    int base_idx = (int)std::floor(src_y);
    double frac = src_y - (double)base_idx;
    int lut_idx = (int)(frac * (double)LANCZOS_LUT_STEPS);
    if (lut_idx < 0) lut_idx = 0;
    if (lut_idx >= LANCZOS_LUT_STEPS) lut_idx = LANCZOS_LUT_STEPS - 1;
    const float* weights = &g_lanczos_table.table[lut_idx * 6];

    const size_t row_dst = (size_t)y * W;

    for (int x = 0; x < W; ++x) {
      for (int ch = 0; ch < c; ++ch) {
        float val = 0.0f;
        float min4 = 1e30f;
        float max4 = -1e30f;

        const float p0 = tmp[((size_t)clamp_idx(base_idx, h - 1) * W + x) * c + ch];
        const float p1 = tmp[((size_t)clamp_idx(base_idx + 1, h - 1) * W + x) * c + ch];
        const float pm1 = tmp[((size_t)clamp_idx(base_idx - 1, h - 1) * W + x) * c + ch];
        const float p2 = tmp[((size_t)clamp_idx(base_idx + 2, h - 1) * W + x) * c + ch];

        for (int tap = -2; tap <= 3; ++tap) {
          int sy = clamp_idx(base_idx + tap, h - 1);
          float pixel = tmp[((size_t)sy * W + x) * c + ch];
          val += pixel * weights[tap + 2];

          if (tap >= -1 && tap <= 2) {
            if (pixel < min4) min4 = pixel;
            if (pixel > max4) max4 = pixel;
          }
        }

        // Noise-gated multi-scale vertical acutance
        if (BOOST > 0.0f) {
          float local_delta = std::abs(p1 - p0);
          float wide_delta = std::abs(p2 - pm1);
          float edge_energy = std::max(local_delta, WIDE_W * wide_delta);

          if (edge_energy > NOISE_FLOOR) {
            float linear_center = p0 + (float)frac * (p1 - p0);
            float wide_center = 0.5f * (pm1 + p2);
            float curvature = linear_center - wide_center;
            float boost = BOOST * std::min(1.0f, (edge_energy - NOISE_FLOOR) * BOOST_SLOPE);
            val += boost * curvature;
          }
        }

        // Diagonal Edge Steering: evaluate 45° vs 135° cross gradients
        int x_l = std::max(0, x - step_x);
        int x_r = std::min(W - 1, x + step_x);
        int y_top = clamp_idx(base_idx, h - 1);
        int y_bot = clamp_idx(base_idx + 1, h - 1);

        float tl = tmp[((size_t)y_top * W + x_l) * c + ch];
        float tr = tmp[((size_t)y_top * W + x_r) * c + ch];
        float bl = tmp[((size_t)y_bot * W + x_l) * c + ch];
        float br = tmp[((size_t)y_bot * W + x_r) * c + ch];

        float d45 = std::abs(tr - bl);
        float d135 = std::abs(tl - br);
        float diff = d135 - d45;
        float total = d135 + d45 + 1e-4f;

        if (std::abs(diff) / total > STEER_T) {
          float diag_avg = diff > 0 ? 0.5f * (tr + bl) : 0.5f * (tl + br);
          float steer_weight = STEER_W * std::min(1.0f, std::abs(diff) / total);
          val = (1.0f - steer_weight) * val + steer_weight * diag_avg;
        }

        // Anti-ringing local envelope clamp (interpolated by DERING weight)
        if (DERING > 0.0f) {
          float clamped = val < min4 ? min4 : (val > max4 ? max4 : val);
          val = (1.0f - DERING) * val + DERING * clamped;
        }
        dst[(row_dst + x) * c + ch] = val;
      }
    }
  });

  // Pass 3: Null-Space Micro-Texture Sharpness Enhancement
  const int proc_c = (c == 4) ? 3 : c;
  if (SHARPNESS > 0.001f) {
    std::vector<float> sharp_tmp((size_t)W * H * c);
    std::memcpy(sharp_tmp.data(), dst, sharp_tmp.size() * sizeof(float));
    vice_parallel_for(0, H, [&](int y) {
      int y_prev = clamp_idx(y - 1, H - 1);
      int y_next = clamp_idx(y + 1, H - 1);
      for (int x = 0; x < W; ++x) {
        int x_prev = clamp_idx(x - 1, W - 1);
        int x_next = clamp_idx(x + 1, W - 1);
        for (int ch = 0; ch < proc_c; ++ch) {
          float center = dst[((size_t)y * W + x) * c + ch];
          float n = dst[((size_t)y_prev * W + x) * c + ch];
          float s = dst[((size_t)y_next * W + x) * c + ch];
          float w_px = dst[((size_t)y * W + x_prev) * c + ch];
          float e = dst[((size_t)y * W + x_next) * c + ch];
          float blur = 0.5f * center + 0.125f * (n + s + w_px + e);
          float hp = center - blur;
          sharp_tmp[((size_t)y * W + x) * c + ch] = center + SHARPNESS * hp;
        }
      }
    });
    std::memcpy(dst, sharp_tmp.data(), sharp_tmp.size() * sizeof(float));
  }

  // Pass 4: Vice 2.0 Coherence-Enhancing Shock PDE
  const float SHOCK = std::max(0.0f, std::min(1.0f, tuning->shock));
  if (tuning->preset == 0 && SHOCK > 0.001f) {
    float dt = 0.12f * std::min(1.0f, SHOCK);
    std::vector<float> shock_tmp((size_t)W * H * c);
    std::memcpy(shock_tmp.data(), dst, shock_tmp.size() * sizeof(float));

    for (int iter = 0; iter < 2; ++iter) {
      vice_parallel_for(0, H, [&](int y) {
        int ym1 = clamp_idx(y - 1, H - 1);
        int yp1 = clamp_idx(y + 1, H - 1);
        size_t row_y = (size_t)y * W;
        size_t row_ym1 = (size_t)ym1 * W;
        size_t row_yp1 = (size_t)yp1 * W;

        for (int x = 0; x < W; ++x) {
          int xm1 = clamp_idx(x - 1, W - 1);
          int xp1 = clamp_idx(x + 1, W - 1);

          for (int ch = 0; ch < proc_c; ++ch) {
            float center = dst[(row_y + x) * c + ch];
            float l = dst[(row_y + xm1) * c + ch];
            float r = dst[(row_y + xp1) * c + ch];
            float t = dst[(row_ym1 + x) * c + ch];
            float b = dst[(row_yp1 + x) * c + ch];
            float tl = dst[(row_ym1 + xm1) * c + ch];
            float tr = dst[(row_ym1 + xp1) * c + ch];
            float bl = dst[(row_yp1 + xm1) * c + ch];
            float br = dst[(row_yp1 + xp1) * c + ch];

            float ix = 0.5f * (r - l);
            float iy = 0.5f * (b - t);
            float grad_sq = ix * ix + iy * iy;
            float grad_norm = std::sqrt(grad_sq + 1e-5f);

            float ixx = r - 2.0f * center + l;
            float iyy = b - 2.0f * center + t;
            float ixy = 0.25f * (br - bl - tr + tl);

            float i_eta_eta = (ix * ix * ixx + 2.0f * ix * iy * ixy + iy * iy * iyy) / (grad_sq + 1e-5f);
            float shock = -std::tanh(5.0f * i_eta_eta) * grad_norm;
            float updated = center + dt * shock;
            shock_tmp[(row_y + x) * c + ch] = std::max(0.0f, std::min(1.0f, updated));
          }
        }
      });
      std::memcpy(dst, shock_tmp.data(), shock_tmp.size() * sizeof(float));
    }
  }

  return 0;
}
