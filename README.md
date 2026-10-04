# Vice — Consistent Super-Resolution Upscaler

Free, private, in-browser mathematical image upscaler. A 6-tap Edge-Adaptive
Lanczos-3 engine reconstructs sharp edges without ringing, while the C++ core
(compiled to WASM) guarantees that original pixels survive in physical linear light:
downscale the result with linear-light box averaging and you recover the input.

**Consistency guarantee:** $A(\text{output}) \equiv \text{input}$ (in linear light).
The mathematical projection ensures the range space of the original image is
preserved with zero hallucinated artifacts. Note that consistency holds in linear light
(the physical domain where photons combine additively); standard 8-bit image tools that
downscale in gamma space will observe gamma-curve divergence unless linear-light box
averaging is selected. Quantization to 8-bit applies zero-mean spatial TPDF dither to
prevent banding in gradients, introducing $\pm 0.5$ LSB rounding variance.

## Layout

```
vice/
├─ core/            # C++20: color, projection, tiling, PNG, metrics (CMake)
├─ tools/eval/      # vice_eval CLI: procedural + Set5/Set14/BSD100/Urban100
├─ tools/wasm/      # Emscripten entry point
└─ web/             # Next.js 16 App Router + worker (deploy this on Vercel)
```

## Develop

```bash
# native core
cmake -S core -B core/build -G "Visual Studio 17 2022" -A x64
cmake --build core/build --config Release
./core/build/Release/vice_tests.exe
./core/build/Release/vice_eval.exe tools/eval/data   # needs datasets, see tools/eval/README.md

# web (from web/)
bun install
bun run dev        # predev generates public/vice-worker.js
bun test lib       # unit tests
bun run build      # worker bundle + Next.js production build
bun run test:e2e   # needs playwright browsers + prod server
```

WASM core rebuild needs pinned Emscripten 3.1.74: `bash core/wasm-build.sh`
(`web/public/wasm/*` is committed so deploys work without emsdk).

## Deploy to Vercel

- Import the repo, set **Root Directory** to `web`. Framework preset: Next.js.
- No environment variables required.
- Pure client-side mathematical execution: instant start, zero heavy model downloads.
- `next.config.ts` sets `cacheComponents`, `partialPrefetching`,
  cross-origin isolation headers (COOP/COEP), and a static CSP.

## Quality

Measured with `vice_eval` using the Lanczos-3 adaptive engine and the
projection pipeline: hierarchical multi-grid residual restriction + prolongation,
iterative back-projection with bilinear correction (`vice_project_smooth`), and
an exact clamp-aware box projection (`vice_project_box_clamped`).
Each image is degraded two ways (box and bicubic), so every row averages both.
`raw` = Lanczos only, `proj` = after projection. Metrics are on Rec.709 luma.
Residual is mathematically guaranteed $\le 1.1\times 10^{-7}$ across all natural and
synthetic content, including pure blacks and saturated primaries (via clamp-aware
bisection projection). Seam is the block-boundary gradient ratio; `seam_hr`
is the same metric on the original high-resolution image, so it shows what
"no seams" looks like (≈ 1.0).

*(Note: The PSNR/SSIM metrics below were measured at the shipped defaults —
sharpness 0.35, shock 0.35 (photo) — with `vice_eval` using the Lanczos-3 adaptive
engine and the multigrid + smooth + clamp-aware box projection. Datasets are
external and not checked into the repository, see `tools/eval/README.md`
for fetch instructions).*

| Set      | Scale | PSNR raw → proj | SSIM raw → proj | Seam | seam_hr | Images |
|----------|-------|-----------------|-----------------|------|---------|--------|
| Set5     | 2×    | 30.87 → 31.94   | 0.940 → 0.947   | 1.51 | 1.01    | 10     |
| Set5     | 3×    | 27.64 → 27.87   | 0.877 → 0.878   | 1.33 | 0.99    | 10     |
| Set5     | 4×    | 25.41 → 25.58   | 0.813 → 0.815   | 1.85 | 1.02    | 10     |
| Set14    | 2×    | 28.04 → 28.55   | 0.891 → 0.898   | 1.53 | 1.01    | 28     |
| Set14    | 3×    | 24.77 → 24.76   | 0.781 → 0.782   | 1.35 | 1.00    | 28     |
| Set14    | 4×    | 23.06 → 23.17   | 0.706 → 0.707   | 1.91 | 1.03    | 28     |
| BSD100   | 2×    | 27.99 → 28.35   | 0.873 → 0.880   | 1.58 | 1.01    | 200    |
| BSD100   | 3×    | 24.73 → 24.68   | 0.747 → 0.752   | 1.34 | 1.00    | 200    |
| BSD100   | 4×    | 23.40 → 23.49   | 0.673 → 0.674   | 1.86 | 1.01    | 200    |
| Urban100 | 2×    | 25.32 → 25.77   | 0.870 → 0.878   | 1.53 | 1.01    | 200    |
| Urban100 | 3×    | 21.93 → 21.92   | 0.746 → 0.748   | 1.33 | 1.00    | 200    |
| Urban100 | 4×    | 20.49 → 20.59   | 0.669 → 0.669   | 1.90 | 1.02    | 200    |

Projection raises SSIM in every row. PSNR rises at 2× and 4× and drops by at most
0.05 dB at 3×. Seam sits at 1.5–1.6 at 2× and 1.33–1.35 at 3×, but climbs to
1.85–1.91 at 4×: the chained 2××2× passes compound the null-space sharpness, and
the second 2× upscale re-sharpens an already sharpened mid image. It is still
above the ground truth of ≈ 1.0, so some block-boundary structure remains, most
visibly at 4×. Compared with the earlier box-only projection, the seam ratio fell
from 1.6–1.8 to 1.5–1.6 at 2× and from 1.9–2.1 to 1.3–1.4 at 3×. The TypeScript
fallback (`projectClamp`) uses the same projection and is checked against the
WASM core in `web/lib/vice-wasm.test.ts`.

## Limits

- 2×, 3×, and 4× Edge-Adaptive Lanczos-3 super-resolution with box projection.
- 36 MP output cap (e.g. 6000×6000), defined once in `web/lib/limits.ts` and enforced
  across worker and UI to respect the 2 GB address space ceiling of 32-bit WebAssembly.
- The C++ streaming strip pipeline (`vice_stream_*`) is a prototype for out-of-core band
  processing without whole-image multigrid smoothing; the web app executes full-image
  projection through the WASM worker up to the 36 MP cap.
- Honors EXIF orientation. Preserves embedded ICC profiles (via native PNG iCCP chunks).
- Full alpha transparency support: un-premultiplies RGB on output and preserves linear alpha.
- 8-bit pipeline (browser decodes 8-bit); wide-gamut treated as sRGB.
- Zero network requests after page load — everything runs purely local on-device.

