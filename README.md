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
null-space sharpness, shock steepening) is heuristic taste baked to the
shipped photo values — the engine no longer exposes tuning sliders, presets,
or a `ViceTuning` API. Fixed tuning still yields a consistent image by
construction; projection, not sliders, carries the guarantee.

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
├─ core/            # C++20: color, projection, tiling, upscale, metrics (CMake)
│  ├─ src/png_filters.cpp, png_writer.cpp, png.cpp   # PNG filter / incremental writer / facade
│  ├─ src/engine_context.cpp, stream_renderer.cpp     # compat ctx + streaming strip renderer
│  ├─ src/fused_4x.cpp, parallel_runtime.cpp          # fused chained-4x + thread pool
│  └─ include/vice.h  # typed ViceStatus + streaming/incremental/math/compat C ABI
├─ tools/eval/      # vice_eval CLI: procedural + Set5/Set14/BSD100/Urban100
├─ tools/bench4x/   # vice_bench4x: 5-policy 4x comparison (direct vs chained vs stream vs fused)
├─ tools/lab/       # vice_lab: retired tuning search (engine is fixed-tuning now)
├─ tools/wasm/      # Emscripten entry point
└─ web/             # Next.js 16 App Router + worker (deploy this on Vercel)
   ├─ features/vice/worker/     # decode-input, run-job, emit-preview, protocol, entry
   ├─ features/vice/engine/     # wasm-module, wasm-memory, stream-renderer, png-writer, capabilities
   ├─ features/vice/renderers/  # UnifiedRenderer (single streaming engine, all targets)
   ├─ features/vice/export/     # blob-sink, file-system-sink, worker-chunk-sink
   ├─ features/vice/contracts/  # Scale / ChunkSink / ExportTarget / RenderConfig / RenderResultMeta
   ├─ features/vice/state/      # job-controller + job-reducer
   └─ lib/limits.ts             # Blob-route caps (save-to-disk is uncapped)
```

## Develop

```bash
# native core (from repo root)
cmake -S core -B core/build -G "Visual Studio 17 2022" -A x64
cmake --build core/build --config Release
./core/build/Release/vice_tests.exe          # C++ unit gates
./core/build/Release/vice_eval.exe tools/eval/data    # needs datasets, see tools/eval/README.md
./core/build/Release/vice_bench4x.exe tools/eval/data  # 5-policy 4x table, residual gate <1e-5

# web (from repo root; scripts forward into web/)
bun install --cwd web
bun run dev        # predev builds public/vice-worker.js
bun run test       # bun test web/lib (incl. render-matrix characterization)
bun run build      # worker bundle + Next.js production build
bun run test:e2e   # Playwright + prod server (incl. infinite + workspace specs)
bun run test:native

