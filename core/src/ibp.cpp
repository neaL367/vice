#include "ibp.h"
#include <algorithm>
#include <limits>
#include <stdexcept>
#include "forward.h"
#include "kernels.h"
#include "regularization.h"

namespace vice {

IbpResult reconstruct_ibp(const std::vector<double>& lr, int lw, int lh, int s, int iters,
                           const std::vector<double>* x0, const double* clamp_lo_hi,
                           const DeblockParams* deblock) {
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
  // JPEG evidence is a property of the observation: analyze once. A null
  // deblock (or absent evidence) keeps every pass on the legacy path.
  ArtifactStats art;
  bool use_deblock = false;
  if (deblock && deblock->eta3 != 0.0) {
    art = analyze_artifacts(lr, lw, lh);
    use_deblock = art.jpeg_present;
  }
  std::vector<double> rlr(lr.size());
  for (int t = 0; t < iters; t++) {
    auto pred = simulate_forward(x, lw * s, lh * s, s);
    for (size_t i = 0; i < rlr.size(); i++) rlr[i] = lr[i] - pred[i];
    auto corr = upsample(rlr, lw, lh, s, Kernel::Bilinear);
    std::vector<double> corrected(x.size());
    for (size_t i = 0; i < corrected.size(); i++) corrected[i] = x[i] + corr[i];
    auto reg = regularization_step(corrected, lw * s, lh * s, maps, REG_ETA1_DEFAULT, REG_ETA2_DEFAULT);
    std::vector<double> nd(x.size());
    if (use_deblock) {
      auto dbl =
          deblock_correction(corrected, lw * s, lh * s, s, art.jpeg_strength, *deblock,
                             art.phase_x, art.phase_y);
      for (size_t i = 0; i < nd.size(); i++) {
        double v = corrected[i] - reg[i] + dbl[i];
        nd[i] = v < lo ? lo : v > hi ? hi : v;
      }
    } else {
      for (size_t i = 0; i < nd.size(); i++) {
        double v = corrected[i] - reg[i];
        nd[i] = v < lo ? lo : v > hi ? hi : v;
      }
    }
    x = project_box(nd, lw * s, lh * s, lr, lw, lh, s);
    r.residuals.push_back(forward_residual(x, lw * s, lh * s, lr, lw, lh, s));
  }
  r.x = x;
  r.iters_used = iters;
  return r;
}

namespace {
// One guarded pass shared by the fixed and auto loops (identical floats).
void ibp_pass(const std::vector<double>& lr, int lw, int lh, int s, double lo, double hi,
              const RegMaps& maps, std::vector<double>& rlr, std::vector<double>& x) {
  auto pred = simulate_forward(x, lw * s, lh * s, s);
  for (size_t i = 0; i < rlr.size(); i++) rlr[i] = lr[i] - pred[i];
  auto corr = upsample(rlr, lw, lh, s, Kernel::Bilinear);
  std::vector<double> corrected(x.size());
  for (size_t i = 0; i < corrected.size(); i++) corrected[i] = x[i] + corr[i];
  auto reg = regularization_step(corrected, lw * s, lh * s, maps, REG_ETA1_DEFAULT,
                                 REG_ETA2_DEFAULT);
  std::vector<double> nd(x.size());
  for (size_t i = 0; i < nd.size(); i++) {
    double v = corrected[i] - reg[i];
    nd[i] = v < lo ? lo : v > hi ? hi : v;
  }
  x = project_box(nd, lw * s, lh * s, lr, lw, lh, s);
}
}  // namespace

IbpResult reconstruct_ibp_auto(const std::vector<double>& lr, int lw, int lh, int s,
                               const AutoIters& policy,
                               const std::vector<double>* x0, const double* clamp_lo_hi) {
  if (lr.empty() || lw <= 0 || lh <= 0 || s <= 0) throw std::invalid_argument("bad dims");
  const int lo_it = policy.min_iters < 0 ? 0 : policy.min_iters;
  const int hi_it = policy.max_iters < lo_it ? lo_it : policy.max_iters;
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
  RegMaps maps = regularization_maps(lr, lw, lh, s);
  std::vector<double> rlr(lr.size());
  int done = 0;
  while (done < hi_it) {
    ibp_pass(lr, lw, lh, s, lo, hi, maps, rlr, x);
    r.residuals.push_back(forward_residual(x, lw * s, lh * s, lr, lw, lh, s));
    done++;
    // Stall stop: strictly improving but relatively stalled, past the
    // minimum. A regression blip never stops the loop (it may recover).
    const double prev = r.residuals[(size_t)done - 1];
    const double curr = r.residuals[(size_t)done];
    if (done >= lo_it && curr <= prev) {
      const double denom = prev > 1e-15 ? prev : 1e-15;
      if ((prev - curr) / denom <= policy.stall_rel_tol) break;
    }
  }
  r.x = x;
  r.iters_used = done;
  return r;
}

}  // namespace vice
