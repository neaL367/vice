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

// Killed hypothesis H5 (gated R_freq revival, 2026-10-12, verdict: KILLED).
// Proposal: re-admit R_freq only where alias evidence is strong and edge
// evidence weak (gate g = alias²·(1−edge)), capped at ±0.25 levels/pass,
// keeping the R_edge term untouched and the product default at eta1=0.
// Measurements on synthetics (vice_tests FREQ probes, since removed):
// zone-plate aliased-ring gate activation 0.018, Nyquist cross-hatch 0.012
// (admission threshold for relevance: mean activation > 0.05); gated output
// bit-identical to baseline on step/ripple/texture (eg == eb exactly);
// texture PSNR +0.01 dB (noise). The gate is correctly selective but the
// admitting set is two orders of magnitude too small to move any photo
// metric, and the cap bounds total movement to ~1 level where it does fire.
// Loosening the gate re-admits the content-dependence that removed R_freq
// from product in the first place. Revival would need photo-scale evidence
// of a large admitting set — this experiment says not to bother.
// Full record belongs in research/falsification.md (local-only).

struct RegMaps {
  int hw = 0, hh = 0;
  std::vector<double> wFreq;
  std::vector<double> vEdge;
  std::vector<double> loHR;
  std::vector<double> hiHR;
};

// 5-point discrete Laplacian, replicate edges.
std::vector<double> laplacian(const std::vector<double>& d, int w, int h);
// Allocation-free variant: out is resized only when it does not already
// match d.size(); identical arithmetic and word order as laplacian().
void laplacian_into(const std::vector<double>& d, int w, int h, std::vector<double>& out);

// Static penalty maps from the LR observation (geometry is fixed).
RegMaps regularization_maps(const std::vector<double>& lr, int lw, int lh, int s);

// Scratch space for the eta1 (R_freq) path so the IBP inner loop can stay
// allocation-free: buffers are grown once per reconstruct call and reused
// across passes. Same float arithmetic as the allocating overload.
struct RegScratch {
  std::vector<double> lap;
  std::vector<double> weighted;
  std::vector<double> lap2;
};

// Explicit gradient step on R_freq + R_edge; returned correction is
// SUBTRACTED from (x + correction) before clamp+project.
void regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                         double eta1, double eta2, std::vector<double>& out);
// Inner-loop variant: reuses scratch; float-bit-identical to the overload
// above for identical inputs.
void regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                         double eta1, double eta2, std::vector<double>& out, RegScratch& scratch);
std::vector<double> regularization_step(const std::vector<double>& x, int w, int h, const RegMaps& m,
                                        double eta1, double eta2);

// H10 deblock response (experimental): explicit correction pulling pixels
// adjacent to 8-grid boundaries toward their across-boundary neighbor,
// scaled by eta3·strength and capped per pixel at ±block_cap levels. With
// eta3=0 or strength=0 the correction is exactly +0.0 everywhere, so the
// gated-off path is bit-identical to no correction. Kill criteria live in
// vice_tests (H10 gates) and ibp.h.
struct DeblockParams {
  double eta3 = 0.0;
  double block_cap = 0.25;
};

void deblock_correction(const std::vector<double>& x, int w, int h, int s,
                        double strength, const DeblockParams& p,
                        int phase_x, int phase_y, std::vector<double>& out);
std::vector<double> deblock_correction(const std::vector<double>& x, int w, int h, int s,
                                       double strength, const DeblockParams& p,
                                       int phase_x = 0, int phase_y = 0);

}  // namespace vice
