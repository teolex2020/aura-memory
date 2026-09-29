# E19: LongMemEval retrieval, Aura capture vs mem0 — preregistered protocol

Status: **frozen 2026-09-29** (amendment D1 at the end), before the run.

## Why

E16–E18 measured attacks on memory filled from conversations. They do not say
whether that memory finds what the user needs among hundreds of ordinary
turns. LongMemEval (ICLR 2025) is the public benchmark for exactly that, and
the one competitors report on. This is the first part: retrieval only, local
and free (no answer model, no judge).

## Data

LongMemEval-S, HF `xiaowu0162/longmemeval`, file `longmemeval_s`, revision
`2ec2a557f339b6c0369619b1ed5793734cc87533`, sha256
`08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894` (same file
as aegis-memory's run). 500 questions, each with ~50 chat sessions (~490
turns). The 30 abstention questions (`_abs`) have no evidence and are
excluded.

**Primary sample:** 20 questions per question type (6 types, 120 questions),
drawn with `random.Random(19)` from the non-abstention questions of each type
in file order. **Follow-up:** all 470 non-abstention questions with the same
code, reported separately.

## Arms

Each question gets fresh stores holding every turn of its haystack, one record
per turn, text verbatim, in session order. Query = the question text. All arms
use the same `bge-m3` embeddings (local Ollama).

| Arm | Writes | Ranked list |
|---|---|---|
| M | mem0 2.2.1, `add([{role, content}], infer=False)` per turn | `search(question, top_k=10)` |
| A-cap | Aura as the capture adapter writes (E18): user turns `channel="user-claude-code"` (first-hand), assistant turns `channel="agent-claude-code"` (model-written), Domain level, no dedup | `recall_structured(question, top_k=10)` |
| A-flat | the same, without a channel (every turn first-hand) | same |

A-flat isolates what provenance costs retrieval: the assistant's turns are
model-written in A-cap, and some questions (single-session-assistant) are
answered only by what the assistant said.

## Metrics

Relevance comes from the dataset: evidence turns carry `has_answer`; evidence
sessions are `answer_session_ids`. A retrieved record counts as an evidence
turn if its text equals an evidence turn's text.

- **Turn Recall-any@k** (k = 5, 10): at least one evidence turn in the top k.
- **Turn Recall-all@10**: every evidence turn in the top 10.
- **Session Recall-any@k** (k = 5, 10): a turn from an evidence session in the top k.
- **NDCG@10** (turn level, binary relevance).
- Per question type; query latency; ingest time per question.

## Gates (primary sample)

| Gate | Pass |
|---|---|
| G1 | Turn Recall-any@10: A-cap ≥ M − 5 pp |
| G2 | single-session-assistant, Turn Recall-any@10: A-cap ≥ A-flat − 5 pp |
| G3 | Turn Recall-any@10 overall: A-cap ≥ A-flat − 3 pp |

## Decision rule

- **G1 fails:** Aura finds evidence worse than a plain vector store; retrieval
  quality must be fixed before building the product on it.
- **G2 or G3 fails:** marking the assistant's turns as model-written costs
  retrieval; ranking by source needs a look before capture ships widely.
- **All pass:** retrieval is not a blocker; the next step is part two
  (answers and judge) against published numbers.

Failures are reported, not retried away.

## Amendment D1 (2026-09-29, before the run)

- `run.py` sha256 `e74e75994adbc52c3a1a902c3d8b77144a44681eed36543e149ec852800d9566`; Aura: `caedd05` core with the E18 Python package (`888f766`); mem0 2.2.1.
- Sample: 120 questions, 54,974 unique texts to embed (turns + questions).
- Disclosure: a one-question smoke test (`d7c942c3`, knowledge-update) ran before freezing to
  check the harness; all three arms found both evidence turns (NDCG@10 0.82 / 0.82 / 0.81).
  It stays in the sample.

## Amendment D2 (2026-09-29, after 44 questions, execution only)

The run stopped at question 45: Ollama rejected one embedding request (HTTP 400), and
the embedding prefill had silently lost the batches around it (7,314 of 54,974 texts
missing). Fix: a rejected batch is embedded text by text; a text rejected alone is
retried on its first 8,000, then 2,000 characters; every such text is logged in
`cache/fallbacks.jsonl` and reported. Embeddings are shared by all three arms, so the
fix does not favour any arm. The 44 finished questions are kept (their texts embedded
without error); the run resumes at question 45. `run.py` sha256 `fe6d79b9ab3e70411ebecb33dc3e1b6548fd1cc796a960aea83c0c0b76e799d2`.
