# Vice — Consistent Super-Resolution Upscaler

Free, private, in-browser image upscaler. A compact neural net invents detail;
a C++ core (compiled to WASM) guarantees the original pixels survive exactly:
downscale the result with box averaging and you recover the input.

**Honest claim:** new detail is plausible, not true. The engine line in the UI
shows what ran (`ort-webgpu/wasm + realplksr-x2 + vice-core-wasm`, or which
fallback engaged and why).

## Layout

```
vice/
├─ core/            # C++20: color, projection, tiling, PNG, metrics (CMake)
├─ tools/eval/      # vice_eval CLI: procedural + Set5/Set14/BSD100/Urban100
├─ tools/wasm/      # Emscripten entry point
├─ models/          # weight provenance (binaries gitignored, see LICENSE.md)
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
bun test lib       # unit
bun run build      # prebuild vendors ORT + model + worker, then Next build
bun run test:e2e   # needs playwright browsers + prod server
```

WASM core rebuild needs pinned Emscripten 3.1.74: `bash core/wasm-build.sh`
(`web/public/wasm/*` is committed so deploys work without emsdk).

## Deploy to Vercel

- Import the repo, set **Root Directory** to `web`. Framework preset: Next.js.
- No environment variables. Node runtime (required by Cache Components).
- Build runs `prebuild` automatically: ORT runtime is copied from
  `node_modules`, the 29 MB model downloads from Hugging Face, the worker
  bundle is generated. First build takes a few extra minutes.
- `next.config.ts` already sets `cacheComponents`, `partialPrefetching`,
  COOP/COEP isolation headers (multithreaded WASM), and a static CSP.
- Cold first upscale per page load initializes ONNX (~seconds on desktop);
  the model then stays cached in-browser. Banner-free: check the engine line.

## Limits

- 2× neural (RealPLKSR, MIT). 3× bilinear + projection. 4× is 2× twice.
- 32 MP output cap until band-streamed output lands.
- 8-bit pipeline (browser decodes 8-bit); wide-gamut treated as sRGB.
- No network after assets load — everything runs on-device.
