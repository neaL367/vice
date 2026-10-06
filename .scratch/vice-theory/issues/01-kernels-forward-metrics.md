# 01: Reference kernels + forward model + metrics

**What to build:** isolated TS math core that every later claim stands on: separable fixed kernels (nearest/bilinear/bicubic/Mitchell/Lanczos-2/3), box-D forward model + residual, and metrics (PSNR, SSIM-lite, gradient error, ringing overshoot, forward residual) — all runnable with `bun test research/ref`.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `research/ref/kernels.ts` + tests: impulse/step responses match analytic values (documented in test comments)
- [ ] `research/ref/forward.ts` + tests: box-down exact on fixtures, projected-output residual ≈ 0
- [ ] `research/ref/metrics.ts` + tests: identity scores, known-degradation ordering (blur < sharp on HF metric)
- [ ] `bun test research/ref` green, battery runtime noted
