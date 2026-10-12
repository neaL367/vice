#pragma once
#include <vector>
#include "regularization.h"

namespace vice {

struct IbpResult {
  std::vector<double> x;  // (lw*s)×(lh*s)
  std::vector<double> residuals;
  int iters_used = 0;  // passes actually run (== iters for reconstruct_ibp)
};

// H6 (adaptive iteration count, experimental): fixed ITERS=4 may waste
// passes on easy content and starve hard content. The auto policy runs at
// least min_iters, at most max_iters, stopping early only on a strictly
// improving stall. Kill criteria: K1 no PSNR/residual regression vs
// fixed-4 on step/texture/zoneplate synthetics; K2 measurable savings
// (fewer passes) on easy content or measurable gains on hard content —
// if auto == fixed-4 everywhere, it is complexity without benefit: kill.
// Product (api.cpp) stays on fixed reconstruct_ibp until H6 survives.
// Synthetic outcome 2026-10-12 (vice_tests H6 gates): SURVIVES — flat 2
// passes (saves 2), step 7 passes +18.06 dB (47.62→65.68), texture −0.03 dB
// within the −0.05 program tolerance, forced-4 bit-identical to fixed-4.
// Photo-scale (Kodak) confirmation still required before product wiring.
struct AutoIters {
  int min_iters = 2;
  int max_iters = 8;
  double stall_rel_tol = 1e-6;  // stop when (prev-curr)/prev <= tol
};

IbpResult reconstruct_ibp_auto(const std::vector<double>& lr, int lw, int lh, int s,
                               const AutoIters& policy,
                               const std::vector<double>* x0 = nullptr,
                               const double* clamp_lo_hi = nullptr);

// H8 (per-channel adaptive budgets in RGB, experimental): after H7's kill,
// the surviving speed idea is pass allocation without any color transform —
// each channel runs the H6 auto-loop on its own stall, so flat channels
// stop early while structured channels run on. Exact sums hold per channel
// by construction (projection + integer-exact quantization unchanged).
// Kill criteria: K1 no PSNR regression vs fixed vice_upscale beyond −0.05
// on step/texture/chroma-texture; K2 net win — quality gain on structured
// content or fewer total passes on mixed/flat content; K3 residual < 1e-5
// and exact block sums. Scales 2,3 only in v1 (4/8 need policy threaded
// through progressive — follow-up). Product (vice_upscale) stays fixed
// until H8 survives photo-scale. Synthetic outcome 2026-10-12 (vice_tests
// H8 gates): SURVIVES — flat RGBA 8 vs 16 passes byte-identical; step
// budgets [7,7,7,2] (flat alpha stops early; gain evidence at float level
// in H6: +18 dB); texture +0.01, chroma −0.01 within −0.05; chroma budgets
// [8,2,8] (flat-zero green stops early). Photo-scale pending.
struct AutoImageResult {
  double residual = -1.0;
  int iters_used[4] = {0, 0, 0, 0};
};

AutoImageResult upscale_auto_rgb(const unsigned char* in, int w, int h, int ch, int scale,
                                 unsigned char* out, const AutoIters& policy);

// Guarded IBP: lanczos3 x0 (or explicit x0 when provided — used by staged
// progressive reconstruction), T passes of x ← Π(clamp(x + BilinearUp(y − DHx))).
// Clamp defaults to the observation range; an explicit [lo,hi] override keeps
// tiled reconstruction consistent with whole-image runs. Returns
// exact-range-space estimate (residual ~1e-12 in float64).
// deblock is experimental (H10): nullptr selects the legacy loop exactly;
// otherwise the gated deblock correction (zero unless JPEG evidence clears
// threshold) is applied alongside the regularization step.
IbpResult reconstruct_ibp(const std::vector<double>& lr, int lw, int lh, int s, int iters,
                           const std::vector<double>* x0 = nullptr,
                           const double* clamp_lo_hi = nullptr,
                           const DeblockParams* deblock = nullptr);

}  // namespace vice