# web directly (from web/)
bun install
bun run dev
bun run worker:build
bun test lib
```

WASM rebuild needs pinned Emscripten 3.1.74: `bash core/wasm-build.sh`.
Builds both `core.js/wasm` (single-thread) and `core.threaded.js/wasm`
(`-pthread -DVICE_THREADS`, pool 4). `web/public/wasm/*` is committed so
deploys work without emsdk.

## Engines

- **Single-thread `core.wasm`** — always available fallback.
- **Threaded `core.threaded.wasm`** — `VICE_THREADS` row sharding in upscale
  passes + band projection. Loads only when `crossOriginIsolated`
  (COOP/COEP headers, see `web/next.config.ts`); otherwise silent fallback.
  Measured 25 MP infinite: 10.8 s vs 16.0 s single (1.48×), identical
  residual/bytes (measured before the persistent pool below; pool removes the
  old per-call thread spawn cost, so this is a floor). Inspector shows `T4`
  badge via `threads` in result meta. Threading is a persistent pool, not a
  spawn-per-call: threads park on a condition variable between dispatches and
  the caller participates as one more worker. Worker count follows
  `hardware_concurrency` (native, up to 64; Emscripten capped at 4 to match
  `-sPTHREAD_POOL_SIZE=4`), `VICE_MAX_WORKERS=N` caps it, tiny ranges (< 32
  rows) stay serial. Both WASM builds are release (`-sASSERTIONS=0`).
- **UnifiedRenderer** (`web/features/vice/renderers/unified-renderer.ts`) —
  the only render path. Streams 64-row bands → incremental PNG writer →
  `ChunkSink` (Blob / File / Folder). No separate full/stream/fused/fallback
  renderers. `ViceCore` (`web/lib/vice-wasm.ts`) is a thin compat facade over
  `engine/wasm-module + wasm-memory + capabilities`.
- **WebGPU** is a degraded fallback only (no ICC embedding, no adapter in
  headless CI). Not presented as equivalent quality; see
  `web/e2e/webgpu.spec.ts`.
- **Stream API contract** (`vice_stream_*`): `pull_band` returns 1 (final),
  0 (more), -1 (bad args/upscale failure), -2 (push more input rows first),
  -3 (required input row missing from the buffer — never silent black rows).
  Size pull buffers for the scale-rounded band (`((band_h + s - 1) / s) * s`
  rows, e.g. 64 → 66 at 3×), not `band_h`.
- **Fused 4× modes** (`vice_stream_set_fused`, scale-4 only): 1 = clean
  (full first pass, plain Lanczos+dering second pass so the mid image is
  never re-sharpened; shipped `2××2×` default), 2 = detail (full tuning both
  passes, engine-only). Modes differ by construction (native + WASM tests
  assert non-identical bytes); residual is exact either way.

## Export routes

- **Blob (in-memory download):** capped by device tier
  (`web/lib/limits.ts`): 64 MP (≥8 GB / SSR), 32 MP (4 GB / unknown),
  16 MP (≤2 GB). Above the cap the UI offers save-to-disk instead.
- **Save-to-disk (infinite, uncapped):** File System Access writable +
  1-in-flight ack backpressure. Native incremental writer (`vice_png_*`):
  band rows in, 256 KB IDAT chunks out, only prev row + fixed DEFLATE window
  + undrained chunks retained. 500 MP soak holds peak under 1 MB with every
  chunk CRC, zlib adler, and 20000 rows verified. Tiled input-alpha prescan
  fixes RGB/RGBA upfront; box-downsampled ≤1600 px preview replaces the giant
  Blob. Output size changes time + disk, not peak RAM.
- **Batch folder save:** one directory picker, each file streams to its own
  PNG via the same infinite path; previews only in-app.

## App UI

Calibration workspace shell: 52 px header (identity + New/Export only),
three-region layout (queue rail, image workspace, inspector), 36 px evidence
rail (staged dims, progress, result facts: dims, residual, ms, backend, ICC).
Inspector holds scale (2/3/4) + 4× Direct / 2××2× toggle + MP budget line;
no preset / sharpness / shock / dering controls (engine is fixed-tuning).
Mobile bottom bar + queue/settings sheets below `lg`. `durationMs` plumbed
worker → result. Results report `threads` (T4) when the threaded core ran.

## Quality

`vice_eval` degrades each image two ways (box and bicubic), so every row
averages both. `raw` = Lanczos only, `proj` = after projection. The app ships
only the streaming path, so the proj leg renders through the streaming strip
API (64-row bands) and scores in linear light: the table below measures
shipped bytes. The strip runs band-local smooth back-projection (one-block
halo, `VICE_SMOOTH_ITERS` iterations) followed by the exact clamp-aware box
projection; see `vice_bench4x` for the full-image multigrid comparison.
Residual is mathematically guaranteed $\le 1.1\times 10^{-7}$ across all
natural and synthetic content, including pure blacks and saturated primaries
(via clamp-aware bisection projection). Seam is the block-boundary gradient
ratio. Datasets are external and not checked into the repository, see
`tools/eval/README.md` for fetch instructions.

*(Linear-light scoring, direct 4×. Not comparable to the older sRGB-space
numbers from the smooth + box era — same images, different ruler.)*

| Set      | Scale | PSNR raw → proj | SSIM raw → proj | Seam | Images |
|----------|-------|-----------------|-----------------|------|--------|
| Set5     | 2×    | 31.23 → 32.33   | 0.947 → 0.954   | 1.55 | 10     |
| Set5     | 3×    | 28.18 → 28.47   | 0.891 → 0.893   | 1.42 | 10     |
| Set5     | 4×    | 26.82 → 26.98   | 0.841 → 0.846   | 1.47 | 10     |
| Set14    | 2×    | 28.12 → 28.60   | 0.900 → 0.907   | 1.61 | 28     |
| Set14    | 3×    | 24.94 → 24.95   | 0.800 → 0.803   | 1.50 | 28     |
| Set14    | 4×    | 23.83 → 23.79   | 0.733 → 0.742   | 1.58 | 28     |
| BSD100   | 2×    | 28.33 → 28.72   | 0.884 → 0.891   | 1.61 | 200    |
| BSD100   | 3×    | 25.14 → 25.13   | 0.774 → 0.778   | 1.44 | 200    |
| BSD100   | 4×    | 24.24 → 24.16   | 0.710 → 0.718   | 1.50 | 200    |
| Urban100 | 2×    | 25.28 → 25.72   | 0.876 → 0.884   | 1.64 | 200    |
| Urban100 | 3×    | 22.04 → 22.05   | 0.762 → 0.766   | 1.55 | 200    |
| Urban100 | 4×    | 21.06 → 20.99   | 0.692 → 0.700   | 1.63 | 200    |

Projection raises SSIM in every row; PSNR rises at 2× and holds within
0.1 dB at 3×/4×. Seam sits at 1.4–1.7 with residual ≈ 3e-8 everywhere.
Direct 4× is the default and the `2××2×` toggle runs a clean fused second
pass (6-row input halo, joint == interior on hard-edge seam fixtures at
16/32/48/64-row bands; clean and detail modes differ by construction).
The TypeScript fallback (`projectClamp`) uses the same projection and is
checked against the WASM core in `web/lib/vice-wasm.test.ts`.

Why band-local smooth exists: an independent synthetic hard-edge probe
showed the old box-only stream path trailing the multigrid path (3× seam
3.98 vs 3.08, 4× 3.89 vs 3.12, residual exact either way — that probe image
was synthetic, so it says nothing about natural content). The one-block-halo
smooth closes it: on our hard-edge fixture the stream seam now measures 2.37
at 3× and 2.50 at 4× (native test `test_stream_band_smooth`, bound 3.5),
and the adversarial synthetic suite drops 4.44 → 3.07 (3×) and 3.90 → 2.83
(4×). It costs about 2× stream render time versus box-only for the
`VICE_SMOOTH_ITERS` passes — the threaded pool absorbs it in-app.

4× policy bench (`vice_bench4x`, Set5/BSD100/Urban100 SRF_4 + procedural
edge): all five policies (A full-direct, B full-chained-clean, C
stream-direct, D stream fused-clean, E stream fused-detail) land within ~1 dB
of HR ground truth; D tracks B at 41–44 dB (C tracks A at 36–57 dB).
E (detail) never beats D and costs ~1.5–1.7× time, so only Clean (fused
mode 1) and Direct ship in the UI; mode 2 stays engine-only. All policies
gate on residual < 1e-5.

## Limits

- 2×, 3×, and 4× super-resolution (Edge-Adaptive Lanczos-3 + coherence-shock
  PDE, fixed photo tuning) with exact box projection.
- One streaming engine for everything. Blob downloads are device-gated
  (64 MP ceiling; 32 MP on 4 GB/unknown, 16 MP at ≤ 2 GB). Save-to-disk and
  folder batch have **no output MP cap**: band-sized float buffers, 8-bit
  accumulation, incremental PNG encode straight to disk (500 MP soak < 1 MB
  PNG-writer peak). Chained 2××2× runs fused with a 6-row halo on the same
  path (clean = plain Lanczos+dering second pass; halo recompute is
  negligible for direct 4×, ~2.25× band cost for chained at 64-row bands).
  Band scratch buffers (input/band/upscaled/fused strips) are reused across
  pulls, so steady-state rendering performs zero allocations per band.
  Measured 2026-10-04 in headless Chromium, isolated browser-tree RSS:
  full-image 25 MP peaks at 1.94 GB / 29 s and 36 MP at 2.62 GB / 43 s
  (~68 MB per output MP); streaming 64 MP Blob peaks at 2.13 GB / 66 s
  (pre-smooth timings — the band-local smooth passes roughly double strip
  compute; the threaded pool absorbs it in-app);
  threaded infinite 25 MP drops to 10.8 s (1.48× vs single, pre-pool floor).
  The WASM heap never shrinks, so the tab retains ~peak either way. Caps live
  in `web/lib/limits.ts` and gate Blob downloads only.
- Browser support: the infinite export needs the File System Access API
  (Chromium). Firefox/Safari fall back to capped Blob downloads only —
  over-cap outputs are blocked with a message naming Chrome/Edge desktop,
  never a Blob that would OOM the tab. In-cap Blob export works everywhere.
- Honors EXIF orientation. Preserves embedded ICC profiles (via native PNG iCCP chunks).
- Full alpha transparency support: un-premultiplies RGB on output and preserves linear alpha.
- 8-bit pipeline (browser decodes 8-bit); wide-gamut treated as sRGB.
- Zero network requests after page load — everything runs purely local on-device.
- The WebGPU compute path is a degraded fallback (no ICC embedding, no test
  coverage on this machine — no adapter in headless CI). It is not presented
  as equivalent quality to the WASM engine; see `web/e2e/webgpu.spec.ts`.

## Deploy to Vercel

- Import the repo, set **Root Directory** to `web`. Framework preset: Next.js.
- No environment variables required.
- Pure client-side mathematical execution: instant start, zero heavy model downloads.
- `next.config.ts` sets `cacheComponents`, `partialPrefetching`,
  cross-origin isolation headers (COOP/COEP), and a static CSP.
- The threaded core needs that isolation (`same-origin` + `require-corp`):
  any later cross-origin font, image, or script must send CORP/CORS headers
  or it breaks. Same-origin assets only — re-verify prefetch + navigation
  after touching headers.
