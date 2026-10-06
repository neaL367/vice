# Research Map — Deterministic Image Enlargement Without AI

No AI/ML anywhere in this program (see GLOSSARY banned list). All reconstruction from observed samples + defined priors + deterministic algorithms + stated assumptions.

## 0. Engineering inspiration: Pixo (boundaries)

Take from Pixo-style systems: small, fast, browser-local, benchmark-driven, tiled workers, minimal WASM ABI, heavy work off main thread. Do NOT take: algorithms, architecture, kernel choices. Pixo informs packaging + measurement discipline, never math. Shipped `core/` stream engine already embodies the packaging lesson (slab workers, incremental PNG, exact-sum guarantee).

## 1. Forward model + recoverability

```
y = DHx + n
```

- x unknown HR, H blur/prefilter, D decimation, n noise/quantization/compression.
- Research: nullspace of DH (what D kills, H zeros out — unrestorable by any deterministic method); conditioning vs scale factor, kernel support, noise level; uniqueness only under explicit priors (bandlimit, TV ball, sparsity); stability bounds (small Δy → bounded Δx* only with regularization).
- Deliverable: `research/foundations.md` §1 with recoverability statements + what we refuse to claim.

## 2. Sampling / approximation theory

- Shannon-Nyquist, sinc ideal vs finite-support truncation; windowed-sinc (Lanczos-2/3) frequency response: passband ripple, stopband leakage, ringing vs sharpness tradeoff.
- Bilinear (tent: heavy blur, no ringing), bicubic Catmull-Rom (sharper, halo), Mitchell-Netravali B/C family (parameterized blur/ringing tradeoff), spline spaces (B-spline + prefilter exactness).
- Generalized sampling, approximation order, Strang-Fix conditions; why each kernel behaves as measured (derive, not just benchmark).
- Separable 1D vs 2D vs FFT: crossover by support k, tile size, scale. Measure on target (WASM single-thread), not assumption.

## 3. Inverse problems / regularization

- Tikhonov (global λ, closed-form, blurs edges), generalized inverses, TV (edge-preserving, staircasing), Sobolev, sparsity, Bregman iterations, proximal/projected-gradient, conjugate-gradient, ADMM.
- Selection criteria: convergence speed, stability, quality, memory, implementation complexity in WASM. No fashionable choices.
- Candidate decomposition (hypothesis, not accepted):
  ```
  R(x) = λ₁R_freq + λ₂R_edge + λ₃R_grad + λ₄R_tex + λ₅R_noise + λ₆R_smooth
  ```
  with `λ = f(local freq, gradient, curvature, noise, alias risk)`. Each term needs a measurability argument + ablation.

## 4. IBP lineage (what is solved, what is open)

- Irani-Peleg 1990/91: `x ← x + P(y − DHx)`, exponential convergence when `||δ − G×p||₂ < 1`. Multi-frame originally; single-image reduces toward deblurring without added prior.
- Known improvements: TV-regularized IBP (chessboard/ringing down, staircasing up), non-local IBP (self-similarity guards, noise-search risk), ringing-suppressed variants (Yang et al. 2015).
- Open for us: adaptive step + frequency-dependent correction + edge-aware constraints + noise-weighted residual + convergence monitor, all inside exact box-consistency (shipped projection already guarantees range space; IBP here operates on null-space shaping + deblurring of H, never range violation).
- Shipped engine position: band-local smooth ≈ few IBP-style passes with bilinear(y − A(raw)) correction, then exact projection. New work must beat it measured, or be discarded.

## 5. Adaptivity, edges, support

- Local descriptors (all deterministic): gradient direction/magnitude, curvature, local variance, spectral HF ratio, edge confidence, noise estimate, alias risk.
- Anisotropic kernels from gradient geometry; adaptive support (grow k only where structure justifies cost); error-bounded sharpening (allowed iff DHx* ≈ y holds); ringing as joint constraint (Gibbs analysis of truncated kernels).
- Concepts under test: Local Reconstruction Complexity, Frequency-Consistent Reconstruction loop (see spec). Both falsifiable; both die on adversarial suite if vacuous.

## 6. Noise / JPEG / color correctness

- Noise: local-variance + spectral + residual + neighbor-consistency estimators; conservative reconstruction in noisy zones (shrink λ HF terms, never invent texture).
- JPEG: block-boundary detection, quantization-noise estimate; correct-before-reconstruct vs joint — experiment decides.
- Color: linear-light for energy-correct ops (projection, residual, downsample), sRGB for storage; chroma reconstructed smoother than luma (subsampled-chroma premise); alpha premultiplied handling, alpha sums exact. Never trade luminance/chroma error for apparent sharpness.

## 7. Quality objective + complexity

- Multi-objective: PSNR, SSIM/MS-SSIM, gradient preservation, spectrum error, edge displacement, ringing amplitude, aliasing energy, forward residual, color error. No single-metric hill-climb.
- Per-algorithm report: residual, freq preservation, edge displacement, gradient error, HF-energy error, ringing, noise amplification, convergence rate, perturbation stability, parameter sensitivity, conditioning, time/memory.
- Complexity in N (pixels), k (support), iters, pyramid levels: target O(N)–O(Nk) streamable; O(N log N) FFT only past measured crossover.

## 8. Falsification battery (synthetics first)

Impulses, checkerboards, sine sweeps, Nyquist patterns, diagonal/thin H-V-diagonal lines, step edges, gradients, repeated/periodic textures, random noise, JPEG blocks, mixed-frequency regions, transparent edges. Natural images only after synthetics explained.
