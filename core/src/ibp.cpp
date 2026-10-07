#include "ibp.h"
#include <algorithm>
#include <limits>
#include "forward.h"
#include "kernels.h"
#include "regularization.h"

namespace vice {

IbpResult reconstruct_ibp(const std::vector<double>& lr, int lw, int lh, int s, int iters,
                           const std::vector<double>* x0, const double* clamp_lo_hi) {
  double lo = std::numeric_limits<double>::infinity();
  double hi = -std::numeric_limits<double>::infinity();
  for (double v : lr) {
    lo = std::min(lo, v);
    hi = std::max(hi, v);
  }
  if (clamp_lo_hi) {
    lo = clamp_lo_hi[0];
    hi = clamp_lo_hi[1];
  }
  std::vector<double> x =
      (x0 && x0->size() == (size_t)lw * s * (size_t)lh * s) ? *x0 : upsample(lr, lw, lh, s, Kernel::Lanczos3);
  IbpResult r;
  r.x = x;
  r.residuals.push_back(forward_residual(x, lw * s, lh * s, lr, lw, lh, s));
  // Default objective includes R_edge-only regularization (matches the TS
  // reference default): penalize overshoot during reconstruction, keep range.
  RegMaps maps = regularization_maps(lr, lw, lh, s);
  std::vector<double> rlr(lr.size());
  for (int t = 0; t < iters; t++) {
    auto pred = simulate_forward(x, lw * s, lh * s, s);
    for (size_t i = 0; i < rlr.size(); i++) rlr[i] = lr[i] - pred[i];
    auto corr = upsample(rlr, lw, lh, s, Kernel::Bilinear);
    std::vector<double> corrected(x.size());
    for (size_t i = 0; i < corrected.size(); i++) corrected[i] = x[i] + corr[i];
    auto reg = regularization_step(corrected, lw * s, lh * s, maps, REG_ETA1_DEFAULT, REG_ETA2_DEFAULT);
    std::vector<double> nd(x.size());
    for (size_t i = 0; i < nd.size(); i++) {
      double v = corrected[i] - reg[i];
      nd[i] = v < lo ? lo : v > hi ? hi : v;
    }
    x = project_box(nd, lw * s, lh * s, lr, lw, lh, s);
    r.residuals.push_back(forward_residual(x, lw * s, lh * s, lr, lw, lh, s));
  }
  r.x = x;
  return r;
}

}  // namespace vice
