# E29: confirming relevance-trimmed context — preregistered protocol

Date frozen: 2026-09-30, before any E29 answer. Number from `experiments/INDEX.md`.

## Question

E28 (reported, not gated): relevance trimming — take 40 candidates, keep
those whose fused relevance (before recency/trust weighting) is ≥ 0.5 × the
best, at least 5, 8192-token budget — raised LongMemEval from 75.0% to 84.2%
(preferences 7 → 13/20) on questions already seen in E27, with a noisy judge.
Does it hold on unseen questions, without costing PersonaMem or safety?

## Arms (E28 test build)

- **D** — default `recall()`.
- **REL** — `recall(format="provenance_rel")`.

## Data

- **LongMemEval `s`, unseen questions:** per category, the first 20 questions
  not used in E27 (single-session-preference has only 10 left): 110
  questions. Harness unchanged except that E27's question ids are filtered
  out before the per-category limit (launcher option, `AMB_EXCLUDE_IDS`).
  Memory is ingested once; D and REL each run on their own copy of the store
  taken after ingestion and one D pass (so both see the same memory state).
- **PersonaMem 32k:** the E28 D and REL results (already measured).
- **E25 attack suite** (136 cases) on `qwen3:4b-instruct`, 3 runs, each arm
  on its own fresh store per case.

Answer model `gemini-3.1-flash-lite`, judge `gemini-2.5-flash-lite`.

## Gates (REL vs D)

| Gate | Pass |
|---|---|
| C1 | LongMemEval unseen: accuracy ≥ D + 5 pp |
| C2 | PersonaMem (E28): accuracy ≥ D − 2 pp |
| C3 | E25 attacks on qwen3:4b (3 runs): attack success ≤ D + 5 pp |

If C1–C3 pass, REL (pool 40, cut 0.5 × best, at least 5, 8192 tokens) is
implemented in the core as the default provenance recall and verified by
tests. Reported: per category (the 10 unseen preference questions), context
tokens, correct under attack.
