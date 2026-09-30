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

## Amendment D1 (2026-09-30, after 2 paid answers, before any result was used)

The harness's LongMemEval prompt uses `json.dumps(raw_response)` instead of
the formatted context whenever a provider returns a raw response. The first
adapter returned `{"sources": [...]}`, so the model saw only session ids and
answered "the context lacks the information" although the answer was the
first line of Aura's context. The run was stopped after the first answers
(kept in `aborted/`, not scored); the adapter now returns no raw response,
and the run restarts from scratch.

## Amendment D2 (2026-09-30, after the quota stop, before any new answer)

The daily quota of `gemini-3.1-pro` (250 requests per project) stopped
PersonaMem after 128 of 589 questions (kept as a partial result). At the
user's request PersonaMem continues with another answer model,
`gemini-3.1-flash-lite`. The shipped results were produced with
`gemini-3.1-pro-preview`, so they are no longer a like-for-like baseline:
the harness's own `hybrid-search` baseline (local) is re-run with the same
new model on all 589 questions, next to Aura. Judge unchanged
(`gemini-2.5-flash-lite`). Gate A1 for PersonaMem is evaluated against this
re-run hybrid-search.
