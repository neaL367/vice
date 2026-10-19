# Vice Golden-Image Regression Corpus

Deterministic PSNR regression tests for the Vice WASM upscaler.
All images are generated synthetically in JS — no external image file dependencies.

## What It Does

`run-golden.mjs` generates six small (≤ 32 px) grayscale test patterns,
upscales them through the Vice WASM binary, then computes **PSNR** by
box-downsampling the output back to the original resolution and comparing
it against the input. Results are compared to stored baselines; the runner
fails (`exit 1`) if any case regresses more than **0.1 dB**.

### Test Cases

| ID | Input | Size | Scale | Pattern |
|----|-------|------|-------|---------|
| `step-2x` | 32×32 | 1ch | 2× | Step edge (left=0, right=255) |
| `gradient-2x` | 32×32 | 1ch | 2× | Horizontal linear ramp (x×8, clamped) |
| `flat-2x` | 32×32 | 1ch | 2× | Uniform gray (128) |
| `step-4x` | 16×16 | 1ch | 4× | Step edge (left=0, right=255) |
| `gradient-4x` | 16×16 | 1ch | 4× | Horizontal linear ramp |
| `checkerboard-2x` | 32×32 | 1ch | 2× | Alternating 0/255 per pixel |

### PSNR Method

```
PSNR = 10 × log₁₀(255² / MSE)
MSE  = mean squared error between
       box-downsampled(upscaled output) and original input
```

The Vice engine conserves block sums exactly (integer-exact), so all
synthetic test cases currently yield **Infinity dB** (MSE = 0). The runner
treats Infinity as a passing condition and guards against regressions that
would drop below a finite value.

## Running

```sh
# Regression check (uses baselines.json):
node tools/eval/run-golden.mjs

# Regenerate baselines from current WASM output:
node tools/eval/run-golden.mjs --update
```

### Output Examples

```
PASS step-2x psnr=Infinity
PASS gradient-2x psnr=Infinity
PASS flat-2x psnr=Infinity
PASS step-4x psnr=Infinity
PASS gradient-4x psnr=Infinity
PASS checkerboard-2x psnr=Infinity
```

Failure output:

```
FAIL gradient-2x psnr=34.10 (baseline=34.25, delta=-0.15)
```

Exit code is `0` (all pass) or `1` (any failure).

## Updating Baselines

Run `--update` after intentional algorithmic changes that alter output:

```sh
node tools/eval/run-golden.mjs --update
git add tools/eval/baselines.json
git commit -m "chore: update golden baselines for <reason>"
```

## File Layout

```
tools/eval/
├── run-golden.mjs   # Runner script
├── baselines.json   # Stored PSNR baselines
└── README.md        # This file
```

## Dependencies

- Node.js ≥ 18 (ES modules, `fs`, `path`, `url` — all built-in)
- `web/public/wasm/core.js` + `core.wasm` (Vice WASM binary)
- No third-party npm packages
