#pragma once
#include <vector>

namespace vice {

struct IbpResult {
  std::vector<double> x;  // (lw*s)×(lh*s)
  std::vector<double> residuals;
};

// Guarded IBP: lanczos3 x0 (or explicit x0 when provided — used by staged
// progressive reconstruction), T passes of x ← Π(clamp(x + BilinearUp(y − DHx))).
// Clamp defaults to the observation range; an explicit [lo,hi] override keeps
// tiled reconstruction consistent with whole-image runs. Returns
// exact-range-space estimate (residual ~1e-12 in float64).
IbpResult reconstruct_ibp(const std::vector<double>& lr, int lw, int lh, int s, int iters,
                           const std::vector<double>* x0 = nullptr,
                           const double* clamp_lo_hi = nullptr);

}  // namespace vice
