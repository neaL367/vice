# Vice — Deterministic Image Enlargement Without AI

Browser-local mathematical upscaler. No AI/ML, no uploads: a C++ engine
compiles to WASM and runs in a Web Worker behind a single-surface
comparison studio.

> Research notes (`research/`), agent skills (`.agents/`), scratch work
> (`.scratch/`), and `docs/` are local-only and never pushed — see `.gitignore`.

## Layout

```
vice/
├─ research/          # math program: reference TS, battery, benches, verdicts
│  ├─ REPORT.md                 # 10-iteration synthesis (start here)
│  ├─ falsification.md           # every verdict + 16 killed hypotheses
│  ├─ ref/                      # zero-dep TS reference (contracts tested)
│  └─ results/                  # benchmark tables (battery, Kodak, full sets)
├─ core/              # C++20 engine: port of the guarded loop (see below)
│  ├─ include/vice.h            # minimal C ABI (upscale + residual + version)
│  ├─ src/kernels,forward,descriptors,regularization,ibp,color,api
│  ├─ tests/test_all.cpp        # native gates incl. TS cross-number (47.62 dB)
│  ├─ apps/vice_upscale.cpp     # PPM CLI (validation bridge)
│  └─ wasm-build.sh             # emcc → web/public/wasm (needs D:/emsdk)
├─ tools/wasm/        # entry.cpp + node smoke test (ABI, residual, exact sums)
├─ web/               # Next.js 16 (official scaffold, bun) + worker studio UI
│  ├─ features/studio/         # workspace, single-rect viewport, gestures
│  └─ e2e/studio.spec.ts        # 9 Playwright tests on real Chrome
└─ tools/eval/data/   # gitignored datasets (Kodak, Set5/14, BSD100, Urban100)
```

## Shipped algorithm (portable research result)

Per channel, float64: lanczos3 init → 4 guarded IBP passes (bilinear residual
upsample, R_edge penalty step, clamp to observed range, exact box projection)
→ integer-exact block quantization (every s×s block sums to s²× source byte).

R_edge penalizes edge overshoot beyond the local observation range during
reconstruction; coherent structure passes untouched. Residual ~1e-14; ringing
down 3–6x vs Lanczos on photos; Set5 2x +0.52 dB over best fixed kernel.

## Develop

```bash
bun test research/ref                    # reference suite (57 tests, pre-commit hook)
cmake -S core -B core/build -G "Visual Studio 17 2022" -A x64
cmake --build core/build --config Release
./core/build/Release/vice_tests.exe      # zero warnings, ALL PASS
bash core/wasm-build.sh                  # needs emsdk
node tools/wasm/smoke.mjs                # ABI + residual + exact sums
bun research/ref/validate-cpp.ts         # TS↔C++ byte parity gate
cd web && bun install && bun run dev     # or build/start/test (Playwright)
```

Parity: C++ ≡ TS reference bit-identical pre-quantization (47.62 dB cross-number);
stored bytes agree within the exact-sum envelope (59 dB, ≤2 levels at ringing).
Benchmarks: `research/results/` (reference numbers stand for the core).
