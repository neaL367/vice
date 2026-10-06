# Baseline benchmark (reference TS, box-D, guarded IBP T=4, interior margin 4px)

Null-PSNR cells (checkerboard/nyquist): every method scores ≈ identikit gray — expected, nullspace total.

## Scale 2x — PSNR interior (dB; null = ∞)

| fixture | best fixed | dB | ibp-uniform | ibp-lrc | ibp-var | ibp-lz2p | ibp-dir | lrc Δ uni | dir Δ lz2p |
|---|---|---|---|---|---|---|---|---|---|
| impulse | nearest | 28.85 | 28.85 | 28.85 | 28.85 | 28.85 | 28.85 | +0 | +0 |
| checkerboard | nearest | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | +0 | +0 |
| sine-sweep | nearest | 12.82 | 12.22 | 12.28 | 12.28 | 12.2 | 12.24 | +0.06 | +0.04 |
| nyquist-stripes | nearest | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | +0 | +0 |
| diagonal-line | nearest | 16.81 | 16.86 | 16.86 | 16.86 | 16.85 | 16.8 | +0 | -0.05 |
| thin-h-line | nearest | 16.81 | 16.81 | 16.81 | 16.81 | 16.81 | 16.81 | +0 | +0 |
| thin-v-line | nearest | 16.81 | 16.81 | 16.81 | 16.81 | 16.81 | 16.81 | +0 | +0 |
| thin-diag-line | nearest | 18.06 | 18.1 | 18.11 | 18.11 | 18.1 | 18.1 | +0.01 | +0 |
| step-edge | nearest | ∞ | 46.37 | 46.47 | 46.47 | 46.68 | 47.05 | +0.1 | +0.37 |
| gradient-ramp | bilinear | 326.45 | 57.07 | 57.28 | 57.28 | 56.95 | 57.12 | +0.21 | +0.17 |
| repeated-blocks | nearest | ∞ | 29.52 | 29.72 | 29.72 | 29.41 | 29.31 | +0.2 | -0.1 |
| periodic-sine2d | lanczos3 | 29.91 | 28.38 | 28.02 | 28.02 | 28.45 | 28.45 | -0.36 | +0 |
| white-noise | nearest | 11.99 | 11.71 | 11.74 | 11.74 | 11.69 | 11.69 | +0.03 | +0 |
| jpeg-blocks | nearest | 29.94 | 26.14 | 26.32 | 26.32 | 26.05 | 26.03 | +0.18 | -0.02 |
| mixed-frequency | nearest | 9.01 | 9 | 9.01 | 9.01 | 9 | 9 | +0.01 | +0 |
| photo-surrogate | lanczos3 | 35.66 | 37.02 | 37.24 | 37.24 | 36.9 | 36.95 | +0.22 | +0.05 |

## Scale 4x — PSNR interior (dB; null = ∞)

