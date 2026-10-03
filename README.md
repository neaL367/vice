# Vice — Consistent Super-Resolution Upscaler

Free, private, in-browser mathematical image upscaler. A 6-tap Edge-Adaptive
Lanczos-3 engine reconstructs sharp edges without ringing, while the C++ core
(compiled to WASM) guarantees that original pixels survive exactly: downscale
the result with box averaging and you recover the input.

**Consistency guarantee:** $A(\text{output}) \equiv \text{input}$.
The mathematical projection ensures the range space of the original image is
preserved with zero hallucinated artifacts.

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
  COOP/COEP isolation headers (multithreaded WASM), and a static CSP.

## Quality

Measured with `vice_eval` using the shipped Lanczos-3 adaptive engine and the
shipped projection: 4 rounds of iterative back-projection with a bilinear
correction (`vice_project_smooth`), then an exact box projection. Each image is
degraded two ways (box and bicubic), so every row averages both. `raw` = Lanczos
only, `proj` = after projection. Metrics are on Rec.709 luma. Residual is
≤ 1.1e-7 in every run (float-exact). Seam is the block-boundary gradient ratio;
`seam_hr` is the same metric on the original high-resolution image, so it shows
what "no seams" looks like (≈ 1.0).

| Set      | Scale | PSNR raw → proj | SSIM raw → proj | Seam | seam_hr | Images |
|----------|-------|-----------------|-----------------|------|---------|--------|
| Set5     | 2×    | 31.68 → 32.53   | 0.944 → 0.950   | 1.51 | 1.01    | 10     |
| Set5     | 3×    | 27.89 → 28.01   | 0.879 → 0.879   | 1.32 | 0.99    | 10     |
| Set5     | 4×    | 26.22 → 26.29   | 0.820 → 0.827   | 1.36 | 1.02    | 10     |
| Set14    | 2×    | 28.51 → 28.89   | 0.892 → 0.900   | 1.55 | 1.01    | 28     |
| Set14    | 3×    | 24.93 → 24.85   | 0.782 → 0.784   | 1.33 | 1.00    | 28     |
| Set14    | 4×    | 23.62 → 23.55   | 0.708 → 0.717   | 1.38 | 1.03    | 28     |
| BSD100   | 2×    | 28.32 → 28.59   | 0.873 → 0.882   | 1.61 | 1.01    | 200    |
| BSD100   | 3×    | 24.87 → 24.75   | 0.748 → 0.753   | 1.33 | 1.00    | 200    |
| BSD100   | 4×    | 23.88 → 23.75   | 0.672 → 0.682   | 1.40 | 1.01    | 200    |
| Urban100 | 2×    | 25.69 → 26.02   | 0.870 → 0.880   | 1.56 | 1.01    | 200    |
| Urban100 | 3×    | 22.08 → 22.00   | 0.747 → 0.750   | 1.32 | 1.00    | 200    |
| Urban100 | 4×    | 20.98 → 20.88   | 0.668 → 0.677   | 1.39 | 1.02    | 200    |

Projection raises SSIM in every row except Set5 3× (flat). PSNR rises at 2× and
drops by at most 0.13 dB at 3×/4×. Compared with the earlier box-only
projection, the seam ratio fell from 1.6–1.8 to 1.5–1.6 at 2× and from 1.9–2.1
to 1.3–1.4 at 3×/4×, at a cost of up to 0.07 dB PSNR. It is still above the
ground truth of ≈ 1.0, so some block-boundary structure remains, most visibly
at 2×. More rounds barely help (8 rounds gain ≤ 0.07 seam for 0.02 dB). The
TypeScript fallback (`projectClamp`) uses the same projection and is checked
against the WASM core in `web/lib/vice-wasm.test.ts`.

## Limits

- 2×, 3×, and 4× Edge-Adaptive Lanczos-3 super-resolution with box projection.
- 130 MP output cap, defined once in `web/lib/limits.ts` and used by both the worker and the UI.
- Honors EXIF orientation. `vice_process_band` only quantizes rows of an already-computed full float buffer, so it does not reduce peak memory; true band-streamed upscaling is not implemented.
- 8-bit pipeline (browser decodes 8-bit); wide-gamut treated as sRGB.
- Zero network requests after page load — everything runs purely local on-device.

