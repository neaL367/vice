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

RegMaps regularization_maps(const std::vector<double>& lr, int lw, int lh, int s) {
  DescFields f = compute_descriptors(lr, lw, lh);
  RegMaps m;
  m.hw = lw * s;
  m.hh = lh * s;
  m.wFreq.assign((size_t)m.hw * m.hh, 0.0);
  m.vEdge.assign((size_t)m.hw * m.hh, 0.0);
  m.loHR.assign((size_t)m.hw * m.hh, 0.0);
  m.hiHR.assign((size_t)m.hw * m.hh, 0.0);
  for (int y = 0; y < m.hh; y++)
    for (int x = 0; x < m.hw; x++) {
      const size_t i = (size_t)y * m.hw + x;
      m.wFreq[i] = sample_field(f.alias, lw, lh, x, y, s);
      m.vEdge[i] = sample_field(f.edge, lw, lh, x, y, s);
      m.loHR[i] = sample_field(f.lo, lw, lh, x, y, s);
      m.hiHR[i] = sample_field(f.hi, lw, lh, x, y, s);
    }
  return m;
}

std::vector<double> regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                                        double eta1, double eta2) {
  std::vector<double> out(x.size(), 0.0);
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
    for (size_t i = 0; i < out.size(); i++) {
      double over = 0.0;
      if (x[i] > m.hiHR[i])
        over = x[i] - m.hiHR[i];
      else if (x[i] < m.loHR[i])
        over = x[i] - m.loHR[i];
      out[i] = two_eta2 * m.vEdge[i] * over;
    }
  }
  return out;
}

std::vector<double> deblock_correction(const std::vector<double>& x, int w, int h, int s,
                                       double strength, const DeblockParams& p,
                                       int phase_x, int phase_y) {
  std::vector<double> out(x.size(), 0.0);
  if (p.eta3 == 0.0 || strength == 0.0) return out;
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
  return out;
}

}  // namespace vice
