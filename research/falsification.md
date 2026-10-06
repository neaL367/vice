# Falsification Report — Iter 1+2 (reference TS, tickets 01–06 evidence)

Date 2026-10-06 (iter 1), 2026-10-07 (iter 2: adaptive law + color/noise probes),
2026-10-07 (iter 3: clamp-range mechanism + photo-scale transfer),
2026-10-07 (iter 5: Kodak natural-image validation).
All numbers from `research/results/baseline.json` (288 rows, interior-margin scoring) + `research/results/photos.json` (60 rows, full-frame luma).

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

## Iter-4 findings: per-pixel clamp bounds TRIED AND KILLED

Goal: keep step/jpeg/repeated clamp-snapping while freeing true peaks in oscillatory texture. Four discriminators attempted, all dead:

1. **osc-gated bound loosening** (allow where 7x7 crossing score = 1): periodic decline fixed (26.06 frozen) and step climb kept (47.62) — but jpeg regresses −0.8 (21→26.5 becomes 25.67) and repeated-blocks collapses (global 30.6 → ~19: loosening kills the block-snapping that tight clamp provides). Asymmetric payoff (+1 periodic vs −11 repeated): keep tight globally. Reverted from `ibp.ts`; `osc` retained as reported field only.
2. **Global T-routing** (T=1 vs 4 by texture score): jpeg (needs T=4) overlaps periodic (needs T=1) on meanAlias/meanEdge/meanCoh at both scales. No global separator exists. Dead.
3. **Cut-energy ratio rule** (stop when cut(t)/cut(t−1) stalls): periodic 0.35/0.35/0.48/0.54 vs step 0.38/0.25/0.25/0.25 — damage done while ratio still reads healthy (0.35 at iter 2). Dead.
4. **HF-trajectory stop rule** (halt when mean|Laplacian| rises): rises accompany BOTH good churn (repeated 82→154 with PSNR 21.9→30.8; jpeg 36→52 with PSNR rising) and bad churn (periodic 47→62 with PSNR falling). Edge-sharpening toward truth and harmonic distortion are locally identical. Dead.
5. **Gradient-kurtosis routing**: saturates at cap on all fixtures (means ≈10 everywhere). Dead on arrival; idea untested beyond probe.

Standing result: tight global clamp is the right policy (block/step/jpeg gains up to +23 dB outweigh one −1 dB texture loss). The loop does not beat fixed kernels on pure oscillatory texture — scoped limit, mechanism understood (clamp-range premise), no truth-free fix found in this iteration.

## Iter-5 findings: HYP-1 survives natural images (Kodak 5, luma, box-D)

- 2x: ibp-lrc beats best fixed on ALL 5 photos (+0.25 to +0.32 dB PSNR); SSIM up everywhere; gradErr down everywhere; ringing down 3–6x (kodim08 0.77→0.13). Residual exact. Adaptive ≥ uniform on all 5 (+0.01–0.02, small but never negative).
- 4x: ibp-lrc beats best fixed on ALL 5 (+0.09 to +0.22 dB), same multi-metric pattern.
- Method: minimal zero-dep PNG reader (`ref/png.ts`, filter-exact tests) + `ref/photos.ts` harness; data gitignored under `tools/eval/data/photos/` (Kodak classic set, research use). `photos.test.ts` locks lrc ≥ lanczos3 per photo, skips when data absent.
- Caveats: luma-only (gamma-domain approx; linear path unit-tested, not end-to-end); 5 photos, not a full eval set; box-D only (bicubic-D mismatch untested on photos). Port gate: +0.25–0.32 approaches but does not meet the >0.3-on-2-full-sets bar — no port yet, but the case is now empirical, not speculative.

## Iter-9 findings: TV-IBP shootout — different method, neither equivalent nor superior

- Implemented Chambolle ROF (`ref/tv.ts`, contracts tested) + TV-IBP (TV before Π — measured better than TV-as-post-filter, which additionally breaks the residual).
- Uniform λ=1: photo-surrogate +1.07 (36.26→37.33), jpeg +0.83 — but step −5.6 (47.62→42.03, ringing UP), periodic −0.7. Complementary win zones to the pure loop, not overlapping: NOT equivalent, NOT superior. Locked by test (both directions).
- Osc-gated TV (λ=1 where osc, else 0): KILLED — repeated −3.7, surrogate −8.9, jpeg −1.5. TV staircasing destroys texture amplitude; the global-λ wins came from smoothing edges/ringing globally, not from texture denoising. Lesson: TV penalizes oscillation itself — wrong prior for texture, right one for isolated ringing (which clamp already handles better).
- Kept: `tvMap` option as manual primitive (zeros-bypass bit-exact, tested). Not benched as contender, not adopted.
- Killed list: 12 entries (+ uniform TV-IBP adoption, + osc-gated TV).

