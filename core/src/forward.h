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

// Exact box projection Π: every s×s block mean equals the LR sample.
std::vector<double> project_box(const std::vector<double>& hr, int w, int h,
                                const std::vector<double>& lr, int lw, int lh, int s);

}  // namespace vice
