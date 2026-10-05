#pragma once

// Single copy of the exact clamp-aware box projection kernel, shared by the
// full-image kernels (project.cpp) and the streaming strip renderer.
// One s×s output block is shifted by a per-block scalar d such that
// mean(clamp(v + d, 0, 1)) equals the source pixel: [0, 1] range and exact
// residual even on saturated content. Blocks are independent: callers may
// split block ranges across threads.
//
// y_px: one source pixel (c floats). raw_block: top-left of the s×s patch in
// a full-width (out_w) row-major layout. s is 2, 3, or 4.
static inline void vice_clamp_project_block(const float* y_px, float* raw_block, int out_w, int s,
                                            int c) {
  const int N = s * s;
  const double inv_s2 = 1.0 / (double)N;
  for (int ch = 0; ch < c; ++ch) {
    float orig = y_px[ch];
    if (orig <= 0.0f) {
      for (int dy = 0; dy < s; ++dy)
        for (int dx = 0; dx < s; ++dx) raw_block[((size_t)dy * out_w + dx) * c + ch] = 0.0f;
      continue;
    }
    if (orig >= 1.0f) {
      for (int dy = 0; dy < s; ++dy)
        for (int dx = 0; dx < s; ++dx) raw_block[((size_t)dy * out_w + dx) * c + ch] = 1.0f;
      continue;
    }

    float vals[16];
    float min_v = 1e30f, max_v = -1e30f;
    double sum = 0.0;
    for (int dy = 0; dy < s; ++dy) {
      for (int dx = 0; dx < s; ++dx) {
        int idx = dy * s + dx;
        float v = raw_block[((size_t)dy * out_w + dx) * c + ch];
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
        for (int dx = 0; dx < s; ++dx) raw_block[((size_t)dy * out_w + dx) * c + ch] += d;
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
      if (cur_sum * inv_s2 < (double)orig)
        lo = mid;
      else
        hi = mid;
    }
    double d_opt = 0.5 * (lo + hi);
    for (int dy = 0; dy < s; ++dy) {
      for (int dx = 0; dx < s; ++dx) {
        float v = (float)((double)vals[dy * s + dx] + d_opt);
        if (v < 0.0f) v = 0.0f;
        else if (v > 1.0f) v = 1.0f;
        raw_block[((size_t)dy * out_w + dx) * c + ch] = v;
      }
    }
  }
}
