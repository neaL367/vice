# Mathematical Foundations — Constrained Deterministic Reconstruction

## 1. Forward model

```
y = DHx + n,   y ∈ R^m (LR), x ∈ R^N (HR), N = s²m
```

- D: box decimation (s×s average) — matches shipped exact-sum guarantee domain. Bicubic-D used only as degradation variant in eval, never as guarantee domain.
- H: pre-sampling blur (gaussian σ or box) + optional JPEG-quantization noise folded into n.
- n: bounded energy `‖n‖ ≤ ε`, ε estimated per image (MAD of high-pass residual).

Recoverability statements:
- (R1) Nullspace of D (box): all zero-mean s×s-block patterns. No deterministic method recovers nullspace content from y alone — any null-space energy in x* is prior/assumption, must be labeled as such.
- (R2) H zeros above its cutoff are unrestorable; reconstruction bandwidth ≤ min(band(H), band(DH inversion stable zone)).
- (R3) Without prior: infinite x map to same y (underdetermined by s²:1). Uniqueness only inside constraint ball (TV/Tikhonov/sparsity) + consistency tube `‖DHx−y‖ ≤ ε`.
- (R4) Stability requires regularization: unregularized inversion amplifies noise by cond(DH) which grows with s and H sharpness.

## 2. Kernel analysis (why fixed kernels differ)

Each kernel derived by its frequency response + spatial failure:
- Bilinear: triangle, Fourier sinc² — strong stopband attenuation but wide passband rolloff → blur, no ringing (non-negative).
- Bicubic CR: negative lobes → sharper passband, stopband leak + step overshoot ≈ 5–9% (halo source).
- Mitchell (B=1/3,C=1/3): tuned lobe balance; less ringing than CR, softer.
- Lanczos-2/3: windowed sinc; closest to brick-wall of fixed kernels; truncation ringing period ≈ output pixel, amplitude decays with lobes; a=3 costs (6×6) vs a=2 (4×4).
- Conclusion used downstream: no fixed kernel adapts to local edge/noise state → per-region selector justified IFF measurable win over best-fixed.

## 3. Variational formulation (candidate HYP-1)

```
x* = argmin_x ‖DHx − y‖² + λ₁R_freq + λ₂R_edge + λ₃R_noise
s.t. ‖DHx−y‖ ≤ ε, overshoot_freq ≤ τf, overshoot_edge ≤ τe, noise_gain ≤ τn,
     monotonicity on step neighborhoods, gradient-sign consistency, exact box sums
```

- R_freq: HF energy outside recoverable band (quadratic, FFT-measurable).
- R_edge: TV-like but directionally weighted by measured gradient orientation (not isotropic TV).
- R_noise: HF penalty scaled by local noise estimate (conservative in noisy zones).
- Adaptive law (HYP): `λ_i(p) = g_i(descriptors(p))`, descriptors = {gradient mag/dir, curvature, variance, HF ratio, edge confidence, noise σ̂, alias risk}. g_i are fixed rational functions with ≤3 parameters each, fit on synthetic suite only (no natural-image tuning, no learning — closed-form least-squares on synthetic residuals, documented constants).

## 4. Local Reconstruction Complexity (HYP-2, falsifiable)

Definition attempt: for neighborhood Ω(p), LRC(p) = min model order k ∈ {0=flat,1=ramp,2=curved-edge,3=textured} whose projection explains Ω within ε. Decision rule: k=0 → smooth kernel wide support; k=1 → directional kernel along edge; k=2 → narrow support + ringing guard; k=3 → conservative (no HF invention, fall back to Lanczos + projection).
Falsification: if LRC-guided selection ≈ variance-threshold selection on battery (ΔPSNR < 0.1 dB everywhere), HYP-2 dies and we report equivalence.

## 5. Frequency-consistent loop (HYP-3)

```
x₀ = Up_Lanczos(y); repeat: r = y − DHx_k; x_{k+1} = Π(x_k + P·diag(w)·r_up)
```
- P back-projection kernel (bilinear up of residual), w noise/edge weights, Π = exact box projection + overshoot clamp.
- Differs from shipped band-smooth only via w + Π-clamp + monitor; if ablation shows w,Π contribute <0.1 dB, report equivalence to TV-IBP (rows 9/11) and stop.
- Solver: projected gradient (simple, WASM-friendly). ADMM/conjugate-gradient only if projected gradient stalls on conditioning tests.

## 6. Complexity (target bounds)

Per output pixel: descriptors O(k_d²) (k_d ≤ 5), upscale O(k²) (k ≤ 6), iters T ≤ 5 IBP passes O(T·k²), projection O(1) amortized. Total O(Nk²) worst, O(Nk) separable path. Streaming: band + halo rows only, zero per-band alloc steady-state (reuse strips like shipped engine).

## 7. Numerical stability

- Float32 compute, float64 accumulation for sums/residuals; ε-comparisons with explicit tolerances (residual τ=1e-5, exact-sum ≤1 ULP path separate in core only).
- Deterministic reductions (fixed order), boundary = clamp/replicate documented per function, halo math mirrors `vice_stream_halo_rows` convention.
- Reference TS uses float64 throughout; equivalence window vs float32 port defined per-metric in spec acceptance.
- Boundary extension: mirror (whole-sample symmetric) in upsample passes — clamp cost ~4 dB on gradient-ramp (border-dominated on small fixtures) while interior matched init. Descriptors/estimators keep clamp (less sensitive). Bench scores interior (margin 4px); boundary policy tested separately.
