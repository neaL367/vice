# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **`research/`**: mathematical foundations, prior-art matrix, falsification reports for the deterministic-reconstruction program.
- **`ARCHITECTURE.md`**: the shipped streaming engine (baseline for all comparisons).

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/adr/
├── docs/agents/
├── research/
├── core/          # C++20 streaming engine (shipped baseline)
├── tools/eval/    # vice_eval CLI
├── web/           # Next.js UI
└── .scratch/      # specs + tickets (local tracker)
```

## Use the glossary's vocabulary

When output names a domain concept (issue title, refactor proposal, hypothesis, test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding.
