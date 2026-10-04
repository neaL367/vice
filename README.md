# Vice — Consistent Super-Resolution Upscaler

Free, private, in-browser mathematical image upscaler. A 6-tap Edge-Adaptive
Lanczos-3 engine reconstructs edges without ringing, a coherence-shock PDE
steepens blurry transitions into crisp sub-pixel steps, and the C++ core
(compiled to WASM) guarantees that original pixels survive in physical linear
light: downscale the result with linear-light box averaging and you recover
the input.

Two ideas, kept separate. The **exact reconstruction constraint**
($A(\text{output}) \equiv \text{input}$ in linear light) is a mathematical
guarantee enforced by projection: no hallucinated content can leak into the
input's range space. The **perceived detail enhancement** (acutance boost,
null-space sharpness, shock steepening) is heuristic taste: it decides what the
new pixels look like, and its sliders change PSNR/SSIM without touching the
guarantee. Turning sharpness and shock to zero still yields a consistent image —
just a softer one.

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
sharpness 0.35, shock 0.35 (photo), direct (non-chained) 4× — with `vice_eval`
using the Lanczos-3 adaptive engine and the smooth + box projection pipeline.
The app's WASM path runs the same upscaler with multigrid + clamp-aware box
projection on top. Datasets are external and not checked into the repository,
see `tools/eval/README.md` for fetch instructions).*

| Set      | Scale | PSNR raw → proj | SSIM raw → proj | Seam | seam_hr | Images |
|----------|-------|-----------------|-----------------|------|---------|--------|
| Set5     | 2×    | 30.87 → 31.94   | 0.940 → 0.947   | 1.51 | 1.01    | 10     |
| Set5     | 3×    | 27.64 → 27.87   | 0.877 → 0.878   | 1.33 | 0.99    | 10     |
| Set5     | 4×    | 26.11 → 26.21   | 0.819 → 0.826   | 1.35 | 1.02    | 10     |
| Set14    | 2×    | 28.04 → 28.55   | 0.891 → 0.898   | 1.53 | 1.01    | 28     |
| Set14    | 3×    | 24.77 → 24.76   | 0.781 → 0.782   | 1.35 | 1.00    | 28     |
| Set14    | 4×    | 23.55 → 23.50   | 0.708 → 0.715   | 1.37 | 1.03    | 28     |
| BSD100   | 2×    | 27.99 → 28.35   | 0.873 → 0.880   | 1.58 | 1.01    | 200    |
| BSD100   | 3×    | 24.73 → 24.68   | 0.747 → 0.752   | 1.34 | 1.00    | 200    |
| BSD100   | 4×    | 23.81 → 23.71   | 0.672 → 0.681   | 1.38 | 1.01    | 200    |
| Urban100 | 2×    | 25.32 → 25.77   | 0.870 → 0.878   | 1.53 | 1.01    | 200    |
| Urban100 | 3×    | 21.93 → 21.92   | 0.746 → 0.748   | 1.33 | 1.00    | 200    |
| Urban100 | 4×    | 20.91 → 20.84   | 0.667 → 0.676   | 1.37 | 1.02    | 200    |

Projection raises SSIM in every row. PSNR rises at 2× and drops by at most
0.1 dB at 3×/4×. Seam sits at 1.5–1.6 at 2× and 1.33–1.38 at 3×/4× — the old
4× weakness (seam 1.85–1.91) came from the chained 2××2× path re-sharpening an
already sharpened mid image. Measured directly: single-pass 4× beats chained
on all three axes (e.g. Set5 26.21 vs 25.58 dB, seam 1.35 vs 1.85), so direct
4× is the default and the `2××2×` toggle now runs a clean second pass
(sharpness/shock 0, preset/dering kept). No Clean/Detail toggle: there is no
genuine tradeoff to expose. Residual seam above the ≈ 1.0 ground truth is
ordinary block-boundary texture, most visible at 2×. The TypeScript
fallback (`projectClamp`) uses the same projection and is checked against the
WASM core in `web/lib/vice-wasm.test.ts`.

## Limits

- 2×, 3×, and 4× super-resolution (Edge-Adaptive Lanczos-3 + coherence-shock
  PDE) with exact box projection.
- Two engine tiers, routed automatically in the worker. Up to the
  device-dependent full-image cap (24 MP ceiling; 12 MP on 4 GB devices or
  unknown device class, 6 MP at ≤ 2 GB) the WASM engine runs whole-image
  multigrid + clamp-aware box projection. Above it, the streaming strip
  pipeline (`vice_stream_*`) takes over up to the streaming cap (64 MP
  ceiling; 32 MP on 4 GB/unknown, 16 MP at ≤ 2 GB): band-sized float buffers,
  8-bit accumulation, one native PNG encode with iCCP. Band projection is
  box-only (no multigrid) — same residual guarantee, slightly different low
  frequencies (measured ≤ 7 LSB worst on photographic fixtures). Chained 2××2×
  stays on the full-image path. Measured 2026-10-04 in headless Chromium,
  isolated browser-tree RSS: full-image 25 MP peaks at 1.94 GB / 29 s and
  36 MP at 2.62 GB / 43 s (~68 MB per output MP); streaming 64 MP peaks at
  2.13 GB / 66 s. The WASM heap never shrinks, so the tab retains ~peak
  either way; the old flat 36 MP cap sat too close to the 2 GB WASM ceiling
  and is gone. Caps live in `web/lib/limits.ts`.
- Honors EXIF orientation. Preserves embedded ICC profiles (via native PNG iCCP chunks).
- Full alpha transparency support: un-premultiplies RGB on output and preserves linear alpha.
- 8-bit pipeline (browser decodes 8-bit); wide-gamut treated as sRGB.
- Zero network requests after page load — everything runs purely local on-device.
- The WebGPU compute path is a degraded fallback (no ICC embedding, no test
  coverage on this machine — no adapter in headless CI). It is not presented
  as equivalent quality to the WASM engine; see `web/e2e/webgpu.spec.ts`.

