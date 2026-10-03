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

Research benchmarks; check upstream licenses before redistributing.
