# Spec: Deterministic Reconstruction Theory + Reference Engine (vice-theory)

Status: ready-for-agent

## Problem Statement

Single-image enlargement is ill-posed (`y = DHx + n`, s²:1 underdetermined) yet the shipped engine uses fixed tuning (Lanczos-3 + shock + band smooth + exact projection). Unknown: how much headroom a principled adaptive constrained framework has over fixed kernels, and whether Local Reconstruction Complexity / frequency-consistent loop are real ideas or relabeled known methods. No AI/ML permitted; every output feature must trace to input + stated math.

## Solution

Research-first program in `research/`: foundations + reference TypeScript engine + adversarial battery + benchmark vs shipped `core/` baselines. `core/` and `web/` untouched until a hypothesis wins measured. Simplest testable hypothesis first: Lanczos-3 + 3–5 guarded IBP passes + exact projection at 2×/4×.

## User Stories

1. As a researcher, I want a literature/prior-art map with verdict labels, so that I never rebrand known methods.
2. As a researcher, I want the forward model + recoverability limits written down, so that claims stay inside what samples support.
3. As a researcher, I want per-kernel frequency/spatial derivations, so that kernel differences are explained not just timed.
4. As an engineer, I want isolated TS modules (kernels, forward_model, metrics, ibp, descriptors), so that each claim is unit-testable.
5. As an engineer, I want an adversarial synthetic battery with zero dependencies, so that falsification runs anywhere with one command.
6. As an evaluator, I want PSNR/SSIM-lite/gradient/ringing/residual tables per method, so that wins and losses are localized.
7. As a skeptic, I want ablation runs (weights off, clamp off, adaptivity off), so that equivalence-to-prior-art is detected mechanically.
8. As a maintainer, I want `core/`/`web/` diffs forbidden in iter 1, so that the shipped baseline stays a clean comparator.
9. As a user, I want 2×/4× color-correct (linear-light energy ops, exact alpha) reconstruction, so that sharpness never corrupts color.
10. As a reviewer, I want a falsification report stating what died and why, so that negative results are preserved.

## Implementation Decisions

- New tree `research/` only: `research-map.md`, `prior-art-matrix.md`, `foundations.md` (done); `ref/` TS modules: `kernels.ts`, `forward.ts`, `descriptors.ts`, `ibp.ts`, `metrics.ts`, `adversarial.ts`, `bench.ts`; `falsification.md` report.
- Runtime: bun, zero dependencies, float64 reference. Tests colocated `ref/*.test.ts`, run `bun test research/ref`.
- Forward model: box D (guarantee domain) + optional gaussian-H variant; bicubic-D only as degradation mismatch probe.
- Color: linear-light for energy ops via sRGB EOTF piecewise; alpha path separate, sums exact; chroma probe: 4:2:0-subsampled chroma reconstruction error measured.
- IBP: projected gradient, T ≤ 5, bilinear residual upsampling, exact box projection Π + overshoot clamp after each pass, noise/edge weights w; convergence monitor logs residual per iter.
- Adaptive law g_i: fixed rational forms, ≤3 params each, fit on synthetics only; constants documented in `ref/adaptive.ts` with derivation note.
- Solver shortlist fixed: projected gradient now; ADMM/CG only on documented stall.
- C++/WASM deferred to iter 2 (only if reference beats shipped `proj` columns by >0.3 dB PSNR or >0.005 SSIM on ≥2 sets with residual ≤1e-5).

## Testing Decisions

- Good tests assert external behavior (numbers on fixtures), never implementation internals.
- Modules tested: kernels (impulse/step response values), forward (box-down exactness, residual of projected output ≈ 0), metrics (identity = ∞/1/0-error), ibp (residual monotone non-increasing, Π exactness each iter), adversarial (each generator's known spectrum/edge property).
- Prior art: mirror `core/tests/test_all.cpp` style (named probes + numeric bounds); web `lib/*.test.ts` for harness conventions.
- Falsification battery (15 families): impulse, checkerboard, sine sweep, Nyquist, diagonal, thin H/V/diag, step, gradient ramp, repeated texture, periodic, white noise, JPEG-block pattern, mixed-frequency, transparent edge, photo patch (1 natural crop, last).
- Acceptance gates: reference IBP residual ≤1e-5 on all synthetics; determinism (two runs bit-identical); runtime of battery <60 s on this box.

## Out of Scope

- Any change to `core/`, `tools/`, `web/` in iter 1. C++/WASM port, UI wiring, 3× scale, JPEG-joint mode, FFT path, learned anything. 3×/8k/export paths untouched.

## Further Notes

- Workflow order: grill-with-docs (done) → to-spec (this file) → to-tickets → implement smallest hypothesis → bench → falsify → code-review → retro.
- If adaptive terms measure ≡ fixed TV-IBP, spec requires reporting equivalence and stopping — negative result is a success.