## Iter-8 findings: directional-P WEAK-SURVIVE, default OFF (no auto-policy)

- Mechanism: lanczos2-footprint residual upsampler × orientation gate (`w=base·((1−a·coh)+a·coh·|cos φ|^p)`), renormalized (constants/block-means preserved). `strength=0` control isolates footprint from steering.
- Steering effect (dir vs lz2p control, interior): step +0.37/+0.14, gradient-4x +0.37, photo-surrogate +0.05/+0.09, diagonal gradErr −0.23 (2x, with −0.05 PSNR cost); losses: repeated −0.10, jpeg-4x −0.06, diagonal PSNR −0.05. Urban100-10 ungated: +0.09 PSNR and −0.11 gradErr (diagonal-rich content, both metrics agree).
- osc-gated steering (steer only non-oscillatory) neutralizes BOTH directions (losses and wins → ≡iso): no safe auto-policy exists in the descriptor set. Same content-dependence as every other knob in this program.
- Verdict: effect real but small (±0.1–0.4) and bidirectional; default OFF (bilinear-P reference unchanged); `steerP` stays as documented manual option. Not ported, not gated.
- Side finding (locked in bench as `ibp-lz2p`): P-footprint matters more than steering — lanczos2-P vs bilinear-P: periodic +0.4, gradient-4x +0.36, repeated-4x −1.2, step +0.3. No universally best P; recorded per-cell.

## Iter-7 findings: full sets — loop clears gate vs fixed kernels, adaptive does not (vs uniform)

- Build+data: MSVC 14.44 cmake build green, `vice_tests` ALL PASS, `vice_eval` shipped bar reproduced exactly (matches README table). Datasets: Set5/Set14/BSD100/Urban100 from HF mirrors, gitignored.
- Harness `ref/sets.ts` (96 rows: 4 sets × 3 scales × 2 degradations × 4 methods, gamma luma, crop-12): uni/lrc beat lanczos3 on ALL 24 cells. 2x deltas: Set5 +0.52 (full), Set14 +0.44 (full), BSD100-10 +0.32, Urban100-10 +0.38. 3x/4x +0.2–0.47. Both degradations, same ordering. Linear-vs-gamma gap means absolute numbers don't compare with vice_eval — order does.
- Gate audit: LOOP vs fixed kernels >0.3 dB on ≥2 full sets at 2x — MET (Set5, Set14 full). ADAPTIVE vs uniform: ±0.02 dB everywhere — NOT met. The robust winner is the guarded loop itself (bilinear-P + clamp + Π); the adaptive law adds nothing measurable on natural sets (its wins live on synthetics + Kodak +0.01–0.02).
- Verdict refinement: HYP-1-as-adaptive downgraded to WEAK-or-dead on natural statistics; HYP-3-guarded-loop UPGRADED to the portable candidate. Port decision needs same-harness comparison vs shipped proj leg (shock+smooth+Π), not vs fixed kernels — that is C++ work, next iteration.

## Iter-6 findings: model mismatch does NOT break the guarantee (Kodak 5, 240-row matrix)

- D ∈ {box, bicubic} × domain ∈ {gamma, linear} × proj ∈ {on, off} (`results/photos-matrix.*`): prediction was that box-Π hurts under bicubic-D. Measured opposite — proj ≥ noproj in ALL 8 blocks (e.g. gamma-2x bicubic-D: lrc-proj 28.86 vs lrc-noproj 28.76; uni-proj 28.87 vs 28.86). Mechanism: Π acts as DC-bias remover + stabilizer; bicubic-LR vs box-means differ little on photos, while init-kernel DC error dominates. Guarantee is ROBUST to moderate mismatch, not fragile. Genuinely surprising; prior belief updated.
- lrc-proj top-or-tied in all 8 blocks, both domains. Linear-light gaps larger (2x box: +0.39 over lanczos3) — shadows weighted up, same ordering.
- Locked: `photos.test.ts` bicubic-D test (lrc-proj ≥ lanczos3 per photo); `forward.test.ts` documents box/bicubic disagreement near edges (mismatch is real, just harmless here).

