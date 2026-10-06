# Prior-Art Matrix

Verdict codes: EST = established mathematics · ENG = engineering improvement (known math, better combined) · HYP = novel hypothesis (needs validation) · NEW = potential new theory (only with defined contribution + experiments).

| # | Method | Math basis | Strengths | Failure modes | Complexity | Verdict | Relation to Vice |
|---|--------|-----------|-----------|---------------|------------|---------|------------------|
| 1 | Nearest-neighbor | Zero-order hold | Exact sample preservation, O(N) | Blocky, aliasing, spectrum replicas | O(N) | EST (baseline) | Floor baseline |
| 2 | Bilinear | Tent / 1st-order B-spline | No ringing, cheap, separable | Heavy blur, poor stopband | O(N) | EST (baseline) | Lower-bound smoothing ref |
| 3 | Bicubic Catmull-Rom | Cubic Hermite, a=−0.5 | Sharper than bilinear, separable | Halos, ringing on steps | O(Nk), k=4 | EST (baseline) | Standard baseline |
| 4 | Mitchell-Netravali | B/C cubic family | Tunable blur/ringing tradeoff | No single B/C wins everywhere | O(Nk), k=4 | EST (baseline) | Parameter-sweep baseline |
| 5 | Lanczos-2/3 | Windowed sinc | Best fixed-kernel freq preservation | Ringing, finite-support leakage | O(Nk), k=4/6 | EST (baseline) | Shipped engine's initial upsampler; `raw` leg in eval |
| 6 | Spline + prefilter | B-spline approx + inverse prefilter | High approximation order | Prefilter instability, boundary handling | O(N) + prefilter | EST | Candidate initial basis; test vs Lanczos |
| 7 | Edge-directed (NEDI-style) | Local covariance stationarity | Diagonal edge geometry | Noise fragility, artifacts on texture | O(Nk²)ish | EST | Compare vs anisotropic-kernel hypothesis |
| 8 | Irani-Peleg IBP | Back-projection iteration, `‖δ−G×p‖₂<1` convergence | Enforces DHx≈y, fast (<5 iters multi-frame) | Jaggy/ringing (isotropic error spread), noise sensitivity, single-image underdetermined | O(iters·Nk) | EST | Foundation; shipped band-local smooth is IBP-flavored |
| 9 | TV-regularized IBP | IBP + TV penalty | Chessboard/ringing down | Staircasing, parameter sensitivity | O(iters·Nk) + TV prox | EST | First regularization candidate to beat |
| 10 | Non-local IBP | Self-similarity-weighted back-projection | Texture/edge preservation | Similar-pixel search noise, cost | ≥O(iters·Nk·search) | EST | Cost likely kills streaming; measure before considering |
| 11 | Ringing-suppressed IBP (Yang 2015 etc.) | Constrained/weighted back-projection | Ringing down without post-filter | Method-specific tradeoffs | O(iters·Nk) | EST | Must differentiate any new ringing constraint against these |
| 12 | Tikhonov global | Quadratic penalty, closed form | Stable, simple | Edge blur, single λ everywhere | O(N) – O(N log N) | EST | Regularization floor |
| 13 | ADMM / proximal / Bregman solvers | Constrained-optimization machinery | Handles non-smooth R (TV, L1) | Tuning, iteration cost in WASM | O(iters·N) + prox | EST (toolbox) | Solver shortlist; pick by measured convergence/cost |
| 14 | Shipped Vice stream (Lanczos-3 + shock + band smooth + exact box project) | Fixed-tuning heuristics + projection guarantee | Exact sums (245M blocks, 0 violations), seam 2.37–2.50 on hard-edge fixture, benchmarked tables in README | Heuristic detail (shock) is taste, not theory; smooth costs ~2× box-only | O(Nk)+O(iters·N)+O(N) | ENG (our baseline) | The bar. New theory must beat `proj` columns measured. |
| 15 | Adaptive-λ constrained reconstruction | `λ=f(local descriptors)` + DHx≈y hard constraint | Hypothesized: edge fidelity without global blur, explainable per-region | Risk: adaptive λ = disguised sharpening; complexity/cost; WASM-hostile branching | O(Nk)+O(iters·N)+descriptor cost | HYP | Central hypothesis of this program |
| 16 | Local Reconstruction Complexity | Minimal local model order w/o unsupported HF | Hypothesized: principled smooth/directional/conservative switch | Risk: vacuous or equivalent to variance thresholding | Descriptor cost | HYP | Must survive §8 adversarial battery or die |
| 17 | Frequency-consistent loop | Constrained correction gated on DHx≈y | Hypothesized: halos impossible by construction | Risk: equivalent to projected IBP (row 8/9/11) | O(iters·Nk) | HYP | Novelty only if measurably ≠ TV/ringing-suppressed IBP |

## What is already solved (do not rebrand)

Back-projection convergence condition; TV + IBP combination; non-local weighting; ringing-weighted back-projection; windowed-sinc tradeoffs; exact box-consistency via projection (shipped). Any "new" proposal overlapping these rows must cite them and show measured difference.
