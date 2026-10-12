#pragma once
#include <vector>

namespace vice {

// Box decimation D (s×s block means). Requires w,h divisible by s.
std::vector<double> box_downsample(const std::vector<double>& hr, int w, int h, int s);

// Full forward simulation DHx (H = identity in product v1).
std::vector<double> simulate_forward(const std::vector<double>& hr, int w, int h, int s);

// RMS residual ‖DHx − y‖ over LR pixels.
double forward_residual(const std::vector<double>& hr, int w, int h, const std::vector<double>& lr,
                        int lw, int lh, int s);

// Compute residual rlr = lr - DHx directly into destination vector without intermediate allocations.
void compute_residual_lr(const std::vector<double>& hr, int w, int h, const std::vector<double>& lr,
                         int lw, int lh, int s, std::vector<double>& rlr);

// Exact box projection Π: every s×s block mean equals the LR sample.
void project_box_inplace(std::vector<double>& hr, int w, int h,
                         const std::vector<double>& lr, int lw, int lh, int s);
std::vector<double> project_box(std::vector<double>&& hr, int w, int h,
                                const std::vector<double>& lr, int lw, int lh, int s);
std::vector<double> project_box(const std::vector<double>& hr, int w, int h,
                                const std::vector<double>& lr, int lw, int lh, int s);

}  // namespace vice
