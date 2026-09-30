# E28: how many records the provenance context carries — preregistered protocol

Date frozen: 2026-09-30, before any E28 answer. Number from `experiments/INDEX.md`.

## Question

E27 showed two opposite failure modes of Aura's default context (20 records,
2048-token budget): on LongMemEval preference questions the needed user turn
was in the context 20/20 times, yet answers mixed in unrelated preferences
from other sessions (over-inclusion); on PersonaMem "suggest new ideas"
(32%) the model must know everything the user already tried, which 20
records may not cover. Does fewer, more, or relevance-trimmed context help?

## Arms (query time only, on the stores built in E27; test build)

- **D** — default: top 20 records, 2048-token budget.
- **K10** — top 10 records, 2048 tokens.
- **K40** — top 40 records, 8192 tokens.
- **REL** — top 40 candidates, keep records whose fused relevance (before
  recency/trust weighting) is ≥ 0.5 × the best one, at least 5, 8192 tokens.

## Data and model

- PersonaMem 32k, all 589 (multiple choice, exact-letter scoring) — primary.
- LongMemEval `s`, the 120 E27 questions (judge `gemini-2.5-flash-lite`) — secondary.
- E25 attack suite (136 cases, the E25 runner's Aura arm) — safety check.
- Answer model `gemini-3.1-flash-lite` for all (D included), 1 run.

## Gates (arm vs D)

| Gate | Pass |
|---|---|
| B1 | PersonaMem accuracy ≥ D + 3 pp |
| B2 | LongMemEval accuracy ≥ D − 3 pp |
| B3 | E25 attack success ≤ D + 5 pp |

The arm with the highest PersonaMem accuracy among those passing B1–B3 is
proposed for the core. Reported: per category, context tokens, cost.
