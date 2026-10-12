#include "descriptors.h"
#include <algorithm>
#include <cmath>
#include <cstddef>

namespace vice {

namespace {
int clamp_i(int i, int n) { return i < 0 ? 0 : i >= n ? n - 1 : i; }
}  // namespace

DescFields compute_descriptors(const std::vector<double>& d, int w, int h) {
  DescFields f;
  f.w = w;
  f.h = h;
  const size_t n = d.size();
  f.edge.assign(n, 0.0);
  f.alias.assign(n, 0.0);
  f.lo.assign(n, 0.0);
  f.hi.assign(n, 0.0);
  std::vector<double> gx(n), gy(n);
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      const int xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const int ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
      gx[(size_t)y * w + x] = (d[(size_t)y * w + xp] - d[(size_t)y * w + xm]) / (xp - xm);
      gy[(size_t)y * w + x] = (d[(size_t)yp * w + x] - d[(size_t)ym * w + x]) / (yp - ym);
    }
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      double sxx = 0.0, sxy = 0.0, syy = 0.0, mean = 0.0, m2 = 0.0;
      double mn = 1e300, mx = -1e300;
      int cnt = 0;
      for (int dy = -1; dy <= 1; dy++)
        for (int dx = -1; dx <= 1; dx++) {
          const int ix = clamp_i(x + dx, w), iy = clamp_i(y + dy, h);
          const size_t i = (size_t)iy * w + ix;
          sxx += gx[i] * gx[i];
          sxy += gx[i] * gy[i];
          syy += gy[i] * gy[i];
          mean += d[i];
          m2 += d[i] * d[i];
          mn = std::min(mn, d[i]);
          mx = std::max(mx, d[i]);
          cnt++;
        }
      const size_t i = (size_t)y * w + x;
      mean /= cnt;
      const double var = std::max(0.0, m2 / cnt - mean * mean);
      const double tr = sxx + syy;
      const double det = sxx * syy - sxy * sxy;
      const double disc = std::sqrt(std::max(0.0, tr * tr - 4.0 * det));
      const double l1 = (tr + disc) / 2.0, l2 = (tr - disc) / 2.0;
      const double coh = l1 + l2 > 1e-12 ? (l1 - l2) / (l1 + l2) : 0.0;
      const double gm = std::hypot(gx[i], gy[i]);
      const double gn = std::min(1.0, gm / 32.0);
      const double vn = std::min(1.0, var / 1600.0);
      const double hp = std::min(1.0, std::fabs(d[i] - mean) / 24.0);
      f.edge[i] = coh * gn;
      f.alias[i] = hp * (1.0 - coh) * vn;
      f.lo[i] = mn;
      f.hi[i] = mx;
    }
  return f;
}

double sample_field(const std::vector<double>& f, int lw, int lh, int hx, int hy, int s) {
  const double cx = (hx + 0.5) / s - 0.5;
  const double cy = (hy + 0.5) / s - 0.5;
  const int x0 = (int)std::floor(cx), y0 = (int)std::floor(cy);
  const double fx = cx - x0, fy = cy - y0;
  auto at = [&](int x, int y) { return f[(size_t)clamp_i(y, lh) * lw + clamp_i(x, lw)]; };
  return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) +
         at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
}

ArtifactStats analyze_artifacts(const std::vector<double>& lr, int w, int h) {
  ArtifactStats st;
  if (w < 2 || h < 2 || lr.size() < (size_t)w * h) return st;

  double sum_diff_h[8] = {0.0}, cnt_diff_h[8] = {0.0};
  double tot_diff_h = 0.0, tot_cnt_h = 0.0;
  for (int y = 0; y < h; y++) {
    for (int x = 1; x < w; x++) {
      const double d = std::fabs(lr[(size_t)y * w + x] - lr[(size_t)y * w + x - 1]);
      int rem = x % 8;
      sum_diff_h[rem] += d;
      cnt_diff_h[rem] += 1.0;
      tot_diff_h += d;
      tot_cnt_h += 1.0;
    }
  }

  double sum_diff_v[8] = {0.0}, cnt_diff_v[8] = {0.0};
  double tot_diff_v = 0.0, tot_cnt_v = 0.0;
  for (int y = 1; y < h; y++) {
    for (int x = 0; x < w; x++) {
      const double d = std::fabs(lr[(size_t)y * w + x] - lr[(size_t)(y - 1) * w + x]);
      int rem = y % 8;
      sum_diff_v[rem] += d;
      cnt_diff_v[rem] += 1.0;
      tot_diff_v += d;
      tot_cnt_v += 1.0;
    }
  }

  // Scan offsets ox in [0..7] to find the boundary phase maximizing the ratio
  // of boundary-mean to interior-mean difference. Tie-break keeps offset 0.
  int best_ox = 0;
  double best_rh = 1.0;
  for (int ox = 0; ox < 8; ox++) {
    const double bnd = sum_diff_h[ox];
    const double nb = cnt_diff_h[ox];
    const double in = tot_diff_h - bnd;
    const double ni = tot_cnt_h - nb;
    if (nb > 0.0) {
      double r = 1.0;
      if (in > 0.0 && ni > 0.0) {
        r = (bnd / nb) / (in / ni);
      } else if (bnd > 0.0) {
        r = 1000.0;
      }
      if (r > best_rh) {
        best_rh = r;
        best_ox = ox;
      }
    }
  }

  int best_oy = 0;
  double best_rv = 1.0;
  for (int oy = 0; oy < 8; oy++) {
    const double bnd = sum_diff_v[oy];
    const double nb = cnt_diff_v[oy];
    const double in = tot_diff_v - bnd;
    const double ni = tot_cnt_v - nb;
    if (nb > 0.0) {
      double r = 1.0;
      if (in > 0.0 && ni > 0.0) {
        r = (bnd / nb) / (in / ni);
      } else if (bnd > 0.0) {
        r = 1000.0;
      }
      if (r > best_rv) {
        best_rv = r;
        best_oy = oy;
      }
    }
  }

  st.block_ratio_h = best_rh;
  st.block_ratio_v = best_rv;
  st.phase_x = best_ox;
  st.phase_y = best_oy;

  const double m = st.block_ratio_h > st.block_ratio_v ? st.block_ratio_h : st.block_ratio_v;
  if (m > JPEG_RATIO_THRESHOLD) {
    st.jpeg_present = true;
    st.jpeg_strength = m - JPEG_RATIO_THRESHOLD;
    if (st.jpeg_strength > 1.0) st.jpeg_strength = 1.0;
  }
  return st;
}

}  // namespace vice
