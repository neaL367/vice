# Baseline benchmark (reference TS, box-D, guarded IBP T=4)

Null-PSNR cells (checkerboard/nyquist at 2x/4x): every method scores ≈ identikit gray — expected, nullspace total.

## Scale 2x — PSNR (dB, higher better; null = ∞)

| fixture | best fixed | dB | ibp-guarded | dB | ibp Δ |
|---|---|---|---|---|---|
| impulse | nearest | 31.35 | ibp-guarded | 31.35 | +0 |
| checkerboard | nearest | 6.02 | ibp-guarded | 6.02 | +0 |
| sine-sweep | nearest | 12.14 | ibp-guarded | 11.68 | -0.46 |
| nyquist-stripes | nearest | 6.02 | ibp-guarded | 6.02 | +0 |
| diagonal-line | nearest | 18.06 | ibp-guarded | 18.07 | +0.01 |
| thin-h-line | nearest | 18.06 | ibp-guarded | 18.06 | +0 |
| thin-v-line | nearest | 18.06 | ibp-guarded | 18.06 | +0 |
| thin-diag-line | nearest | 19.31 | ibp-guarded | 19.35 | +0.04 |
| step-edge | nearest | ∞ | ibp-guarded | 47.62 | −∞ (fixed exact) |
| gradient-ramp | bicubic | 50.08 | ibp-guarded | 44.93 | -5.15 |
| repeated-blocks | nearest | ∞ | ibp-guarded | 30.58 | −∞ (fixed exact) |
| periodic-sine2d | lanczos3 | 26.27 | ibp-guarded | 25.98 | -0.29 |
| white-noise | nearest | 12.01 | ibp-guarded | 11.7 | -0.31 |
| jpeg-blocks | nearest | 29.94 | ibp-guarded | 26.61 | -3.33 |
| mixed-frequency | nearest | 9.01 | ibp-guarded | 9.01 | +0 |

## Scale 4x — PSNR (dB, higher better; null = ∞)

| fixture | best fixed | dB | ibp-guarded | dB | ibp Δ |
|---|---|---|---|---|---|
| impulse | nearest | 30.38 | ibp-guarded | 30.33 | -0.05 |
| checkerboard | nearest | 6.02 | ibp-guarded | 6.02 | +0 |
| sine-sweep | nearest | 10.36 | ibp-guarded | 9.9 | -0.46 |
| nyquist-stripes | nearest | 6.02 | ibp-guarded | 6.02 | +0 |
| diagonal-line | nearest | 16.3 | ibp-guarded | 16.34 | +0.04 |
| thin-h-line | nearest | 16.3 | ibp-guarded | 16.25 | -0.05 |
| thin-v-line | nearest | 16.3 | ibp-guarded | 16.25 | -0.05 |
| thin-diag-line | nearest | 18.64 | ibp-guarded | 18.64 | +0 |
| step-edge | nearest | ∞ | ibp-guarded | 30.69 | −∞ (fixed exact) |
| gradient-ramp | lanczos2 | 39.61 | ibp-guarded | 35.8 | -3.81 |
| repeated-blocks | nearest | ∞ | ibp-guarded | 30.26 | −∞ (fixed exact) |
| periodic-sine2d | nearest | 15.33 | ibp-guarded | 15.56 | +0.23 |
| white-noise | nearest | 11 | ibp-guarded | 10.95 | -0.05 |
| jpeg-blocks | nearest | 28.26 | ibp-guarded | 24.8 | -3.46 |
| mixed-frequency | nearest | 8.94 | ibp-guarded | 8.94 | +0 |

## Residual violations (DHx≈y failures, RMS levels)

