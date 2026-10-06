#pragma once
#include <vector>

namespace vice {

struct IbpResult {
  std::vector<double> x;  // (lw*s)×(lh*s)
  std::vector<double> residuals;
};

// Guarded IBP: lanczos3 x0, T passes of x ← Π(clamp(x + BilinearUp(y − DHx))).
// Returns exact-range-space estimate (residual ~1e-12 in float64).
IbpResult reconstruct_ibp(const std::vector<double>& lr, int lw, int lh, int s, int iters);

}  // namespace vice
