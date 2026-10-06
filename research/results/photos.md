# Photo validation (Kodak 5, luma, box-D, IBP T=4)

Research use; Kodak set is a standard benchmark (see tools/eval/README license note).

## Scale 2x — PSNR (dB)

| photo | nearest | bilinear | bicubic | lanczos3 | ibp-uniform | ibp-lrc | lrc Δ best-fixed |
|---|---|---|---|---|---|---|---|
| kodim01.png | 24.72 | 24.64 | 25.36 | 25.52 | 25.75 | 25.77 | +0.25 |
| kodim04.png | 31.16 | 31.31 | 32.27 | 32.51 | 32.8 | 32.81 | +0.3 |
| kodim08.png | 22.34 | 22.33 | 23.09 | 23.2 | 23.48 | 23.5 | +0.3 |
| kodim19.png | 26.88 | 26.83 | 27.7 | 27.89 | 28.17 | 28.18 | +0.29 |
| kodim23.png | 31.73 | 32.03 | 33.11 | 33.47 | 33.79 | 33.79 | +0.32 |

## Scale 2x — SSIM-lite / gradErr (lanczos3 vs ibp-lrc)

| photo | ssim lz3 → lrc | gradErr lz3 → lrc | ring lz3 → lrc |
|---|---|---|---|
| kodim01.png | 0.9434 → 0.948 | 11.53 → 10.73 | 0.06 → 0.01 |
| kodim04.png | 0.9882 → 0.9891 | 6.45 → 6.09 | 0.07 → 0.02 |
| kodim08.png | 0.9601 → 0.9635 | 14.17 → 13.13 | 0.77 → 0.13 |
| kodim19.png | 0.9752 → 0.9771 | 8.13 → 7.45 | 0.04 → 0 |
| kodim23.png | 0.9935 → 0.994 | 6.27 → 5.96 | 0.12 → 0.02 |

## Scale 4x — PSNR (dB)

| photo | nearest | bilinear | bicubic | lanczos3 | ibp-uniform | ibp-lrc | lrc Δ best-fixed |
|---|---|---|---|---|---|---|---|
| kodim01.png | 21.48 | 21.57 | 21.8 | 21.82 | 21.93 | 21.94 | +0.12 |
| kodim04.png | 27.6 | 27.85 | 28.3 | 28.38 | 28.58 | 28.6 | +0.22 |
| kodim08.png | 18.9 | 19.08 | 19.4 | 19.44 | 19.59 | 19.6 | +0.16 |
| kodim19.png | 23.22 | 23.33 | 23.58 | 23.55 | 23.65 | 23.67 | +0.09 |
| kodim23.png | 27.98 | 28.33 | 28.74 | 28.83 | 29.01 | 29.03 | +0.2 |

## Scale 4x — SSIM-lite / gradErr (lanczos3 vs ibp-lrc)

| photo | ssim lz3 → lrc | gradErr lz3 → lrc | ring lz3 → lrc |
|---|---|---|---|
| kodim01.png | 0.8568 → 0.8647 | 17.06 → 16.36 | 0.01 → 0 |
| kodim04.png | 0.9689 → 0.9707 | 8.85 → 8.43 | 0.1 → 0 |
| kodim08.png | 0.8993 → 0.9054 | 21.44 → 20.55 | 0.35 → 0.12 |
| kodim19.png | 0.9297 → 0.9327 | 13.34 → 12.83 | 0.01 → 0 |
| kodim23.png | 0.9809 → 0.9818 | 8.41 → 8.01 | 0.12 → 0.05 |

