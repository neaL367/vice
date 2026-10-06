# Falsification Report — Iter 1 (reference TS, tickets 01–04 evidence)

Date 2026-10-06. All numbers from `research/results/baseline.json` (210 rows). No natural images tested — synthetics only, per program rules.

## Verdicts

### HYP-3 bare frequency loop (guarded IBP: bilinear-P + clamp + Π, T=4): INSUFFICIENT

- Guarded IBP never beats best-fixed kernel on any of 30 fixture×scale cells. Best deltas: +0.04 dB (thin-diag 2x), +0.23 dB (periodic 4x). Worst: −5.15 dB gradient-ramp 2x, −3.8 dB gradient 4x, −3.3 dB jpeg 2x.
- Residual reaches ~1e-14/1e-15 after ONE pass on smooth content (gradient: 0.25 → 2.5e-15) while HR-PSNR *falls* 49.2 → 47.1 dB. Residual-chasing injects nullspace ripple that Π cannot remove (Π restores range only). Textbook semi-convergence without regularization.
- Positive control it does pass: jpeg-blocks 21.4 (init) → 26.6 dB by iter 4, monotone. Loop helps blocky content, harms smooth content. That asymmetry is exactly what adaptive weights (ticket 05) must exploit — bare loop cannot.
- Equivalence statement: clamp+Π guarded loop ≡ projected Landweber with bilinear back-projector; converges in 1–2 passes because Π does the work. NOT a new method (prior-art rows 8/9/11). No novelty claimed.

### HYP-1 adaptive-λ / HYP-2 LRC: UNTESTED (tickets 05/06 open)

- Battery + bench harness ready; gradient-vs-jpeg asymmetry above is the target they must resolve (smooth→conservative, blocky→corrective). Kill criterion stands: Δ<0.1 dB everywhere → dead.

### PSNR-on-sparse-synthetics artifact (methodology warning, not a result)

- `nearest` wins impulse/lines/checkerboard PSNR because L2 rewards energy concentration over correct spread on sparse signals. Do NOT read as "nearest is best". Gradient-error and ringing columns exist for this reason; future comparison must lead with them on sparse families.

## What survives to iter 2

- Math core (kernels/forward/metrics), battery, bench harness: keep.
- Guarded IBP as nullspace-shaping primitive: keep, but only inside adaptive weighting.
- Next: tickets 05 (descriptors + adaptive law), 06 (color/noise/JPEG), then re-bench. C++/WASM port gate UNMET (requires >0.3 dB wins; current best +0.23 on one cell) — no port.
