#pragma once
#include <vector>

namespace vice {

// Deterministic LR descriptors needed for regularization maps (port of the
// TS reference subset actually used: edge confidence, alias risk, local
// range). Conventions match research/ref/descriptors.ts exactly:
// gradients in levels/px, normalized fields in [0,1], 3x3 clamped windows.

struct DescFields {
  int w = 0, h = 0;
  std::vector<double> edge;   // coh * min(1,|g|/32)
  std::vector<double> alias;  // hf * (1-coh) * min(1,var/1600)
  std::vector<double> lo;     // 3x3 min (overshoot reference)
  std::vector<double> hi;     // 3x3 max (overshoot reference)
};

DescFields compute_descriptors(const std::vector<double>& lr, int w, int h);

// Bilinear sample of an LR field at HR pixel (hx,hy), scale s. Clamped.
double sample_field(const std::vector<double>& f, int lw, int lh, int hx, int hy, int s);

}  // namespace vice
