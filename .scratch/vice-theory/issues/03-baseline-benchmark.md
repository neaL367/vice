# 03: Baseline benchmark (fixed kernels through forward model)

**What to build:** end-to-end degrade→reconstruct→score loop for every fixed kernel at 2×/4× over the full battery, emitting a JSON + markdown table: PSNR, SSIM-lite, gradient error, ringing, residual per family.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] `research/ref/bench.ts` runs all kernels × scales × families, writes `research/results/baseline.json` + `baseline.md`
- [ ] Documents per-kernel win/loss zones with one-line math cause (from foundations §2)
- [ ] Residual column proves which methods violate DHx≈y and by how much
- [ ] Runtime <60 s on dev box
