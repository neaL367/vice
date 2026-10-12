#include "regularization.h"
#include <cmath>

namespace vice {

std::vector<double> laplacian(const std::vector<double>& d, int w, int h) {
  std::vector<double> out(d.size(), 0.0);
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) {
      const int xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const int ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
      const size_t i = (size_t)y * w + x;
      out[i] = 4 * d[i] - d[(size_t)y * w + xm] - d[(size_t)y * w + xp] - d[(size_t)ym * w + x] -
               d[(size_t)yp * w + x];
    }
  return out;
}

namespace {
inline int clamp_coord(int i, int n) { return i < 0 ? 0 : i >= n ? n - 1 : i; }
}

RegMaps regularization_maps(const std::vector<double>& lr, int lw, int lh, int s) {
  DescFields f = compute_descriptors(lr, lw, lh);
  RegMaps m;
  m.hw = lw * s;
  m.hh = lh * s;
  const size_t total_px = (size_t)m.hw * m.hh;
  m.wFreq.resize(total_px);
  m.vEdge.resize(total_px);
  m.loHR.resize(total_px);
  m.hiHR.resize(total_px);

  for (int y = 0; y < m.hh; y++) {
    const double cy = (y + 0.5) / s - 0.5;
    const int y0 = (int)std::floor(cy);
    const double fy = cy - y0;
    const int cy0 = clamp_coord(y0, lh);
    const int cy1 = clamp_coord(y0 + 1, lh);
    const size_t row0 = (size_t)cy0 * lw;
    const size_t row1 = (size_t)cy1 * lw;
    const double w_y0 = 1.0 - fy;
    const double w_y1 = fy;
    const size_t out_row = (size_t)y * m.hw;

    for (int x = 0; x < m.hw; x++) {
      const double cx = (x + 0.5) / s - 0.5;
      const int x0 = (int)std::floor(cx);
      const double fx = cx - x0;
      const int cx0 = clamp_coord(x0, lw);
      const int cx1 = clamp_coord(x0 + 1, lw);

      const double w00 = (1.0 - fx) * w_y0;
      const double w10 = fx * w_y0;
      const double w01 = (1.0 - fx) * w_y1;
      const double w11 = fx * w_y1;

      const size_t i00 = row0 + cx0;
      const size_t i10 = row0 + cx1;
      const size_t i01 = row1 + cx0;
      const size_t i11 = row1 + cx1;

      const size_t out_i = out_row + x;
      m.wFreq[out_i] = f.alias[i00] * w00 + f.alias[i10] * w10 + f.alias[i01] * w01 + f.alias[i11] * w11;
      m.vEdge[out_i] = f.edge[i00] * w00 + f.edge[i10] * w10 + f.edge[i01] * w01 + f.edge[i11] * w11;
      m.loHR[out_i]  = f.lo[i00] * w00 + f.lo[i10] * w10 + f.lo[i01] * w01 + f.lo[i11] * w11;
      m.hiHR[out_i]  = f.hi[i00] * w00 + f.hi[i10] * w10 + f.hi[i01] * w01 + f.hi[i11] * w11;
    }
  }
  return m;
}

void regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                         double eta1, double eta2, std::vector<double>& out) {
  if (out.size() != x.size()) out.assign(x.size(), 0.0);
  else std::fill(out.begin(), out.end(), 0.0);

  if (eta1 != 0.0) {
    auto lap = laplacian(x, w, h);
    std::vector<double> weighted(lap.size());
    for (size_t i = 0; i < weighted.size(); i++) weighted[i] = m.wFreq[i] * lap[i];
    auto lap2 = laplacian(weighted, w, h);
    for (size_t i = 0; i < out.size(); i++) {
      double over = 0.0;
      if (x[i] > m.hiHR[i])
        over = x[i] - m.hiHR[i];
      else if (x[i] < m.loHR[i])
        over = x[i] - m.loHR[i];
      out[i] = eta1 * 2 * lap2[i] + eta2 * 2 * m.vEdge[i] * over;
    }
  } else if (eta2 != 0.0) {
    const double two_eta2 = eta2 * 2.0;
    const size_t n = out.size();
    for (size_t i = 0; i < n; i++) {
      double over = 0.0;
      if (x[i] > m.hiHR[i])
        over = x[i] - m.hiHR[i];
      else if (x[i] < m.loHR[i])
        over = x[i] - m.loHR[i];
      out[i] = two_eta2 * m.vEdge[i] * over;
    }
  }
}

std::vector<double> regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                                        double eta1, double eta2) {
  std::vector<double> out(x.size(), 0.0);
  regularization_step(x, w, h, m, eta1, eta2, out);
  return out;
}

void deblock_correction(const std::vector<double>& x, int w, int h, int s,
                        double strength, const DeblockParams& p,
                        int phase_x, int phase_y, std::vector<double>& out) {
  if (out.size() != x.size()) out.assign(x.size(), 0.0);
  else std::fill(out.begin(), out.end(), 0.0);
  if (p.eta3 == 0.0 || strength == 0.0) return;
  const long period = 8L * s;
  const double k = p.eta3 * strength;
  const long shift_x = (static_cast<long>(phase_x) * s) % period;
  const long shift_y = (static_cast<long>(phase_y) * s) % period;

  std::vector<uint8_t> is_rem_x(w, 0), is_rem_xp1(w, 0);
  for (int xx = 0; xx < w; xx++) {
    const long rem_x = ((xx - shift_x) % period + period) % period;
    const long rem_xp1 = ((xx + 1 - shift_x) % period + period) % period;
    if (rem_x == 0 && xx > 0) is_rem_x[xx] = 1;
    if (rem_xp1 == 0 && xx < w - 1) is_rem_xp1[xx] = 1;
  }

  std::vector<uint8_t> is_rem_y(h, 0), is_rem_yp1(h, 0);
  for (int y = 0; y < h; y++) {
    const long rem_y = ((y - shift_y) % period + period) % period;
    const long rem_yp1 = ((y + 1 - shift_y) % period + period) % period;
    if (rem_y == 0 && y > 0) is_rem_y[y] = 1;
    if (rem_yp1 == 0 && y < h - 1) is_rem_yp1[y] = 1;
  }

  for (int y = 0; y < h; y++) {
    const uint8_t ry0 = is_rem_y[y];
    const uint8_t ry1 = is_rem_yp1[y];
    const size_t row_idx = (size_t)y * w;
    for (int xx = 0; xx < w; xx++) {
      const uint8_t rx0 = is_rem_x[xx];
      const uint8_t rx1 = is_rem_xp1[xx];
      if (!rx0 && !rx1 && !ry0 && !ry1) continue;

      const size_t i = row_idx + xx;
      double c = 0.0;
      if (rx0) c += x[i - 1] - x[i];
      if (rx1) c += x[i + 1] - x[i];
      if (ry0) c += x[i - (size_t)w] - x[i];
      if (ry1) c += x[i + (size_t)w] - x[i];
      double v = k * c;
      if (v < -p.block_cap)
        v = -p.block_cap;
      else if (v > p.block_cap)
        v = p.block_cap;
      out[i] = v;
    }
  }
}

std::vector<double> deblock_correction(const std::vector<double>& x, int w, int h, int s,
                                       double strength, const DeblockParams& p,
                                       int phase_x, int phase_y) {
  std::vector<double> out(x.size(), 0.0);
  deblock_correction(x, w, h, s, strength, p, phase_x, phase_y, out);
  return out;
}

}  // namespace vice
