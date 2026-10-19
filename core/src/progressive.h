#pragma once
#include <vector>

#include "regularization.h"

namespace vice {

struct StageReport {
  int scale = 0;
  double residual_vs_y = 0.0;  // ‖D_s x_s − y‖ after the stage (must stay ~0)
  // Memory contract: stage planes are NOT retained here — every stage
  // output is released after it inits the next stage; the only planes that
  // survive the call are ProgressiveResult.final. Keep the field (existing
  // ABI/report shape) but it is always empty.
  std::vector<double> x;
};

struct ProgressiveResult {
  std::vector<StageReport> stages;
  std::vector<double> final;
};

// Hierarchical chained reconstruction to targetScale (2, 4, or 8): every stage
// projects against the ORIGINAL y with its composite operator (D2/D4/D8); the
// prior stage output is init only (lanczos3 2x upsample). Mirrors
// research/ref/progressive.ts reconstructProgressive.
ProgressiveResult reconstruct_progressive(const std::vector<double>& y, int lw, int lh,
                                          int target_scale, int iters,
                                          const double* clamp_lo_hi = nullptr,
                                          const DeblockParams* deblock = nullptr);

}  // namespace vice
