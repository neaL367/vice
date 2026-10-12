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
  const int hw = lw * s;
  const int hh = lh * s;
  const size_t hr_size = (size_t)hw * hh;
  std::vector<double> x =
      (x0 && x0->size() == hr_size) ? *x0 : upsample(lr, lw, lh, s, Kernel::Lanczos3);
  IbpResult r;
  r.residuals.push_back(forward_residual(x, hw, hh, lr, lw, lh, s));
  if (iters == 0) {
    r.x = std::move(x);
    r.iters_used = 0;
    return r;
  }
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

  UpsamplePlan bilinear_plan = make_upsample_plan(lw, lh, s, Kernel::Bilinear);
  std::vector<double> rlr(lr.size());
  std::vector<double> horiz_buf((size_t)hw * lh);
  std::vector<double> corr(hr_size);
  std::vector<double> corrected(hr_size);
  std::vector<double> reg(hr_size);
  std::vector<double> dbl;
  if (use_deblock) dbl.resize(hr_size);

  for (int t = 0; t < iters; t++) {
    compute_residual_lr(x, hw, hh, lr, lw, lh, s, rlr);
    upsample_apply(bilinear_plan, rlr, corr, horiz_buf);
    for (size_t i = 0; i < hr_size; i++) corrected[i] = x[i] + corr[i];
    regularization_step(corrected, hw, hh, maps, REG_ETA1_DEFAULT, REG_ETA2_DEFAULT, reg);
    if (use_deblock) {
      deblock_correction(corrected, hw, hh, s, art.jpeg_strength, *deblock,
                         art.phase_x, art.phase_y, dbl);
      for (size_t i = 0; i < hr_size; i++) {
        double v = corrected[i] - reg[i] + dbl[i];
        corrected[i] = v < lo ? lo : v > hi ? hi : v;
      }
    } else {
      for (size_t i = 0; i < hr_size; i++) {
        double v = corrected[i] - reg[i];
        corrected[i] = v < lo ? lo : v > hi ? hi : v;
      }
    }
    project_box_inplace(corrected, hw, hh, lr, lw, lh, s);
    x.swap(corrected);
    r.residuals.push_back(forward_residual(x, hw, hh, lr, lw, lh, s));
  }
  r.x = std::move(x);
  r.iters_used = iters;
  return r;
}

namespace {
// One guarded pass shared by the fixed and auto loops (identical floats).
void ibp_pass(const std::vector<double>& lr, int lw, int lh, int s, double lo, double hi,
              const RegMaps& maps, const UpsamplePlan& plan,
              std::vector<double>& rlr, std::vector<double>& horiz_buf,
              std::vector<double>& corr, std::vector<double>& corrected,
              std::vector<double>& reg, std::vector<double>& x) {
  const int hw = lw * s;
  const int hh = lh * s;
  const size_t hr_size = (size_t)hw * hh;
  compute_residual_lr(x, hw, hh, lr, lw, lh, s, rlr);
  upsample_apply(plan, rlr, corr, horiz_buf);
  for (size_t i = 0; i < hr_size; i++) corrected[i] = x[i] + corr[i];
  regularization_step(corrected, hw, hh, maps, REG_ETA1_DEFAULT, REG_ETA2_DEFAULT, reg);
  for (size_t i = 0; i < hr_size; i++) {
    double v = corrected[i] - reg[i];
    corrected[i] = v < lo ? lo : v > hi ? hi : v;
  }
  project_box_inplace(corrected, hw, hh, lr, lw, lh, s);
  x.swap(corrected);
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
  const int hw = lw * s;
  const int hh = lh * s;
  const size_t hr_size = (size_t)hw * hh;
  std::vector<double> x =
      (x0 && x0->size() == hr_size) ? *x0 : upsample(lr, lw, lh, s, Kernel::Lanczos3);
  IbpResult r;
  r.residuals.push_back(forward_residual(x, hw, hh, lr, lw, lh, s));
  RegMaps maps = regularization_maps(lr, lw, lh, s);
  UpsamplePlan bilinear_plan = make_upsample_plan(lw, lh, s, Kernel::Bilinear);
  std::vector<double> rlr(lr.size());
  std::vector<double> horiz_buf((size_t)hw * lh);
  std::vector<double> corr(hr_size);
  std::vector<double> corrected(hr_size);
  std::vector<double> reg(hr_size);

  int done = 0;
  while (done < hi_it) {
    ibp_pass(lr, lw, lh, s, lo, hi, maps, bilinear_plan, rlr, horiz_buf, corr, corrected, reg, x);
    r.residuals.push_back(forward_residual(x, hw, hh, lr, lw, lh, s));
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
  r.x = std::move(x);
  r.iters_used = done;
  return r;
}

}  // namespace vice
