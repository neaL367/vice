# Vice — Consistent Super-Resolution Upscaler

Free, private, in-browser mathematical image upscaler. A 6-tap Edge-Adaptive
Lanczos-3 engine reconstructs edges without ringing, a coherence-shock PDE
steepens blurry transitions into crisp sub-pixel steps, and the C++ core
(compiled to WASM) guarantees the original pixels survive in the stored
8-bit values: box-downscale the output PNG with any ordinary image tool and
you recover the source image exactly.

Two ideas, kept separate. The **exact reconstruction constraint** — every
s×s output block sums to s²× the source byte — is enforced by projection
plus integer-exact quantization: no hallucinated content can leak into the
input's range space. The **perceived detail enhancement** (acutance boost,
null-space sharpness, shock steepening) is heuristic taste baked to the
shipped photo values — the engine no longer exposes tuning sliders, presets,
or a `ViceTuning` API. Fixed tuning still yields a consistent image by
construction; projection, not sliders, carries the guarantee.

**Consistency guarantee:** every stored s×s block sums to s²× its source
byte (opaque content; translucent RGB keeps plain rounding, alpha sums are
always exact). Downscale with `magick out.png -filter box -resize 25%` (or
any box averager) and the result equals the source pixel-for-pixel: 0 error
under ImageMagick-style sum-then-divide; ≤ 1 level under tools that round in
passes (e.g. Pillow's two-pass `BOX`). The linear-light projection underneath
still holds the range space exact (residual ≤ 1.1×10⁻⁷); the integer sums are
what make it checkable without Vice.

## Layout

```
vice/
├─ core/            # C++20: color, projection, upscale, metrics (CMake)
│  ├─ src/png_filters.cpp, png_writer.cpp, png.cpp   # PNG filter / incremental writer / facade
│  ├─ src/stream_renderer.cpp     # streaming strip renderer (the only render path)
│  ├─ src/block_project.h         # single clamp-aware box kernel (strip + full-image)
│  ├─ src/abi.cpp                 # ABI version handshake
│  ├─ src/fused_4x.cpp, parallel_runtime.cpp          # fused chained-4x + thread pool
│  └─ include/vice.h  # streaming + incremental-PNG + math-kernel C ABI
├─ tools/eval/      # vice_eval CLI: procedural + Set5/Set14/BSD100/Urban100
├─ tools/bench4x/   # vice_bench4x: 5-policy stream 4x comparison (tall vs banded bands)
├─ tools/lab/       # vice_lab: retired tuning search (engine is fixed-tuning now)
├─ tools/wasm/      # Emscripten entry point
└─ web/             # Next.js 16 App Router + worker (deploy this on Vercel)
   ├─ features/vice/worker/     # decode-input, coordinate, slab-worker, subworkers, protocol, entry
   ├─ features/vice/engine/     # wasm-module, wasm-memory, stream-renderer, png-writer, png-segment, capabilities
   ├─ features/vice/slabs/      # geometry, crc, assemble (fixed boundaries, framing)
   ├─ features/vice/planner/    # probe, plan, names (plan once, execute without branching)
   ├─ features/vice/export/     # blob/file-system/opfs/worker-chunk sinks
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
Builds one single-thread `core.js/wasm` (release, `-sASSERTIONS=0`); every
slab worker loads its own instance. `web/public/wasm/*` is committed so
deploys work without emsdk.

## Engines

- **Slab workers (share-nothing)** — the only parallel engine. The
  coordinator (`worker/coordinate.ts`) decodes once, plans
  (`planner/planRender`), and fans fixed slabs out to K plain Workers, each
  with its own single-thread WASM core: no SharedArrayBuffer, no COOP/COEP,
  no second WASM build. Slab boundaries depend only on image + scale, never
  on K, so bytes never depend on worker count (pinned: K=1 vs K=4+
  separate-instances schedules produce identical blobs). K comes from the
  planner (cores + 256 MB/worker budget floor). Inspector `threads` is K.
- **Coordinator** (`worker/coordinate.ts`) — decode once, fan out, assemble
  in order. Streams framed PNG bytes (header → ordered IDATs → combined
  adler → IEND) into Blob / File / OPFS sinks, or per-slab strip PNGs to
  main for download (never a dead end). Preview accumulator feeds from owned
  rows in any completion order; over-cap Blob without a disk route errors
  with numbers and a suggested action instead of OOMing.
- One engine everywhere: "full image" is just a stream render with one band
  as tall as the image — tall vs 64-row bands are bit-identical (exact sums
  absorb sub-LSB band diffs). Mid-image slabs with the
  queried halo match the tall render byte-exactly (`test_stream_slab_origin`,
  `test_stream_slab_tiling`). No TS mirror of the algorithm remains
  (`lib/pipeline` holds only `color.ts`
  LUTs used by the worker decoder); the WASM load carries an ABI version
  handshake (`vice_abi_version`, mismatch is a hard error) plus stream-function
  presence checks, and the C ABI keeps just the Lanczos kernel, the box
  projections, and the streaming/incremental-PNG/segment surface.
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
worker → result. Results report `threads` (slab-worker count K).

## Quality

`vice_eval` degrades each image two ways (box and bicubic), so every row
averages both. `raw` = Lanczos only, `proj` = after projection. The app ships
only the streaming path, so the proj leg renders through the streaming strip
API (64-row bands) and scores in linear light: the table below measures
shipped bytes. The strip runs band-local smooth back-projection (one-block
halo, `VICE_SMOOTH_ITERS` iterations) followed by the exact clamp-aware box
projection; `vice_bench4x` cross-checks tall bands against 64-row bands.
Residual is mathematically guaranteed $\le 1.1\times 10^{-7}$ across all
natural and synthetic content, including pure blacks and saturated primaries
(via clamp-aware bisection projection). Seam is the block-boundary gradient
ratio. Datasets are external and not checked into the repository, see
`tools/eval/README.md` for fetch instructions.

*(Linear-light scoring, direct 4×. Not comparable to older sRGB-space
numbers — same images, different ruler.)*

| Set      | Scale | PSNR raw → proj | SSIM raw → proj | Seam | Images |
|----------|-------|-----------------|-----------------|------|--------|
| Set5     | 2×    | 31.23 → 32.25   | 0.947 → 0.954   | 1.50 | 10     |
| Set5     | 3×    | 28.18 → 28.47   | 0.891 → 0.894   | 1.32 | 10     |
| Set5     | 4×    | 26.82 → 27.01   | 0.841 → 0.848   | 1.34 | 10     |
| Set14    | 2×    | 28.12 → 28.58   | 0.900 → 0.907   | 1.55 | 28     |
| Set14    | 3×    | 24.94 → 24.97   | 0.800 → 0.803   | 1.40 | 28     |
| Set14    | 4×    | 23.83 → 23.84   | 0.733 → 0.744   | 1.45 | 28     |
| BSD100   | 2×    | 28.33 → 28.66   | 0.884 → 0.891   | 1.56 | 200    |
| BSD100   | 3×    | 25.14 → 25.10   | 0.774 → 0.777   | 1.34 | 200    |
| BSD100   | 4×    | 24.24 → 24.15   | 0.710 → 0.717   | 1.37 | 200    |
| Urban100 | 2×    | 25.28 → 25.72   | 0.876 → 0.885   | 1.55 | 200    |
| Urban100 | 3×    | 22.04 → 22.06   | 0.762 → 0.766   | 1.41 | 200    |
| Urban100 | 4×    | 21.06 → 21.02   | 0.692 → 0.701   | 1.45 | 200    |

Same table in the encoded domain (stored bytes vs sRGB HR — the domain the
guarantee lives in), with the integer-sum proof beside it:

| Set      | Scale | PSNR raw → proj | SSIM raw → proj | Seam | Blocks exact |
|----------|-------|-----------------|-----------------|------|--------------|
| Set5     | 2×    | 29.68 → 31.34   | 0.933 → 0.943   | 1.46 | all |
| Set5     | 3×    | 27.00 → 27.38   | 0.870 → 0.871   | 1.28 | all |
| Set5     | 4×    | 25.62 → 25.80   | 0.811 → 0.816   | 1.35 | all |
| Set14    | 2×    | 27.33 → 28.19   | 0.883 → 0.894   | 1.52 | all |
| Set14    | 3×    | 24.39 → 24.44   | 0.773 → 0.776   | 1.37 | all |
| Set14    | 4×    | 23.25 → 23.23   | 0.700 → 0.710   | 1.46 | all |
| BSD100   | 2×    | 27.50 → 27.98   | 0.866 → 0.875   | 1.52 | all |
| BSD100   | 3×    | 24.49 → 24.33   | 0.741 → 0.743   | 1.25 | all |
| BSD100   | 4×    | 23.63 → 23.40   | 0.666 → 0.672   | 1.30 | all |
| Urban100 | 2×    | 24.60 → 25.41   | 0.861 → 0.874   | 1.52 | all |
| Urban100 | 3×    | 21.56 → 21.66   | 0.737 → 0.743   | 1.39 | all |
| Urban100 | 4×    | 20.63 → 20.60   | 0.657 → 0.669   | 1.46 | all |

245,458,272 blocks verified, 0 violations (`vice_eval … direct encoded`).
Projection raises SSIM in every row in both domains; PSNR rises at 2× and
holds within 0.3 dB at 3×/4×. Against the old dithered quantizer the
exact-sum output gains +0.2–0.5 dB PSNR, +0.001–0.005 SSIM, and −0.05–0.1
seam on every row — the integer constraint also straightens block steps.
Direct 4× is the default and the `2××2×` toggle runs a clean fused second
pass (6-row input halo, joint == interior on hard-edge seam fixtures at
16/32/48/64-row bands; clean and detail modes differ by construction).
The TypeScript fallback (`projectClamp`) uses the same projection and is
checked against the WASM core in `web/lib/vice-wasm.test.ts`.

Why band-local smooth exists: an independent synthetic hard-edge probe
showed the box-only stream path trailing the old full-image multigrid
reference (3× seam 3.98 vs 3.08, 4× 3.89 vs 3.12, residual exact either
way — that probe image was synthetic, so it says nothing about natural
content). The band-local smooth (halo sized so mid-image slabs match the
tall-band render byte-exactly — see `vice_stream_halo_rows` /
`vice_stream_begin_slab`) closes it: on our hard-edge fixture
the stream seam now measures 2.37 at 3× and 2.50 at 4× (native test
`test_stream_band_smooth`, bound 3.5), and the adversarial synthetic suite
drops 4.44 → 3.07 (3×) and 3.90 → 2.83 (4×). It costs about 2× stream
render time versus box-only for the `VICE_SMOOTH_ITERS` passes — slab
workers absorb it across cores in-app.

4× policy bench (`vice_bench4x`, Set5/BSD100/Urban100 SRF_4 + procedural
edge): all five policies (A tall-direct, B tall-fused-clean, C band-direct,
D band-fused-clean, E band-fused-detail) land within ~1 dB of HR ground
truth; D tracks B and C tracks A at 999 dB (bit-identical tall vs banded).
E (detail) never beats
D and costs ~1.5–1.7× time, so only Clean (fused mode 1) and Direct ship in
the UI; mode 2 stays engine-only. All policies gate on residual < 1e-5.

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
  Measured 2026-10-04 in headless Chromium, isolated browser-tree RSS
  (single-engine era numbers — same engine, pre-slab orchestration):
  25 MP peaks at 1.94 GB / 29 s and 36 MP at 2.62 GB / 43 s
  (~68 MB per output MP); streaming 64 MP Blob peaks at 2.13 GB / 66 s.
  Slab workers (one WASM instance each) replace thread-level parallelism —
  wall time unmeasured on this box; per-worker cost is one 64 MB base heap
  plus band working sets, capped by the planner budget.
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
- No WebGPU path and no threaded WASM: slab workers are plain Workers with
  per-worker single-thread cores. There is no degraded-fallback engine; if no
  compute backend exists the job fails loudly instead of degrading pixels.

## Deploy to Vercel

- Import the repo, set **Root Directory** to `web`. Framework preset: Next.js.
- No environment variables required.
- Pure client-side mathematical execution: instant start, zero heavy model downloads.
- `next.config.ts` sets `cacheComponents`, `partialPrefetching`, and a static
  CSP. No cross-origin isolation headers: slab workers need neither
  SharedArrayBuffer nor COOP/COEP, so third-party embeds need no CORP headers.
