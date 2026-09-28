# E15: identity facts under a tight token budget — preregistered protocol

Date frozen: 2026-09-28, before the dataset existed and before the runner.

## Question

The level format reserves 25% of the token budget (at least 128 tokens) for
IDENTITY records. The causal provenance format (E14b) admits records in
relevance order only. In a large store with many related records and a
tight budget, does the provenance format drop lasting facts about the user
that the level format keeps?

## Data

`data/cases.jsonl`, separate author, no repository access, harmless and
invented, uk/en: 24 cases, each with one identity fact the question needs
and 15 related working/domain records on the same topic (competitors for
the budget). Every store holds its own case plus all other cases' records
as unrelated filler (~380 records). Hashed before reading.

## Arms and budgets

`recall(question, token_budget=B)` with B ∈ {256, 512, 1024}:
- **L** — level format (`format="levels"`);
- **C** — causal provenance format (`format="provenance"`).

## Measures

- Primary (deterministic, no model): identity fact text present in the context.
- Reported: `qwen3:4b-instruct` answer correct (expected token in answer).

## Gate

| Gate | Pass |
|---|---|
| I1 | at every budget, C identity presence ≥ L identity presence − 5 pp |

If I1 fails, the pre-specified fix is applied without tuning: first-hand
IDENTITY entries are admitted first, up to the level format's identity
budget (25% of the budget, at least 128 tokens), then the rest in relevance
order. The same data is then re-scored once and reported as the fix run.

## Cache (engineering check, not gated)

Median latency of 50 repeated identical `recall()` calls for L (cached) and
C before and after adding the cache; cache correctness is covered by tests.

## Amendment D1 (2026-09-28, before any run)

`data/cases.jsonl` sha256 `f0dc0ee0588567a341930241692e283b86cedbe39229412cee16b465edeb3d8c` (24 cases). Automatic check: 0 issues [].
Cache latency (400 records, 50 repeated calls, median): before the cache L 0.003 ms, C 3.808 ms; after C 0.004 ms.
