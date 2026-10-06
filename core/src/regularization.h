#pragma once
#include <vector>
#include "descriptors.h"

namespace vice {

// Structured regularization port (research/ref/regularization.ts).
// R_freq = alias-weighted Laplacian energy, R_edge = edge-weighted local
// overshoot. Explicit projected-gradient step inside the IBP loop.
// Product default: R_edge-only (ETA1=0, ETA2=0.05) — measured safe
// everywhere in research; R_freq is content-dependent, reference-only.

// Stability-bounded fixed steps (not tuned): worst-case single-pass move
// stays to a few levels; smooth content moves <0.5 levels (tested).
inline constexpr double REG_ETA1_DEFAULT = 0.0;
inline constexpr double REG_ETA2_DEFAULT = 0.05;

struct RegMaps {
  int hw = 0, hh = 0;
  std::vector<double> wFreq;
  std::vector<double> vEdge;
  std::vector<double> loHR;
  std::vector<double> hiHR;
};

// 5-point discrete Laplacian, replicate edges.
std::vector<double> laplacian(const std::vector<double>& d, int w, int h);

// Static penalty maps from the LR observation (geometry is fixed).
RegMaps regularization_maps(const std::vector<double>& lr, int lw, int lh, int s);

// Explicit gradient step on R_freq + R_edge; returned correction is
// SUBTRACTED from (x + correction) before clamp+project.
std::vector<double> regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                                        double eta1, double eta2);

}  // namespace vice
