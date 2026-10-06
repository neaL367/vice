# Vice — Deterministic Image Enlargement Without AI

Browser-local mathematical upscaler rebuilt from `research/`. No AI/ML, no
uploads: a C++ engine compiles to WASM and runs in a Web Worker.

## Layout

```
vice/
├─ research/          # math program: reference TS, battery, benches, verdicts
│  ├─ REPORT.md                 # 10-iteration synthesis (start here)
│  ├─ ref/                      # zero-dep TS reference (contracts tested)
│  └─ results/                  # benchmark tables
├─ core/              # C++20 engine: port of the guarded loop (see below)
│  ├─ include/vice.h            # minimal C ABI (upscale + residual + version)
│  ├─ src/kernels,forward,ibp,color,api
│  ├─ tests/test_all.cpp        # native gates incl. TS cross-number (47.62 dB)
│  ├─ apps/vice_upscale.cpp     # PPM CLI (validation bridge)
│  └─ wasm-build.sh             # emcc → web/public/wasm (needs D:/emsdk)
├─ tools/wasm/        # entry.cpp + node smoke test (ABI, residual, exact sums)
├─ web/               # Next.js 16 (official scaffold, bun) + worker UI
└─ tools/eval/data/   # gitignored datasets (Kodak, Set5/14, BSD100, Urban100)
```

## Shipped algorithm (portable research result)

Per channel, float64: lanczos3 init → 4 guarded IBP passes
(bilinear residual upsample, clamp to observed range, exact box projection) →
integer-exact block quantization (every s×s block sums to s²× source byte).

## Develop

```bash
bun test research/ref                    # reference suite (51 tests, pre-commit hook)
cmake -S core -B core/build -G "Visual Studio 17 2022" -A x64
cmake --build core/build --config Release
./core/build/Release/vice_tests.exe
bash core/wasm-build.sh                  # needs emsdk
node tools/wasm/smoke.mjs
cd web && bun install && bun run dev     # or build/start
```

Parity: C++ ≡ TS reference bit-identical pre-quantization (47.62 dB cross-number);
stored bytes agree within the exact-sum envelope (59 dB, ≤2 levels at ringing).
Benchmarks: `research/results/` (reference numbers stand for the core).
