# Falsification Report — Iter 1+2 (reference TS, tickets 01–06 evidence)

Date 2026-10-06 (iter 1), 2026-10-07 (iter 2: adaptive law + color/noise probes),
2026-10-07 (iter 3: clamp-range mechanism + photo-scale transfer).
All numbers from `research/results/baseline.json` (288 rows, interior-margin scoring). No natural images tested — synthetics only, per program rules.

## Verdicts

### HYP-3 bare frequency loop (guarded IBP: bilinear-P + clamp + Π, T=4): INSUFFICIENT (stands from iter 1)

- Guarded IBP never beats best-fixed kernel on any of 30 fixture×scale cells. Best deltas: +0.04 dB (thin-diag 2x), +0.23 dB (periodic 4x). Worst: −5.15 dB gradient-ramp 2x, −3.8 dB gradient 4x, −3.3 dB jpeg 2x.
- Residual reaches ~1e-14/1e-15 after ONE pass on smooth content (gradient: 0.25 → 2.5e-15) while HR-PSNR *falls* 49.2 → 47.1 dB. Residual-chasing injects nullspace ripple that Π cannot remove (Π restores range only). Textbook semi-convergence without regularization.
- Positive control it does pass: jpeg-blocks 21.4 (init) → 26.6 dB by iter 4, monotone. Loop helps blocky content, harms smooth content. That asymmetry is exactly what adaptive weights (ticket 05) must exploit — bare loop cannot.
- Equivalence statement: clamp+Π guarded loop ≡ projected Landweber with bilinear back-projector; converges in 1–2 passes because Π does the work. NOT a new method (prior-art rows 8/9/11). No novelty claimed.

### HYP-1 adaptive-λ (descriptor-driven weights): SURVIVES WEAKLY (engineering, not theory)

- Final law `w = 0.65·edge·curvGate·supGate + 0.45·hf·(1−gate)`, hard-zero past gate 0.6, mirror boundaries, interior scoring: adaptive ≥ uniform on 27/30 cells. Wins: repeated-blocks 4x +2.25 dB, gradient 4x +0.97, sine-sweep +0.06–0.08, jpeg +0.18–0.23, step 2x +0.1. Loss: periodic-sine 2x −0.36 (HF drive mis-corrects mid-frequency sine; why unresolved — open).
- Noise requirement met at the true metric: noisy-ramp intra-block variance 18.65 adaptive vs 19.36 uniform (init 18.37). A mean-weight proxy was tried first and failed (noise inflates all amplitude descriptors); recorded in `adaptive.test.ts`, not hidden.
- Status: consistent small wins, no blowups, exact residual preserved. Candidate for natural-image validation (vice_eval sets) before any port talk. Port gate still unmet on synthetics alone.

### HYP-2 Local Reconstruction Complexity classes: DEAD as formulated

- LRC-vs-variance outcomes identical to 2 decimals battery-wide (max |Δ| 0.04 dB), including thin-h 4x where the classifiers disagree on 63% of pixels (`adaptive.test.ts` kill test locks this). Different mechanism, same outcome → classifier carries no decision-relevant information for this loop. LRC code stays for the ablation record; variance gate suffices; do not build on it.
- The descriptor VALUES (edge/curv/hf/coh in the weight law) do carry signal — only the 0/1/2/3 complexity classes died.

### Failed sub-hypotheses (recorded, reverted, not hidden)

1. `alias`-gated HF drive: over-suppressed recoverable texture. Reverted.
2. `hpCoh = |Σr|/Σ|r|` sign coherence: vacuous — Σ(d−mean)≡0 over its own window, identically zero everywhere. All hpCoh-era measurements confounded; affected numbers re-run after removal. Lesson: ratios need an independent reference.
3. Residual-coherence gate in IBP: collapsed to uniform 0.25 suppression (follows from #2), −1 dB on step. Reverted.
4. Clamp boundary extension: cost ~4 dB on gradient-ramp while interior matched init. Replaced with mirror (whole-sample symmetric) in upsample passes; bench scores interior (margin 4px) with boundary policy tested separately.

### PSNR-on-sparse-synthetics artifact (methodology warning, not a result)

- `nearest` wins impulse/lines/checkerboard PSNR because L2 rewards energy concentration over correct spread on sparse signals. Do NOT read as "nearest is best". Gradient-error and ringing columns exist for this reason; future comparison must lead with them on sparse families.

## Iter-3 findings

### Clamp-range mechanism (periodic loss explained, not fixed)

- IBP-without-clamp converges in ONE iteration and freezes (correction→0): it is a single-step projection method. Clamp is the engine of all multi-iteration behavior — it re-creates residual each pass by cutting peaks, Π re-exacts means. Measured: step 24.44 (no clamp) vs 47.62 (clamp, T=4); jpeg 21.46 vs 26.50.
- Clamp = implicit L∞ projection onto [minLR, maxLR]. Valid iff HR range ⊆ LR range (step: LR spans 0–255 exactly ✓). For oscillatory texture the premise is false (periodic LR spans 34–220, HR 0–255): clamp cuts TRUE peaks every pass → 25.29→24.34 decline while residual reads ~0. Residual cannot detect this; HR-PSNR can.
- Global T-routing (1 vs 4 by texture score) is a dead end: jpeg (needs T=4) and periodic (needs T=1) overlap on meanAlias/meanEdge/meanCoh at both scales. No global separator exists in the descriptor set. Per-pixel bound routing is future work, not this iteration.
- Periodic texture remains a loss zone vs best fixed (lanczos3 29.91 interior vs loop ~28). Scoped, not solved.

### Photo-scale transfer (photo-surrogate, 128px 1/f + step + sine + wedge)

- 2x: loop 37.24 (adaptive) vs lanczos3 35.66 → **+1.58 dB**, best gradErr (1.77), zero ringing, residual 1e-14. HYP-1 wins on mixed photo-scale content, not just toys. Locked by test.
- 4x: loop 27.86 vs lanczos3 26.36 → +1.5 dB; adaptive −0.05 vs uniform (sine-patch zone, same periodic loss at scale). Loop transfers; adaptive neutral-to-positive.
- Caveat: surrogate is still synthetic (no optics, no JPEG, no demosaic). Natural-set validation (vice_eval) needs external datasets + C++ build — not available on this box (no data dir, no g++/MSVC on PATH). Recorded as open, not claimed.

## What survives to iter 4

- Math core (kernels/forward/metrics/descriptors/color/degradation), battery (16 families incl. photo-surrogate), bench harness: keep.
- Adaptive weight law (HYP-1 weak, now with photo-scale win): keep; next is natural-set validation when datasets/build available, or per-pixel bound routing for the texture loss.
- Killed: LRC classes, alias gate, hpCoh, residual-coherence gate, clamp boundaries, global T-routing. Do not revive without new evidence.
- Open: per-pixel clamp bounds for texture (mechanism known, fix open); multi-scale coherence; residual-domain gating done right.
- C++/WASM port gate UNMET (requires >0.3 dB PSNR or >0.005 SSIM on ≥2 natural sets, residual ≤1e-5) — no port.
