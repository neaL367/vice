#include "progressive.h"
#include <stdexcept>
#include "forward.h"
#include "ibp.h"
#include "kernels.h"

namespace vice {

ProgressiveResult reconstruct_progressive(const std::vector<double>& y, int lw, int lh,
                                          int target_scale, int iters,
                                          const double* clamp_lo_hi) {
  if (target_scale != 2 && target_scale != 4 && target_scale != 8)
    throw std::invalid_argument("target_scale must be 2, 4, or 8");
  ProgressiveResult out;
  std::vector<double> prior;
  bool have_prior = false;
  for (int s = 2;; s *= 2) {
    IbpResult r;
    if (!have_prior) {
      r = reconstruct_ibp(y, lw, lh, s, iters, nullptr, clamp_lo_hi);
    } else {
      auto init = upsample(prior, lw * (s / 2), lh * (s / 2), 2, Kernel::Lanczos3);
      r = reconstruct_ibp(y, lw, lh, s, iters, &init, clamp_lo_hi);
    }
    StageReport st;
    st.scale = s;
    st.residual_vs_y = forward_residual(r.x, lw * s, lh * s, y, lw, lh, s);
    st.x = r.x;
    out.stages.push_back(std::move(st));
    if (s == target_scale) {
      out.final = out.stages.back().x;
      return out;
    }
    prior = out.stages.back().x;
    have_prior = true;
  }
}

}  // namespace vice
