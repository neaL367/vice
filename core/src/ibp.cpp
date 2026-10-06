#include "ibp.h"
#include <algorithm>
#include <limits>
#include "forward.h"
#include "kernels.h"

namespace vice {

IbpResult reconstruct_ibp(const std::vector<double>& lr, int lw, int lh, int s, int iters) {
  double lo = std::numeric_limits<double>::infinity();
  double hi = -std::numeric_limits<double>::infinity();
  for (double v : lr) {
    lo = std::min(lo, v);
    hi = std::max(hi, v);
  }
  std::vector<double> x = upsample(lr, lw, lh, s, Kernel::Lanczos3);
  IbpResult r;
  r.x = x;
  r.residuals.push_back(forward_residual(x, lw * s, lh * s, lr, lw, lh, s));
  std::vector<double> rlr(lr.size());
  for (int t = 0; t < iters; t++) {
    auto pred = simulate_forward(x, lw * s, lh * s, s);
    for (size_t i = 0; i < rlr.size(); i++) rlr[i] = lr[i] - pred[i];
    auto corr = upsample(rlr, lw, lh, s, Kernel::Bilinear);
    std::vector<double> nd(x.size());
    for (size_t i = 0; i < nd.size(); i++) {
      double v = x[i] + corr[i];
      nd[i] = v < lo ? lo : v > hi ? hi : v;
    }
    x = project_box(nd, lw * s, lh * s, lr, lw, lh, s);
    r.residuals.push_back(forward_residual(x, lw * s, lh * s, lr, lw, lh, s));
  }
  r.x = x;
  return r;
}

}  // namespace vice
