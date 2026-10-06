# 05: Local descriptors + adaptive law (HYP-1/HYP-2 test)

**What to build:** deterministic per-pixel descriptors (gradient mag/dir, curvature, variance, HF ratio, edge confidence, noise σ̂, alias risk) plus the fixed-form adaptive λ law, wired as weights into the IBP loop — with an ablation proving adaptivity beats best-fixed by >0.1 dB somewhere or dies.

**Blocked by:** 04 (needs working IBP to weight), 03 (needs best-fixed reference).

**Status:** ready-for-agent

- [ ] `research/ref/descriptors.ts` + `adaptive.ts` with documented constants + derivation notes
- [ ] Descriptor unit tests on analytic fixtures (ramp gradient direction, flat variance≈0, checkerboard HF ratio≈1)
- [ ] Ablation table: adaptive vs best-fixed vs adaptive-off; LRC-vs-variance-threshold equivalence test
- [ ] If Δ < 0.1 dB everywhere: HYP-2 marked dead in falsification report, code kept but flagged