| fixture | scale | worst open-loop method | residual |
|---|---|---|---|
| impulse | 2x | bilinear | 1.9 |
| impulse | 2x | bicubic | 1.13 |
| impulse | 2x | mitchell | 1.71 |
| impulse | 2x | lanczos2 | 1.11 |
| impulse | 2x | lanczos3 | 0.96 |
| impulse | 4x | bilinear | 0.95 |
| impulse | 4x | bicubic | 0.65 |
| impulse | 4x | mitchell | 0.91 |
| impulse | 4x | lanczos2 | 0.64 |
| impulse | 4x | lanczos3 | 0.57 |
| sine-sweep | 2x | bilinear | 22.37 |
| sine-sweep | 2x | bicubic | 13.01 |
| sine-sweep | 2x | mitchell | 20.17 |
| sine-sweep | 2x | lanczos2 | 12.59 |
| sine-sweep | 2x | lanczos3 | 11.33 |
| sine-sweep | 4x | bilinear | 17.18 |
| sine-sweep | 4x | bicubic | 11.49 |
| sine-sweep | 4x | mitchell | 16.71 |
| sine-sweep | 4x | lanczos2 | 11.3 |
| sine-sweep | 4x | lanczos3 | 10.18 |
| diagonal-line | 2x | bilinear | 14.89 |
| diagonal-line | 2x | bicubic | 9.24 |
| diagonal-line | 2x | mitchell | 13.54 |
| diagonal-line | 2x | lanczos2 | 9.06 |
| diagonal-line | 2x | lanczos3 | 7.93 |
| diagonal-line | 4x | bilinear | 10.1 |
| diagonal-line | 4x | bicubic | 7.06 |
| diagonal-line | 4x | mitchell | 9.73 |
| diagonal-line | 4x | lanczos2 | 7 |
| diagonal-line | 4x | lanczos3 | 6.25 |
| thin-h-line | 2x | bilinear | 9.76 |
| thin-h-line | 2x | bicubic | 5.53 |
| thin-h-line | 2x | mitchell | 8.71 |
| thin-h-line | 2x | lanczos2 | 5.38 |
| thin-h-line | 2x | lanczos3 | 4.7 |
| thin-h-line | 4x | bilinear | 6.9 |
| thin-h-line | 4x | bicubic | 4.52 |
| thin-h-line | 4x | mitchell | 6.65 |
| thin-h-line | 4x | lanczos2 | 4.46 |
| thin-h-line | 4x | lanczos3 | 3.98 |
| thin-v-line | 2x | bilinear | 9.76 |
| thin-v-line | 2x | bicubic | 5.53 |
| thin-v-line | 2x | mitchell | 8.71 |
| thin-v-line | 2x | lanczos2 | 5.38 |
| thin-v-line | 2x | lanczos3 | 4.7 |
| thin-v-line | 4x | bilinear | 6.9 |
| thin-v-line | 4x | bicubic | 4.52 |
| thin-v-line | 4x | mitchell | 6.65 |
| thin-v-line | 4x | lanczos2 | 4.46 |
| thin-v-line | 4x | lanczos3 | 3.98 |
| thin-diag-line | 2x | bilinear | 6.23 |
| thin-diag-line | 2x | bicubic | 3.55 |
| thin-diag-line | 2x | mitchell | 5.54 |
| thin-diag-line | 2x | lanczos2 | 3.51 |
| thin-diag-line | 2x | lanczos3 | 2.92 |
| thin-diag-line | 4x | bilinear | 4.28 |
| thin-diag-line | 4x | bicubic | 2.81 |
| thin-diag-line | 4x | mitchell | 4.08 |
| thin-diag-line | 4x | lanczos2 | 2.79 |
| thin-diag-line | 4x | lanczos3 | 2.41 |
| step-edge | 2x | bilinear | 11.27 |
| step-edge | 2x | bicubic | 6.08 |
| step-edge | 2x | mitchell | 9.84 |
| step-edge | 2x | lanczos2 | 5.98 |
| step-edge | 2x | lanczos3 | 5.04 |
| step-edge | 4x | bilinear | 15.94 |
| step-edge | 4x | bicubic | 9.97 |
| step-edge | 4x | mitchell | 15.04 |
| step-edge | 4x | lanczos2 | 9.89 |
| step-edge | 4x | lanczos3 | 8.57 |
| gradient-ramp | 2x | bilinear | 0.73 |
| gradient-ramp | 2x | mitchell | 0.59 |
| gradient-ramp | 4x | bilinear | 2.06 |
| gradient-ramp | 4x | bicubic | 1.08 |
| gradient-ramp | 4x | mitchell | 1.81 |
| gradient-ramp | 4x | lanczos2 | 1.1 |
| gradient-ramp | 4x | lanczos3 | 0.89 |
| repeated-blocks | 2x | bilinear | 35.02 |
| repeated-blocks | 2x | bicubic | 16.75 |
| repeated-blocks | 2x | mitchell | 29.3 |
| repeated-blocks | 2x | lanczos2 | 17.27 |
| repeated-blocks | 2x | lanczos3 | 11.26 |
| repeated-blocks | 4x | bilinear | 60.3 |
| repeated-blocks | 4x | bicubic | 46.06 |
| repeated-blocks | 4x | mitchell | 60.06 |
| repeated-blocks | 4x | lanczos2 | 45.2 |
| repeated-blocks | 4x | lanczos3 | 43.69 |
| periodic-sine2d | 2x | bilinear | 22.08 |
| periodic-sine2d | 2x | bicubic | 10.58 |
| periodic-sine2d | 2x | mitchell | 18.49 |
| periodic-sine2d | 2x | lanczos2 | 10.91 |
| periodic-sine2d | 2x | lanczos3 | 7.12 |
| periodic-sine2d | 4x | bilinear | 32.01 |
| periodic-sine2d | 4x | bicubic | 24.45 |
| periodic-sine2d | 4x | mitchell | 31.88 |
| periodic-sine2d | 4x | lanczos2 | 23.99 |
| periodic-sine2d | 4x | lanczos3 | 23.19 |
| white-noise | 2x | bilinear | 16.92 |
| white-noise | 2x | bicubic | 9.9 |
| white-noise | 2x | mitchell | 15.18 |
| white-noise | 2x | lanczos2 | 9.73 |
| white-noise | 2x | lanczos3 | 8.31 |
| white-noise | 4x | bilinear | 7.8 |
| white-noise | 4x | bicubic | 5.28 |
| white-noise | 4x | mitchell | 7.5 |
| white-noise | 4x | lanczos2 | 5.23 |
| white-noise | 4x | lanczos3 | 4.61 |
| jpeg-blocks | 2x | bilinear | 16.16 |
| jpeg-blocks | 2x | bicubic | 8.61 |
| jpeg-blocks | 2x | mitchell | 14.01 |
| jpeg-blocks | 2x | lanczos2 | 8.55 |
| jpeg-blocks | 2x | lanczos3 | 7.03 |
| jpeg-blocks | 4x | bilinear | 24.5 |
| jpeg-blocks | 4x | bicubic | 13.91 |
| jpeg-blocks | 4x | mitchell | 22.15 |
| jpeg-blocks | 4x | lanczos2 | 14.12 |
| jpeg-blocks | 4x | lanczos3 | 10.34 |
| mixed-frequency | 2x | bilinear | 6.15 |
| mixed-frequency | 2x | bicubic | 3.29 |
| mixed-frequency | 2x | mitchell | 5.35 |
| mixed-frequency | 2x | lanczos2 | 3.24 |
| mixed-frequency | 2x | lanczos3 | 2.72 |
| mixed-frequency | 4x | bilinear | 9.26 |
| mixed-frequency | 4x | bicubic | 5.62 |
| mixed-frequency | 4x | mitchell | 8.63 |
| mixed-frequency | 4x | lanczos2 | 5.59 |
| mixed-frequency | 4x | lanczos3 | 4.83 |
