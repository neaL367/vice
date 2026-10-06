# Glossary — Deterministic Image Reconstruction (Vice)

## Forward model

- **HR signal (x)**: unknown high-resolution image we reconstruct.
- **LR observation (y)**: measured low-resolution input. Model: `y = DHx + n`.
- **Degradation operator (H)**: blur / optical / pre-sampling filter applied before sampling.
- **Sampling operator (D)**: downsampling / decimation from HR grid to LR grid.
- **Noise (n)**: measurement error, quantization, compression artifacts.
- **Forward residual**: `||DHx* − y||` — reconstruction simulated back through forward model vs observation. Primary consistency metric.

## Reconstruction

- **Range space**: component of HR estimate determined by LR observation (must match y through DH).
- **Null space**: component invisible to D (high frequencies D kills). Only place "detail" can live without breaking consistency. Any null-space addition is assumption, not recovered information.
- **Exact reconstruction constraint**: every s×s output block sums to s²× source byte (box D). Shipped engine guarantee via clamp-aware box projection + integer-exact quantization.
- **Back-projection (IBP)**: iterative correction `x ← x + P(y − DHx)` with back-projection kernel P. Irani-Peleg lineage.
- **Frequency-consistent reconstruction**: candidate HR accepted only when `DHx* ≈ y` within bound. Closed loop, not open-loop interpolation.
- **Local Reconstruction Complexity (hypothesis)**: minimal local model order explaining a neighborhood without unsupported HF energy. Unvalidated — must be defined, tested, falsified.
- **Ringing**: Gibbs / truncation overshoot near edges from finite-support sinc approximations. Treated as optimization constraint, not post-filter.
- **Seam**: block-boundary gradient ratio (streaming artifact metric). Lower is better.

## Regularization

- **Tikhonov**: quadratic smoothness penalty, global λ. Stable but blurs edges.
- **Total variation (TV)**: L1-of-gradient penalty, edge-preserving, staircasing risk.
- **Adaptive regularization (hypothesis)**: `λ = f(local frequency, gradient, curvature, noise, alias risk)` per region. Must beat fixed-λ on metrics, not just look sharper.
- **Error-bounded sharpening**: sharpening allowed only while `DHx* ≈ y` holds. Halos that break consistency are rejected.

## Pipeline

- **Slab**: fixed output-image partition rendered by one worker; bytes independent of worker count.
- **Band**: streaming row window inside one slab render (e.g. 64 rows).
- **Halo**: extra input rows beyond owned window needed for kernel support + smooth passes.
- **Raw vs proj**: eval legs — `raw` = Lanczos-only baseline, `proj` = after exact box projection.

## Banned (never in this program)

AI, machine learning, neural networks, generative models, trained models, learned priors, neural inference, diffusion, embeddings, model-based hallucination. Reconstruction depends only on observed image + mathematically defined priors + deterministic algorithms + stated assumptions.