## Iter-11 findings: tapered Π KILLED (blurs blocks; seam is the price of sharpness)
- User-visible trigger: zoomed result looks more pixelated than the (browser-blurred) input. Measured: IBP seam 1.32–1.41 vs lanczos 1.12–1.15 on Kodak crop; all seam appears in pass 1 (Π snapping), later passes add nothing.
- Tapered exact projection (tent-weighted correction, means still exact): seam drops everywhere (35→8, 14→4–6) — but step-4x −4.5 dB, repeated-4x −10 dB, jpeg −2 dB. Smoothing the projection trades block sharpness for seam softness: strictly worse where exactness matters. Only periodic improves (+0.6).
- Verdict: seam is the price of sharp block-exactness, not a tunable artifact. 2x can't taper anyway (tent is uniform). No code adopted; primitive kept + locked by test (exactness, s=2 equivalence, block-loss kill-switch).
- Killed list: 15 entries (+ tapered projection).
- Honest product note: zoomed pixels are real reconstructed detail; the input only looks smoother because the browser blurs it. Magnification shows pixels for every upscaler; ours are exact.

## Iter-10 findings: anisotropic x0 HELPS smooth/sine, HURTS blocks — bidirectional, not default

- Mechanism: per-pixel tangent-frame lanczos (`rAlong × rAcross`, renormalized), edge gate = coh·gnorm·curv (ramps bypass via curvature — same lesson as iter-2). Aggressive rAcross=1.25 distorts sine (−5.1 zone PSNR on surrogate patch); mild 2.25 wins all surrogate zones (+0.3–1.0).
- Loop-vs-loop (rAcross 2.25, hard gate): gradient +0.64/+1.43, periodic-2x +0.9, sine-sweep +0.1–0.2, jpeg +0.1–0.3, surrogate-2x +0.56; losses: repeated-4x −1.09, surrogate-4x −0.48, step −0.1–0.2. Same content-dependent sign as every other knob.
- Verdict: WEAK-SURVIVE as manual option (`x0` passthrough in `reconstructIbp`, tested bit-exact); not default. Locked: gradient-4x win, surrogate-2x win, bounded-loss kill-switch (step-2x/repeated-4x within 1.2 dB).
- Killed list: 14 entries (+ aggressive-aniso rAcross≤1.5 as default).

## Iter-12 findings: structured objective ADOPTED (R_edge default, R_freq manual)

- HF error sources, all measured in prior iters: S1 nullspace injection by P (residual→0 while HR error rises: gradient 49.2→44.9 dB); S2 truncation ringing from lanczos init (Gibbs ~5–9%, managed but not removed by clamp+Π); S3 aliased/noise HF re-injected at unit gain.
- Objective now: x* = argmin ‖DHx−y‖² + R_freq + R_edge, solved by projected gradient inside the loop (same solver, no new machinery). R_freq = alias-weighted Laplacian energy; R_edge = edge-confidence-weighted exceedance beyond local LR range. Legitimate-HF preservation is structural: coherent edges get w≈0, in-range interiors get v-idle.
- Sweep verdict: R_edge (eta2=0.05) safe everywhere — battery +0.0–0.2 (surrogate +0.21), photos +0.04 ×3, zero harm in 32 cells → ADOPTED as loop default (reg undefined). R_freq: periodic +2.4 dB but blocks −7 to −11 dB → MANUAL only (content-dependent, same story as every adaptive knob).
- Kept honest: Π still guarantees range; eta steps stability-bounded (smooth moves <0.5 levels/pass, tested); Lᵀ≈L boundary approximation documented.
- Port note: C++ core NOT updated (descriptors port required; reference-default changed, product follows behind a gate as always).

## What survives to iter 13

- Reference engine (default loop now includes R_edge) + battery (16) + harnesses + TV + aniso + reg modules: keep.
- Manual options (tested, not default): R_freq, adaptive weights, directional-P, aniso-x0, TV map, tapered Π.
- Killed (16 entries): + R_freq-as-default.
