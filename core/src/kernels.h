#pragma once
#include <vector>

namespace vice {

enum class Kernel { Nearest, Bilinear, Bicubic, Mitchell, Lanczos2, Lanczos3 };

double kernel_weight(Kernel k, double x);
double kernel_radius(Kernel k);

// Separable upscale with mirror (whole-sample symmetric) edges.
// src: h×w row-major. Returns (h*s)×(w*s). Weights renormalized per pixel.
struct FilterTap {
  int idx;
  double wt;
};

struct FilterSpan {
  int count;
  FilterTap taps[16];
};

struct UpsamplePlan {
  int w = 0, h = 0, s = 0;
  Kernel k = Kernel::Bilinear;
  int ow = 0, oh = 0;
  std::vector<FilterSpan> h_spans;
  std::vector<FilterSpan> v_spans;
};

UpsamplePlan make_upsample_plan(int w, int h, int s, Kernel k);
void upsample_apply(const UpsamplePlan& plan, const std::vector<double>& src,
                    std::vector<double>& out, std::vector<double>& horiz_buf);

std::vector<double> upsample(const std::vector<double>& src, int w, int h, int s, Kernel k);

// Bilinear subpixel translation with CLAMPED edges (matches research/ref
// burst.ts shiftImage exactly, including edge policy — required for TS
// cross-validation of the burst path).
void shift_image(const std::vector<double>& src, int w, int h, double dx, double dy, std::vector<double>& out);
std::vector<double> shift_image(const std::vector<double>& src, int w, int h, double dx, double dy);

}  // namespace vice