| fixture | best fixed | dB | ibp-uniform | ibp-lrc | ibp-var | ibp-lz2p | ibp-dir | lrc Δ uni | dir Δ lz2p |
|---|---|---|---|---|---|---|---|---|---|
| impulse | nearest | 27.88 | 27.83 | 27.84 | 27.84 | 27.83 | 27.83 | +0.01 | +0 |
| checkerboard | nearest | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | +0 | +0 |
| sine-sweep | nearest | 10.58 | 10.04 | 10.12 | 10.12 | 10.02 | 10.04 | +0.08 | +0.02 |
| nyquist-stripes | nearest | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | 6.02 | +0 | +0 |
| diagonal-line | nearest | 15.05 | 15.1 | 15.1 | 15.1 | 15.1 | 15.08 | +0 | -0.02 |
| thin-h-line | nearest | 15.05 | 15 | 15 | 15 | 15.01 | 15 | +0 | -0.01 |
| thin-v-line | nearest | 15.05 | 15 | 15 | 15 | 15.01 | 15.01 | +0 | +0 |
| thin-diag-line | nearest | 17.39 | 17.4 | 17.4 | 17.4 | 17.39 | 17.39 | +0 | +0 |
| step-edge | nearest | ∞ | 29.44 | 29.44 | 29.44 | 29.52 | 29.66 | +0 | +0.14 |
| gradient-ramp | bilinear | 325.61 | 43.2 | 44.17 | 44.17 | 42.98 | 43.35 | +0.97 | +0.37 |
| repeated-blocks | nearest | ∞ | 31.99 | 34.24 | 34.24 | 31.03 | 31.02 | +2.25 | -0.01 |
| periodic-sine2d | nearest | 15.33 | 15.58 | 15.53 | 15.53 | 15.61 | 15.61 | -0.05 | +0 |
| white-noise | nearest | 10.91 | 10.84 | 10.86 | 10.86 | 10.83 | 10.84 | +0.02 | +0.01 |
| jpeg-blocks | nearest | 28.26 | 25.3 | 25.53 | 25.53 | 25.22 | 25.16 | +0.23 | -0.06 |
| mixed-frequency | nearest | 8.94 | 8.93 | 8.93 | 8.93 | 8.93 | 8.93 | +0 | +0 |
| photo-surrogate | lanczos3 | 26.36 | 27.86 | 27.81 | 27.81 | 27.9 | 27.99 | -0.05 | +0.09 |

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
| sine-sweep | 2x | bilinear | 22.38 |
| sine-sweep | 2x | bicubic | 13.01 |
| sine-sweep | 2x | mitchell | 20.18 |
| sine-sweep | 2x | lanczos2 | 12.59 |
| sine-sweep | 2x | lanczos3 | 11.33 |
| sine-sweep | 4x | bilinear | 17.66 |
| sine-sweep | 4x | bicubic | 11.79 |
| sine-sweep | 4x | mitchell | 17.17 |
| sine-sweep | 4x | lanczos2 | 11.6 |
| sine-sweep | 4x | lanczos3 | 10.32 |
| diagonal-line | 2x | bilinear | 15.6 |
| diagonal-line | 2x | bicubic | 9.84 |
| diagonal-line | 2x | mitchell | 14.26 |
| diagonal-line | 2x | lanczos2 | 9.63 |
| diagonal-line | 2x | lanczos3 | 8.54 |
| diagonal-line | 4x | bilinear | 11.11 |
| diagonal-line | 4x | bicubic | 8 |
| diagonal-line | 4x | mitchell | 10.79 |
| diagonal-line | 4x | lanczos2 | 7.91 |
| diagonal-line | 4x | lanczos3 | 7.23 |
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
| thin-diag-line | 2x | bicubic | 3.54 |
| thin-diag-line | 2x | mitchell | 5.53 |
| thin-diag-line | 2x | lanczos2 | 3.5 |
| thin-diag-line | 2x | lanczos3 | 2.91 |
| thin-diag-line | 4x | bilinear | 4.28 |
| thin-diag-line | 4x | bicubic | 2.79 |
| thin-diag-line | 4x | mitchell | 4.07 |
| thin-diag-line | 4x | lanczos2 | 2.77 |
| thin-diag-line | 4x | lanczos3 | 2.42 |
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
| gradient-ramp | 2x | bilinear | 1.45 |
| gradient-ramp | 2x | bicubic | 0.65 |
| gradient-ramp | 2x | mitchell | 1.18 |
| gradient-ramp | 2x | lanczos2 | 0.67 |
| gradient-ramp | 2x | lanczos3 | 0.51 |
| gradient-ramp | 4x | bilinear | 4.11 |
| gradient-ramp | 4x | bicubic | 2.16 |
| gradient-ramp | 4x | mitchell | 3.63 |
| gradient-ramp | 4x | lanczos2 | 2.2 |
| gradient-ramp | 4x | lanczos3 | 1.77 |
| repeated-blocks | 2x | bilinear | 35.02 |
| repeated-blocks | 2x | bicubic | 16.6 |
| repeated-blocks | 2x | mitchell | 29.18 |
| repeated-blocks | 2x | lanczos2 | 17.15 |
| repeated-blocks | 2x | lanczos3 | 11.37 |
| repeated-blocks | 4x | bilinear | 65.63 |
| repeated-blocks | 4x | bicubic | 51.59 |
| repeated-blocks | 4x | mitchell | 65.78 |
| repeated-blocks | 4x | lanczos2 | 50.55 |
| repeated-blocks | 4x | lanczos3 | 49.96 |
| periodic-sine2d | 2x | bilinear | 22.56 |
| periodic-sine2d | 2x | bicubic | 10.88 |
| periodic-sine2d | 2x | mitchell | 18.91 |
| periodic-sine2d | 2x | lanczos2 | 11.19 |
| periodic-sine2d | 2x | lanczos3 | 7.5 |
| periodic-sine2d | 4x | bilinear | 34.83 |
| periodic-sine2d | 4x | bicubic | 27.38 |
| periodic-sine2d | 4x | mitchell | 34.91 |
| periodic-sine2d | 4x | lanczos2 | 26.83 |
| periodic-sine2d | 4x | lanczos3 | 26.52 |
| white-noise | 2x | bilinear | 17.75 |
| white-noise | 2x | bicubic | 10.56 |
| white-noise | 2x | mitchell | 16.01 |
| white-noise | 2x | lanczos2 | 10.35 |
| white-noise | 2x | lanczos3 | 8.98 |
| white-noise | 4x | bilinear | 8.76 |
| white-noise | 4x | bicubic | 6.13 |
| white-noise | 4x | mitchell | 8.52 |
| white-noise | 4x | lanczos2 | 6.05 |
| white-noise | 4x | lanczos3 | 5.5 |
| jpeg-blocks | 2x | bilinear | 16.18 |
| jpeg-blocks | 2x | bicubic | 8.63 |
| jpeg-blocks | 2x | mitchell | 14.04 |
| jpeg-blocks | 2x | lanczos2 | 8.57 |
| jpeg-blocks | 2x | lanczos3 | 7.04 |
| jpeg-blocks | 4x | bilinear | 24.52 |
| jpeg-blocks | 4x | bicubic | 13.74 |
| jpeg-blocks | 4x | mitchell | 22 |
| jpeg-blocks | 4x | lanczos2 | 13.95 |
| jpeg-blocks | 4x | lanczos3 | 10.61 |
| mixed-frequency | 2x | bilinear | 6.42 |
| mixed-frequency | 2x | bicubic | 3.39 |
| mixed-frequency | 2x | mitchell | 5.56 |
| mixed-frequency | 2x | lanczos2 | 3.35 |
| mixed-frequency | 2x | lanczos3 | 2.79 |
| mixed-frequency | 4x | bilinear | 10.63 |
| mixed-frequency | 4x | bicubic | 6.25 |
| mixed-frequency | 4x | mitchell | 9.77 |
| mixed-frequency | 4x | lanczos2 | 6.25 |
| mixed-frequency | 4x | lanczos3 | 5.36 |
| photo-surrogate | 2x | bilinear | 5.72 |
| photo-surrogate | 2x | bicubic | 2.62 |
| photo-surrogate | 2x | mitchell | 4.7 |
| photo-surrogate | 2x | lanczos2 | 2.69 |
| photo-surrogate | 2x | lanczos3 | 1.9 |
| photo-surrogate | 4x | bilinear | 10.23 |
| photo-surrogate | 4x | bicubic | 6.78 |
| photo-surrogate | 4x | mitchell | 9.84 |
| photo-surrogate | 4x | lanczos2 | 6.69 |
| photo-surrogate | 4x | lanczos3 | 6.09 |
