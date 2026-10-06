# Deterministic Image Enlargement Without AI — Final Report

10 iterations, 51 tests green, 14 killed hypotheses, 0 ML. Question asked:
**maximum deterministic reconstruction quality from one discrete image under
explicit assumptions?** Answer below is what survived falsification.

## Portable result

Guarded back-projection loop + exact box projection + lanczos3 init, T=4:

```
x₀ = Lanczos3(y); repeat 4×: x ← Π_box(clamp(x + BilinearUp(y − DHx)))
```

- Beats best fixed kernel on ALL 24 set×scale×degradation cells (Set5 2x +0.52,
  Set14 +0.44, BSD100-10 +0.32, Urban100-10 +0.38), both degradations, gamma and
  linear light. Kodak-5: +0.25–0.32 with 3–6x less ringing. Residual ~1e-14.
- Robust under forward-model mismatch (bicubic-D): projection acts as DC-bias
  remover, helps even when the constraint is technically wrong.
- Converges in 1–2 effective passes (Π does the work); iters 3–4 shape nullspace.

## Mechanism findings (each measured, each falsifiable)

1. Clamp is the engine of multi-iteration behavior (no-clamp freezes after 1 pass).
2. Clamp = L∞ projection valid iff HR range ⊆ LR range; cuts true peaks in
   oscillatory texture (periodic decline explained; no truth-free fix exists —
   4 stop-rules tried, all dead).
3. Residual-chasing without guards overfits observation (gradient −5 dB while
   residual →0). Guards are load-bearing, not cosmetic.
4. Tight global clamp beats every adaptive bound policy tried (block-snapping
   gains to +23 dB outweigh one −1 dB texture loss).
5. Mirror (not clamp) boundary extension in upsample passes (~4 dB on small fixtures).
6. P-footprint matters more than P-steering; no universally best P (recorded per-cell).
7. TV-IBP is a different method with complementary zones (texture +, edges −−);
   TV penalizes oscillation itself — wrong prior for texture.

## Verdict table

| # | Hypothesis | Verdict | Decisive evidence |
|---|-----------|---------|-------------------|
| HYP-3 bare loop | insufficient alone | residual→0 while HR-error rises (gradient) |
| HYP-1 adaptive-λ | weak/dead natural (±0.02), wins synthetics | full-set harness |
| HYP-2 LRC classes | DEAD (≡ variance threshold) | kill test: 63% disagree, 0.00 dB apart |
| Frequency loop novelty | none (≡ projected Landweber) | ablation |
| Directional-P | weak-survive, default OFF | ±0.1–0.4 bidirectional, no safe policy |
| Aniso-x0 | weak-survive, default OFF | smooth/sine +, blocks −1.1 |
| TV-IBP adoption | rejected (complementary, not superior) | step −5.6 vs surrogate +1.1 |
| osc-gated TV | KILLED (−8.9 surrogate) | staircasing destroys texture |
| Per-pixel bounds, T-routing, cut-ratio, HF-stop, kurtosis, hpCoh, alias-gate, residual-gate | ALL KILLED | falsification.md |

## Honest summary

Fixed constrained loop + exact projection does the heavy lifting; **adaptivity
has not earned its complexity anywhere natural**. Every adaptive mechanism
tried shows content-dependent sign with no safe auto-policy in the descriptor
set. The maximum deterministic quality found = guarded loop above; the open
problem is a texture-vs-noise discriminator with teeth (multi-scale coherence
untested), and same-harness comparison vs the deleted shipped engine (recoverable
from git history) before any C++ port.

## Reproduce

`bun test research/ref` (51 tests) · `bun research/ref/bench.ts` (384 rows) ·
`bun research/ref/photos.ts` + `sets.ts` + `photos-matrix.ts` (data gitignored,
fetch per notes). No build, no network, no models.
