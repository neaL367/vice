# 04: Guarded IBP loop (simplest testable hypothesis)

**What to build:** projected-gradient IBP (`x₀=Lanczos`, bilinear residual up, exact box Π + overshoot clamp, T≤5, residual log) with ablation flags for every guard, proving monotone residual + exact range space each iter.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] `research/ref/ibp.ts` with flags: weights on/off, clamp on/off, projection on/off (projection-off only to demonstrate violation magnitude)
- [ ] Tests: residual non-increasing, Π exactness per iter, determinism (two runs identical)
- [ ] Bench-vs-baseline delta table on battery; any family where IBP loses is documented with cause
