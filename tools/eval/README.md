# Eval datasets (gitignored, ~480 MB — download once)

- Set5 / Set14 / BSD100 (HR+LR pairs; eval uses HR only, own degradations):
  `keanteng/bsd100-set5-set14` (Set5.zip, Set14.zip, BSD100.zip)
- Urban100 HR (100 PNGs): `abc123-ABC/Urban100` (`data/Urban100_HR.tar.gz`)

Layout expected by `vice_eval <data_dir> [max_images]`:

```
data/
  Set5/Set5/image_SRF_{2,3,4}/*_HR.png
  Set14/Set14/image_SRF_{2,3,4}/*_HR.png
  BSD100/BSD100/image_SRF_{2,3,4}/*_HR.png
  Urban100/Urban100_HR/*.png
```

4× policy experiment: `vice_eval <data_dir> [max_images] <direct|chained|clean>`
(`direct` is the default and matches the app; `clean` runs chained 2××2× with
a plain Lanczos+dering second pass; `chained` runs full tuning on both passes).
The proj leg always renders through the streaming strip API (64-row bands,
clamp-aware box only) and scores in linear light, so the table measures
shipped bytes; see `vice_bench4x` for the full-image multigrid/smooth
comparison. Measured 2026-10: direct 4× dominates chained on PSNR/SSIM/seam,
so only Direct ships selected by default — the `2××2×` UI toggle runs the
clean fused second pass.

Research benchmarks; check upstream licenses before redistributing.
