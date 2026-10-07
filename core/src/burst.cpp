#include "burst.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include "forward.h"
#include "ibp.h"
#include "kernels.h"

namespace vice {

namespace {
double ssd_field(const std::vector<double>& a, const std::vector<double>& b) {
  double s = 0.0;
  for (size_t i = 0; i < a.size(); i++) {
    const double d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

std::vector<double> gradient_magnitude(const std::vector<double>& src, int w, int h) {
  std::vector<double> out(static_cast<size_t>(w) * h, 0.0);
  for (int y = 0; y < h; y++) {
    for (int x = 0; x < w; x++) {
      const double xm = x > 0 ? src[(size_t)y * w + x - 1] : src[(size_t)y * w + x];
      const double xp = x < w - 1 ? src[(size_t)y * w + x + 1] : src[(size_t)y * w + x];
      const double ym = y > 0 ? src[(size_t)(y - 1) * w + x] : src[(size_t)y * w + x];
      const double yp = y < h - 1 ? src[(size_t)(y + 1) * w + x] : src[(size_t)y * w + x];
      out[(size_t)y * w + x] = std::fabs(xp - xm) + std::fabs(yp - ym);
    }
  }
  return out;
}
}  // namespace

ShiftEst estimate_shift(const std::vector<double>& ref, const std::vector<double>& mov, int w, int h) {
  const auto R = gradient_magnitude(ref, w, h);
  const auto M = gradient_magnitude(mov, w, h);
  const auto at = [&](double dx, double dy) { return ssd_field(R, shift_image(M, w, h, dx, dy)); };
  double bx = 0.0, by = 0.0, best = std::numeric_limits<double>::infinity();
  for (double dy = -1.0; dy <= 1.001; dy += 0.5)
    for (double dx = -1.0; dx <= 1.001; dx += 0.5) {
      const double s = at(dx, dy);
      if (s < best) {
        best = s;
        bx = dx;
        by = dy;
      }
    }
  double mx = bx, my = by;
  best = std::numeric_limits<double>::infinity();
  for (double dy = -0.5; dy <= 0.50001; dy += 0.5)
    for (double dx = -0.5; dx <= 0.50001; dx += 0.5) {
      const double s = at(bx + dx, by + dy);
      if (s < best) {
        best = s;
        mx = bx + dx;
        my = by + dy;
      }
    }
  best = std::numeric_limits<double>::infinity();
  double second = std::numeric_limits<double>::infinity();
  double fx = mx, fy = my;
  for (double dy = -0.25; dy <= 0.25001; dy += 0.25)
    for (double dx = -0.25; dx <= 0.25001; dx += 0.25) {
      if (dx == 0.0 && dy == 0.0) continue;
      const double s = at(mx + dx, my + dy);
      if (s < best) {
        second = best;
        best = s;
        fx = mx + dx;
        fy = my + dy;
      } else if (s < second) {
        second = s;
      }
    }
  const double mid = at(mx, my);
  if (mid < best) {
    second = best;
    best = mid;
    fx = mx;
    fy = my;
  } else if (mid < second) {
    second = mid;
  }
  double conf = 0.0;
  if (second != std::numeric_limits<double>::infinity() && second > 0.0 && std::fabs(fx) <= 1.5 &&
      std::fabs(fy) <= 1.5)
    conf = 1.0 - best / second;
  return {-fx, -fy, conf};
}

BurstResult reconstruct_burst(const std::vector<std::vector<double>>& frames, int lw, int lh,
                              int s, int iters,
                              const std::vector<std::pair<double, double>>* shifts,
                              double min_confidence) {
  if (frames.empty()) throw std::invalid_argument("need at least one frame");
  const auto& ref = frames[0];
  std::vector<ShiftEst> reg;
  reg.reserve(frames.size());
  if (shifts) {
    if (shifts->size() != frames.size()) throw std::invalid_argument("shift count mismatch");
    reg.push_back({0.0, 0.0, 1.0});
    for (size_t k = 1; k < frames.size(); k++)
      reg.push_back({(*shifts)[k].first, (*shifts)[k].second, 1.0});
  } else {
    reg.push_back({0.0, 0.0, 1.0});
    for (size_t k = 1; k < frames.size(); k++)
      reg.push_back(estimate_shift(ref, frames[k], lw, lh));
  }
  std::vector<int> use;
  for (size_t k = 0; k < frames.size(); k++) use.push_back((int)k);
  if (!shifts) {
    std::vector<int> kept = {0};
    for (size_t k = 1; k < frames.size(); k++)
      if (reg[k].confidence >= min_confidence) kept.push_back((int)k);
    use = kept;
    if (use.size() >= 2) {
      double maxShift = 0.0, diff = 0.0;
      for (int k : use) maxShift = std::max(maxShift, std::fabs(reg[k].dx) + std::fabs(reg[k].dy));
      for (size_t k = 1; k < frames.size(); k++)
        for (size_t i = 0; i < ref.size(); i++) diff += std::fabs(frames[k][i] - ref[i]);
      diff /= ref.size() * (frames.size() - 1);
      if (maxShift < 0.25 && diff > 0.5) use = {0};
    }
    if (use.size() >= 2) {
      const auto up0 = upsample(ref, lw, lh, s, Kernel::Lanczos3);
      const auto predErr = [&](double dx, double dy, const std::vector<double>& f) {
        const auto p = box_downsample(shift_image(up0, lw * s, lh * s, dx * s, dy * s), lw * s, lh * s, s);
        double e = 0.0;
        for (size_t i = 0; i < p.size(); i++) {
          const double d = p[i] - f[i];
          e += d * d;
        }
        return e / p.size();
      };
      double eEst = 0.0, eZero = 0.0;
      for (int k : use) {
        if (k == 0) continue;
        eEst += predErr(reg[k].dx, reg[k].dy, frames[k]);
        eZero += predErr(0.0, 0.0, frames[k]);
      }
      if (eEst >= eZero) use = {0};
    }
    if (use.size() < 2) use = {0};
  }
  double lo = std::numeric_limits<double>::infinity();
  double hi = -std::numeric_limits<double>::infinity();
  for (double v : ref) {
    lo = std::min(lo, v);
    hi = std::max(hi, v);
  }
  std::vector<double> x = upsample(ref, lw, lh, s, Kernel::Lanczos3);
  for (int t = 0; t < iters; t++) {
    std::vector<double> corr(x.size(), 0.0);
    for (int k : use) {
      const auto pred = box_downsample(shift_image(x, lw * s, lh * s, reg[k].dx * s, reg[k].dy * s), lw * s, lh * s, s);
      std::vector<double> rlr(pred.size(), 0.0);
      for (size_t i = 0; i < rlr.size(); i++) rlr[i] = frames[k][i] - pred[i];
      const auto up = upsample(rlr, lw, lh, s, Kernel::Bilinear);
      const auto back = shift_image(up, lw * s, lh * s, -reg[k].dx * s, -reg[k].dy * s);
      for (size_t i = 0; i < corr.size(); i++) corr[i] += back[i] / use.size();
    }
    std::vector<double> nd(x.size());
    for (size_t i = 0; i < nd.size(); i++) {
      const double v = x[i] + corr[i];
      nd[i] = v < lo ? lo : v > hi ? hi : v;
    }
    x = project_box(nd, lw * s, lh * s, ref, lw, lh, s);
  }
  BurstResult out;
  out.x = x;
  out.kept = use;
  for (size_t k = 0; k < frames.size(); k++) out.shifts.push_back({reg[k].dx, reg[k].dy, reg[k].confidence});
  out.residual_vs_ref = forward_residual(x, lw * s, lh * s, ref, lw, lh, s);
  return out;
}

}  // namespace vice
