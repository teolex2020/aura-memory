# E27: Aura on the Agent Memory Benchmark — preregistered protocol

Date frozen: 2026-09-30, before any benchmark answer was generated.
Number taken from `experiments/INDEX.md`.

## Question

On a third-party benchmark harness (vectorize-io/agent-memory-benchmark,
commit `03c1d0f`, no license file — local use only; results are not
published without a separate decision), how does Aura's default recall
compare with the systems whose results the harness ships, on the same
questions, the same answer model and the same judge?

## Setup

- Harness unchanged; Aura registered at run time (`run_amb.py`,
  `aura_provider.py`). Mode `rag` (the harness builds the prompt).
- Aura: each turn stored verbatim by role (user → `channel="user"`,
  assistant → `channel="agent"`), session time as `metadata.timestamp`,
  one store per question/persona, `bge-m3` embeddings via Ollama.
  `retrieve()` returns `recall(query)` (default provenance context: identity
  block, first-hand dates, untrusted fenced) as one document. The Aura build
  is the committed default at run time (recorded in the results).
- Answer model `gemini-3.1-pro-preview`, judge `gemini-2.5-flash-lite` —
  the models of the shipped results.
- Budget agreed with the user: about $20–25.

## Data

- LongMemEval `s`: 20 questions per category (`--category <all 6>
  --query-limit 20`), 120 questions.
- PersonaMem `32k`: all 589 questions.

## Comparison

Shipped per-query results of hindsight, cognee and hybrid-search, filtered
to exactly the question ids Aura answered.

## Gate

| Gate | Pass |
|---|---|
| A1 | Aura accuracy ≥ hybrid-search (the harness's retrieval baseline) − 5 pp on each dataset |

Reported: accuracy vs hindsight and cognee, per category, context tokens,
retrieval time, cost. Aura's context is much shorter than the others'
(~1–2k vs 12–43k tokens); this is reported, not adjusted.
