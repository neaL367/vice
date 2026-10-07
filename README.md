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
- Large inputs split into overlapping halo tiles with per-tile progress;
  tiled output is bit-exact versus whole-image.
- Measured quality: +0.52 dB over the best fixed kernel on Set5 2×, ringing
  down 3–6× on photos, loop ahead of fixed kernels on every Kodak image at
  4× and 8×.

## The studio

A single-surface comparison workspace: drop / browse / paste an image, pick a
scale, drag the divider to reveal original vs enlarged, zoom and pan freely,
download the full-resolution PNG. The WASM core runs in a Web Worker —
the UI never blocks. First visit caches shell + engine via service worker,
so the studio works fully offline afterwards. 8× is offered for inputs
≤512px on the long side; oversized jobs refuse with guidance instead of
crashing a tab.

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
├─ core/              # C++20 engine (ABI 3)
│  ├─ include/vice.h            # C ABI: upscale, progressive, ranged, residual
│  ├─ src/                      # kernels, forward, descriptors,
│  │                            # regularization, ibp, progressive, color, api
│  ├─ tests/test_all.cpp        # native gates incl. tile bit-exactness
│  ├─ apps/vice_upscale.cpp     # PPM CLI (validation bridge)
│  └─ wasm-build.sh             # emcc → web/public/wasm (needs D:/emsdk)
├─ tools/wasm/        # entry.cpp, node smoke test, tiling agreement probe
├─ web/               # Next.js 16.4 + React 19.3 studio (bun, Turbopack)
│  ├─ app/                      # shell, static guard, offline registration
│  ├─ features/studio/          # workspace, viewport geometry, gestures
│  ├─ workers/ lib/             # WASM worker, engine (tiling, ceilings)
│  └─ e2e/studio.spec.ts        # 14 Playwright tests on real Chrome
└─ tools/eval/data/   # gitignored datasets (Kodak, Set5/14, BSD100, Urban100)
```

## Verify it yourself

```bash
bun test research/ref                    # reference suite (64 tests, pre-commit hook)
cmake -S core -B core/build -G "Visual Studio 17 2022" -A x64
cmake --build core/build --config Release
./core/build/Release/vice_tests.exe      # zero warnings, ALL PASS
bash core/wasm-build.sh                  # needs emsdk on PATH
node tools/wasm/smoke.mjs                # ABI + residual + exact block sums
node tools/wasm/tiling-check.mjs         # tiled-vs-whole agreement (bit-exact)
bun research/ref/validate-cpp.ts         # TS↔C++ parity: 2× 59.11 dB, 4× 60.71 dB, 8× 63.32 dB
cd web && bun install && bunx playwright test   # 14 E2E incl. offline + tiling
```

Reference numbers stand for the core: the C++ port cross-validates against the
TypeScript reference within the exact-sum envelope (≤2 levels at ringing
zones), and the WASM binary is rebuilt from the same sources the tests gate.
