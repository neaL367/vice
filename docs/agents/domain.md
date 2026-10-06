# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **`research/`**: mathematical foundations, prior-art matrix, falsification reports.
- **`README.md`**: program overview (research-only repo; old app engine removed).

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── README.md
├── docs/adr/
├── docs/agents/
├── research/
└── .scratch/      # specs + tickets (local tracker)
```

Datasets (gitignored) under `tools/eval/data/` feed the TS harnesses.

## Use the glossary's vocabulary

When output names a domain concept (issue title, refactor proposal, hypothesis, test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding.
