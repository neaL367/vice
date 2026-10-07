#pragma once
#include <vector>

namespace vice {

struct ShiftEst {
  double dx = 0.0;
  double dy = 0.0;
  double confidence = 0.0;  // 1 − best/second-best SSD over distinct minima
};

struct BurstResult {
  std::vector<double> x;
  std::vector<ShiftEst> shifts;
  std::vector<int> kept;  // frame indices fused (0 = reference)
  double residual_vs_ref = 0.0;
};

// SSD shift of mov relative to ref (LR pixels, ±1 range, 0.25 precision).
// Gradient-magnitude fields, coarse (±1 step 0.5) to fine (±0.25).
ShiftEst estimate_shift(const std::vector<double>& ref, const std::vector<double>& mov, int w, int h);

// Joint guarded loop over frames (all lw×lh) at scale s. Frame 0 is the
// reference. Null shifts = estimate + gate (confidence ≥ min_confidence,
// aliasing trap, prediction gate); <2 kept falls back to single-frame.
// Explicit shifts skip registration (oracle probes).
BurstResult reconstruct_burst(const std::vector<std::vector<double>>& frames, int lw, int lh,
                              int s, int iters, const std::vector<std::pair<double, double>>* shifts,
                              double min_confidence);

}  // namespace vice
