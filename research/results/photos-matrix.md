# Mismatch matrix (Kodak 5, D × domain × projection)

PSNR across domains NOT comparable (different peak/scale); compare method ORDER within each block.
box-D rows should reproduce photos.md (sanity check).

## gamma 2x box-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 28.52 | 0.9721 | 9.31 |
| bicubic | 28.31 | 0.9707 | 9.69 |
| uni-proj | 28.80 | 0.9742 | 8.67 |
| uni-noproj | 28.75 | 0.9739 | 8.73 |
| lrc-proj | 28.81 | 0.9743 | 8.67 |
| lrc-noproj | 28.72 | 0.9735 | 8.98 |

## gamma 2x bicubic-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 28.46 | 0.9717 | 9.67 |
| bicubic | 28.12 | 0.9693 | 10.13 |
| uni-proj | 28.87 | 0.9747 | 8.97 |
| uni-noproj | 28.86 | 0.9747 | 8.99 |
| lrc-proj | 28.86 | 0.9747 | 8.99 |
| lrc-noproj | 28.76 | 0.9738 | 9.26 |

## gamma 4x box-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 24.40 | 0.9271 | 13.82 |
| bicubic | 24.36 | 0.9260 | 14.00 |
| uni-proj | 24.55 | 0.9310 | 13.16 |
| uni-noproj | 24.51 | 0.9305 | 13.13 |
| lrc-proj | 24.57 | 0.9311 | 13.24 |
| lrc-noproj | 24.50 | 0.9295 | 13.51 |

## gamma 4x bicubic-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 24.46 | 0.9284 | 14.10 |
| bicubic | 24.35 | 0.9261 | 14.29 |
| uni-proj | 24.65 | 0.9328 | 13.56 |
| uni-noproj | 24.64 | 0.9327 | 13.52 |
| lrc-proj | 24.65 | 0.9326 | 13.63 |
| lrc-noproj | 24.59 | 0.9314 | 13.81 |

## linear 2x box-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 29.05 | 0.9679 | 0.03 |
| bicubic | 28.79 | 0.9661 | 0.04 |
| uni-proj | 29.43 | 0.9708 | 0.03 |
| uni-noproj | 29.32 | 0.9701 | 0.03 |
| lrc-proj | 29.44 | 0.9709 | 0.03 |
| lrc-noproj | 29.31 | 0.9697 | 0.03 |

## linear 2x bicubic-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 28.99 | 0.9676 | 0.04 |
| bicubic | 28.59 | 0.9645 | 0.04 |
| uni-proj | 29.47 | 0.9712 | 0.03 |
| uni-noproj | 29.45 | 0.9711 | 0.03 |
| lrc-proj | 29.47 | 0.9711 | 0.03 |
| lrc-noproj | 29.36 | 0.9702 | 0.03 |

## linear 4x box-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 24.69 | 0.9147 | 0.05 |
| bicubic | 24.65 | 0.9136 | 0.05 |
| uni-proj | 24.88 | 0.9196 | 0.05 |
| uni-noproj | 24.81 | 0.9187 | 0.05 |
| lrc-proj | 24.89 | 0.9197 | 0.05 |
| lrc-noproj | 24.81 | 0.9178 | 0.05 |

## linear 4x bicubic-D — mean PSNR over 5 photos

| method | mean PSNR | mean SSIM | mean gradErr |
|---|---|---|---|
| lanczos3 | 24.76 | 0.9165 | 0.05 |
| bicubic | 24.64 | 0.9139 | 0.05 |
| uni-proj | 24.99 | 0.9218 | 0.05 |
| uni-noproj | 24.97 | 0.9217 | 0.05 |
| lrc-proj | 24.98 | 0.9216 | 0.05 |
| lrc-noproj | 24.93 | 0.9203 | 0.05 |

