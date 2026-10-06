# ADR-0001: Constrained deterministic reconstruction program

- Status: accepted
- Date: 2026-10-06

## Context

Shipped engine (`core/` stream path: adaptive Lanczos-3 + shock + band-local smooth + exact box projection) is the baseline. User requests a deeper program: determine maximum deterministic reconstruction quality under explicit assumptions, with no AI/ML anywhere.

## Decision

1. New work lives in `research/` (docs + reference TS + adversarial harness). `core/` and `web/` stay untouched until a hypothesis survives falsification + benchmark.
2. Reference-before-optimized: TypeScript clarity-first implementation validates math; C++ port only after reference wins measured comparisons.
3. Every claim classified: established mathematics / engineering improvement / novel hypothesis / potential new theory. Existing techniques never presented as new.
4. Falsification-first: synthetic adversarial suite before natural images. Failed hypotheses discarded in writing.
5. Local markdown tracker (`.scratch/`); research artifacts tracked in `research/`.

## Consequences

- Slower start (docs before code) in exchange for explainability.
- `core/` remains the regression baseline; `vice_eval` numbers are the bar to beat.
