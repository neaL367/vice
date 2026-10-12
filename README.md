# Vice — deterministic image enlargement

Vice enlarges images with mathematics, not models. No neural nets, no training
data, no hallucination: a guarded reconstruction loop whose every output pixel
traces to the input through stated operations. It runs entirely on your device —
drop an image, pick 2×–8×, drag to compare against the original.

## Why it exists

Most upscalers are black boxes: impressive until they invent texture that was
never there. Vice takes the opposite position — every claim is a measurement,
every guarantee is enforced in code:

- **Range guarantee.** Each output block averages to exactly its source pixel.
  Downscale any result with any ordinary tool and you recover the input,
  pixel-for-pixel.
- **Residual guarantee.** The loop projects against the observation every pass;
  final forward residuals sit at ~1e-14.
- **Determinism.** Same bytes in, same bytes out — across runs, languages
  (TypeScript reference ≡ C++ core), and platforms (native ≡ WASM).
- **Falsification discipline.** 20 hypotheses were killed in the open
  (linear-light, adaptive policies, tapered projection, multi-scale pyramid…)
  before the survivors shipped. What remains earned its place by measurement.

## The engine

Per channel, in float64: Lanczos-3 init → 4 guarded IBP passes (bilinear
residual upsample, edge-overshoot penalty, clamp to the observed range, exact
box projection) → integer-exact block quantization.

- Scales 2×/3× run single-stage; **4× stages 2→4** (+0.07 dB, no reversals);
  **8× chains 2→4→8**, each stage projecting against the original input.
- **JPEG/block awareness (H10).** Automatic artifact detection scans horizontal
  and vertical grid phases across [0..7]; gated adaptive boundary coupling
  suppresses blocking artifacts while preserving 100% bit-identity on clean inputs.
- **Burst fusion.** Multi-frame sub-pixel registration with confidence gating,
  reconstructing a high-resolution frame from up to 8 low-light/burst captures.
- **High-throughput 4K pipeline.** Zero-allocation IBP inner loop with precomputed
  upsample plans, shared bilinear sampling in regularization maps, and an instant
  mathematical bypass for constant/alpha channels (saving 25% compute on RGBA
  and 100% on flat tiles).
- **Parallel multi-worker tiling.** Large inputs split into overlapping halo tiles;
  tiles are scheduled concurrently across a Web Worker pool scaling up to 8 CPU
  cores with real-time per-tile progress. Tiled output is bit-exact versus whole-image.
- Measured quality: +0.52 dB over the best fixed kernel on Set5 2×, ringing
  down 3–6× on photos, loop ahead of fixed kernels on every Kodak image at
  4× and 8×.

## The studio

A single-surface comparison workspace:
- **Input:** Drag & drop single images or bursts, browse files, or paste directly
  from your clipboard (`Ctrl+V`).
- **Interactive inspection:** Drag the divider to reveal original vs enlarged,
  zoom and pan freely with high-DPI canvas rendering.
- **Control & cancellation:** Scale toggles (2×, 3×, 4×, 8×) with instant job
  cancellation to regain control on long runs.
- **Export options:** Download in lossless **PNG**, high-efficiency **WebP**
  (~70% smaller), or **JPEG** (with automatic alpha-background compositing).
- **PWA & Offline:** Complete offline functionality via Service Worker caching
  and native standalone installation (`manifest.ts`, vector icons). 100% browser-local,
  zero telemetry, zero server dependencies.

> `research/`, `.agents/`, `.scratch/`, `docs/` are local-only by policy and
> never pushed — see `.gitignore`. Datasets under `tools/eval/data/` likewise.

## Layout

```
vice/
├─ research/          # math program: reference TS, battery, benches, verdicts
│  ├─ REPORT.md                 # iteration synthesis (start here)
│  ├─ falsification.md          # every verdict + 20 killed hypotheses
│  ├─ ref/                      # zero-dependency TS reference (64 tests)
│  └─ results/                  # benchmark tables (battery, Kodak, full sets)
├─ core/              # C++20 engine (ABI 4)
│  ├─ include/vice.h            # C ABI: upscale, progressive, ranged, burst, residual
│  ├─ src/                      # kernels, forward, descriptors, burst,
│  │                            # regularization, ibp, progressive, color, api
│  ├─ tests/test_all.cpp        # native gates incl. tile bit-exactness & burst
│  ├─ apps/vice_upscale.cpp     # PPM CLI (validation bridge)
│  ├─ wasm-build.sh             # em++ bash build script
│  └─ wasm-build.ps1            # em++ PowerShell build script (Windows)
├─ tools/wasm/        # entry.cpp, node smoke test, tiling agreement probe
├─ web/               # Next.js 16.4 + React 19.3 studio (bun, Turbopack)
├─ web/app/           # PWA manifest, viewport metadata, service worker register
├─ web/features/      # workspace, viewport, controls, export formats
├─ web/workers/ lib/  # multi-worker pool, engine (tiling, ceilings)
└─ tools/eval/data/   # gitignored datasets (Kodak, Set5/14, BSD100, Urban100)
```

## Verify it yourself

```bash
bun test research/ref                    # reference suite (64 tests, pre-commit hook)
cmake -S core -B core/build -G "Visual Studio 17 2022" -A x64
cmake --build core/build --config Release
./core/build/Release/vice_tests.exe      # zero warnings, ALL PASS
powershell -File core/wasm-build.ps1     # or bash core/wasm-build.sh (needs emsdk)
node tools/wasm/smoke.mjs                # ABI 4 + residual + exact block sums
node tools/wasm/tiling-check.mjs         # tiled-vs-whole agreement (bit-exact, inf dB)
cd web && bun install && bun run lint    # ESLint + TypeScript check
```

Reference numbers stand for the core: the C++ port cross-validates against the
TypeScript reference within the exact-sum envelope (≤2 levels at ringing
zones), and the WASM binary is rebuilt from the same sources the tests gate.
