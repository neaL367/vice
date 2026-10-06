# Vice Research — Deterministic Image Reconstruction Without AI

Math-first program: maximum deterministic enlargement quality under explicit
assumptions (`y = DHx + n`), no AI/ML anywhere. See `research/` + `GLOSSARY.md`.

- `research/research-map.md`, `prior-art-matrix.md`, `foundations.md`, `falsification.md`
- `research/ref/`: zero-dep TypeScript reference (kernels, forward model,
  descriptors, adaptive/guarded IBP, metrics, adversarial battery, benches)
- `research/results/`: benchmark tables (synthetics, Kodak, full sets, mismatch matrix)

Run: `bun test research/ref` · battery: `bun research/ref/bench.ts` ·
photos: `bun research/ref/photos.ts` (needs `tools/eval/data/photos/`, gitignored).

Datasets live gitignored under `tools/eval/data/` (Kodak 5 fetched; Set5/Set14/
BSD100/Urban100 mirrors per `research` notes). No build step, no server, no uploads.
