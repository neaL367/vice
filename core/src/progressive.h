#pragma once
#include <vector>

namespace vice {

struct StageReport {
  int scale = 0;
  double residual_vs_y = 0.0;  // ‖D_s x_s − y‖ after the stage (must stay ~0)
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
                                          int target_scale, int iters);

}  // namespace vice
