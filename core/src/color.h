#pragma once

namespace vice {

// Exact sRGB EOTF pair (product v1 processes gamma bytes; linear-light
// path is future work — see the H-ranked list).
double srgb_to_linear(double v);
double linear_to_srgb(double v);

// H7 (chroma/luma split, experimental): linear YCoCg working space for the
// float pipeline. Linearity matters: per-pixel linear maps commute with box
// decimation (D(Mx) = M(Dx)), so range-consistency in YCoCg is equivalent to
// range-consistency in RGB, and the final RGB quantization re-anchors
// byte-exactness. Y = R/4 + G/2 + B/4 (full range on byte content).
void rgb_to_ycocg(double r, double g, double b, double* y, double* co, double* cg);
void ycocg_to_rgb(double y, double co, double cg, double* r, double* g, double* b);

// H9 (linear-light pipeline, experimental): v1 averages gamma-encoded bytes,
// but box decimation is physically light-averaging. The working space here
// is linear light scaled ×255, so every tuned constant (descriptor thresholds
// in levels, eta2, caps) keeps its meaning — only the space changes. Final
// quantization is in sRGB bytes against the source, so RGB exact block sums
// hold by construction. ch 3 or 4; scales 2,3,4 (4 staged). Returns the worst
// working-space loop residual, or -1.0 on bad arguments.
// Kill criteria: K1 no PSNR regression vs the gamma path beyond −0.05 on
// camera-honest synthetics (linear truth → linear box → gamma-encoded LR),
// judged in linear space; K2 byte-identity on constants/flats (roundtrip
// must be transparent); K3 exact sums + residual < 1e-5. The hypothesis
// predicts linear WINS where gamma-averaging errs (texture/zoneplate);
// a mere tie keeps H9 alive as refactoring, a loss kills it. Product stays
// gamma until H9 survives photo-scale (which also re-baselines every gate).
// Synthetic outcome 2026-10-12 (vice_tests H9 gates): SURVIVES — texture
// +0.16 dB (30.92→31.08) in the predicted direction, zoneplate +0.01,
// constants byte-identical, sums exact. Photo-scale pending.
double linear_upscale(const unsigned char* in, int w, int h, int ch, int scale,
                      unsigned char* out, int iters);

// Killed hypothesis H7 (YCoCg working space, 2026-10-12, verdict: KILLED).
// The design above is sound (linearity commutes with decimation; RGB final
// quantization held exact sums; gray content bit-identical to RGB path),
// but on chroma texture YCoCg(4,4) scored 24.86 vs RGB 24.96 dB (−0.10,
// past the −0.05 bar) with worse band energy (233812 vs 230926): mixing
// channels changes clamp/descriptor trajectories against us, and cheap
// chroma (4,1) saved passes only against its own weaker baseline.
// Salvage direction (untried, would be H8): per-channel pass counts in RGB
// space — no transform, guarantees trivially intact; chroma iters matter
// little anywhere (4→1 cost ~0.01 dB in both spaces), so allocate passes
// by per-channel activity instead.
// Full record belongs in research/falsification.md (local-only).

}  // namespace vice
