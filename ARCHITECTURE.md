# Vice Architecture

One engine: the streaming strip pipeline (`vice_stream_*`). "Full image" is a
stream render with one band as tall as the image. See root `README.md` for
numbers.

## 1. System overview

```mermaid
flowchart LR
    subgraph APP["web/ — Next.js 16 + Worker"]
        UI["Workspace UI\n(queue rail · stage · inspector)"]
        UR["UnifiedRenderer\n(single streaming engine)"]
        WASM["WASM core\ncore.wasm / core.threaded.wasm"]
        GPU["WebGPU fallback\n(degraded)"]
        UI --> UR --> WASM
        UR -.-> GPU
    end
    subgraph CORE["core/ — C++20"]
        STREAM["vice_stream_*"]
        PNGW["vice_png_* incremental writer"]
        MATH["lanczos · box · smooth"]
    end
    subgraph OUT["Export targets"]
        BLOB["Blob download\n(capped)"]
        FILE["Save-to-disk\n(uncapped)"]
        DIR["Folder batch\n(uncapped)"]
    end
    WASM --- STREAM
    STREAM --> PNGW
    PNGW --> BLOB & FILE & DIR
    TOOLS["vice_eval · vice_bench4x · vice_tests"] -.-> CORE
```

## 2. One band render (the whole engine)

```mermaid
flowchart TD
    PUSH["push_input_rows\n16-row chunks → in_buf"] --> READY{"has_next_band?\ninput covers req range\n+ lanczos + fused + smooth halo?"}
    READY -- no --> PUSH
    READY -- yes --> COPY["copy req strip from in_buf\n(missing row → return -3, never zeros)"]
    COPY --> UP{"fused 4x?"}
    UP -- yes --> FUSED["fused strip: 2x full → 2x plain/clean or full/detail"]
    UP -- no --> DIRECT["direct upscale strip\nlanczos-3 + shock"]
    FUSED & DIRECT --> SMOOTH["band-local smooth, in place\nbilinear(y − A(raw)) × 4, global coords"]
    SMOOTH --> EXTRACT["extract owned band rows"]
    EXTRACT --> BOX["clamp-aware box projection\nper s×s block (exact residual)"]
    BOX --> QUANT["quantize → 8-bit sRGB\n+ TPDF dither"]
    QUANT --> PNGW2["png_write_rows → drain 256 KB IDAT chunks → sink"]
    PNGW2 --> EVICT["evict consumed input rows\nkeep lookback halo"]
```

## 3. Core module map

```mermaid
flowchart BT
    UPC[upscale.cpp\nlanczos + shock + plain 2nd-pass] --> FUSED2[fused_4x.cpp]
    UPC --> SR[stream_renderer.cpp\nsmooth strip + box + quantize]
    FUSED2 --> SR
    PROJ[project.cpp\nbox + box_clamped] -. tests only .-> SR
    PNGF[png_filters / png_writer / png] --> SR
    PAR[parallel_runtime.cpp\npersistent pool] --> UPC & SR
    COL[color.cpp] --> SR
    MET[metrics.cpp\npsnr · ssim · seam · box-down] --> EVAL[vice_eval · vice_bench4x]
    SR --> ABI[vice.h: stream + png-writer + kernels]
```

## 4. Worker job flow (web)

```mermaid
sequenceDiagram
    participant UI as Inspector/Queue
    participant JC as JobController
    participant W as vice.worker
    participant UR as UnifiedRenderer
    participant FS as FileSystem/Blob sink
    UI->>JC: run / runToFile / runBatchToFolder
    JC->>W: file + scale + chained4x + sink
    W->>W: decode → linear float + ICC + alpha prescan
    W->>UR: render(input, {scale, chained4x}, target)
    loop 64-row bands
        UR->>UR: upscale → smooth → box → quantize
        UR->>FS: write PNG chunk (1-in-flight ack)
        UR->>UI: progress(rows/total)
    end
    UR->>UI: complete{residual, backend, threads, fileBytes}
    Note over UI,FS: Blob path capped per device tier;<br/>disk/folder paths uncapped
```

## 5. Export routing + caps

```mermaid
flowchart TD
    OUTMP["output MP = inMP × scale²"] --> OVER{"over device Blob cap?\n64 / 32 / 16 MP"}
    OVER -- no --> BLOB["Upscale → Blob download\nworks everywhere"]
    OVER -- yes --> FSA{"File System Access\navailable? (Chromium)"}
    FSA -- single file --> DISK["Choose destination & upscale\nuncapped, preview ≤1600px"]
    FSA -- batch --> FOLDER["Choose folder & upscale N\none PNG stream per file"]
    FSA -- no --> BLOCK["blocked with message\n(never a Blob that would OOM)"]
```

## 6. Thread-pool states (`parallel_runtime.cpp`)

One persistent pool; threads are spawned once and park between dispatches.
The caller always participates as one more worker.

```mermaid
stateDiagram-v2
    [*] --> Parked: spawn (joins in-flight dispatch if active)
    Parked --> Working: dispatch (active=true, gen++)
    Working --> Parked: done++ → caller observes size → active=false
    Parked --> [*]: process exit (dead=true)
    note right of Working
        done counts every parked thread:
        a dispatch completes only when
        all threads joined AND finished it.
        No release handshake — the top
        predicate re-validates (active, gen),
        so no dispatch is ever skipped.
    end note
```

Rules: `VICE_MAX_WORKERS=N` caps the count, ranges under 32 rows stay
serial, nested/re-entrant calls from inside a worker run inline.

## 7. Incremental PNG framing (`vice_png_*`)

```mermaid
flowchart LR
    ROWS["8-bit rows top-to-bottom\n(as pulled from bands)"] --> FILT["per-row filter\n(kept: prev row only)"]
    FILT --> DEF["fixed-window DEFLATE\n(64 KB heap scratch)"]
    DEF --> FRM["framed-but-undrained IDAT bytes\n(peak < 1 MB at 500 MP soak)"]
    FRM --> DRAIN["drain → 256 KB IDAT chunks\nCRC per chunk, single zlib stream"]
    DRAIN --> DISK["straight to disk\n(IHDR/iCCP up front, IEND at close)"]
```

`close()` fails unless exactly `h` rows were fed; `drain()` returns
`written == 0` when nothing is pending. Color type is fixed at `open`
(RGB vs RGBA decided from input alpha, not by scanning output).

## 8. Eval / bench policy matrix

| Tool | Policies (all stream API) | Reference columns |
|------|---------------------------|-------------------|
| `vice_eval` | `direct` (default, ships), `clean` (fused mode 1 = shipped 2××2×), `chained` (fused mode 2, engine-only) | raw = Lanczos-only baseline; proj scored in linear light |
| `vice_bench4x` | A tall-direct, B tall-clean, C band-direct, D band-clean, E band-detail | `psnr/B` (tall-clean ref), `psnr/A` (tall-direct ref); D tracks B 41–44 dB |

Tall band (`band_h` = image height) reproduces the retired full-image path:
tall-vs-banded measures 95–999 dB, i.e. band size is nearly irrelevant.
All policies gate on residual < 1e-5; E (detail) never beats D at ~1.5–1.7×
the cost, so only Clean + Direct ship in the UI.
