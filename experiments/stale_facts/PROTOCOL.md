# E46: can memory keep the newer fact when an old one conflicts? (MemoryAgentBench)

Status: **frozen 2026-10-02**, before any embedding, answer or score.

## Question

Every memory system is weakest at replacing an outdated fact with a new one
(MemoryAgentBench, ICLR 2026): agents built on GPT-4o reach about 60% on
single-hop conflicts and at most 7% on multi-hop ones. Aura has no mechanism
for this today.

We test a simple rule that needs no model and no language rules
(**supersession**): when two retrieved records are near-duplicates in
meaning, they are taken to fill the same slot, and only the newer one is
kept.

## Data

`ai-hyz/MemoryAgentBench`, split `Conflict_Resolution` (FactConsolidation),
MIT. Single-hop (`sh`) and multi-hop (`mh`), at 6k, 32k, 64k and 262k, with
100 questions each: 800 questions. Each context is a numbered list of facts.
A larger number is newer and overrides an older fact. Each numbered line is
one record, kept with its number.

## Retrieval arms (same reader, same records)

Embeddings: bge-m3, local Ollama, normalized, cosine.

- **R0, plain retrieval:** the top 10 records by similarity to the question.
- **S, supersession:**
  1. Take the top 30 by similarity.
  2. Walk them in similarity order. A record whose cosine with an
     already-kept record is ≥ **0.92** fills the same slot, and only the one
     with the larger serial number stays.
  3. Keep the first 10 slots.

Records are shown with their serial numbers, in similarity order, in both
arms.

## Reader and score

- **Reader:** `gemini-3.1-flash-lite`, temperature 0, at most 64 tokens.
- **Prompt:** MemoryAgentBench's official `rag_agent` query template for
  `factconsolidation` (`utils/templates.py`), with the retrieved records as
  the knowledge pool.
- **Score:** the official substring exact match (`substring_exact_match_score`,
  `utils/eval_other_utils.py`) against any gold answer.

## Gates

| Gate | Pass |
|---|---|
| C1 | supersession helps single-hop: mean over sizes of S − R0 ≥ +10 pp |
| C2 | it does not hurt multi-hop: mean of S − R0 ≥ −2 pp |

## Also reported

- Accuracy per size and hop.
- Sensitivity of S to the threshold (0.88 and 0.95; not gated).
- How often the gold answer's fact is retrieved.
- The published numbers from MemoryAgentBench, for orientation. They are
  not directly comparable: different reader and chunking.

## Decision rule

- **C1 and C2 pass:** supersession by meaning plus recency is worth building
  into Aura's recall.
- **Otherwise:** not in this form.

## Limits stated in advance

- **Synthetic, templated facts.** Near-duplicates are easier to spot than in
  real speech.
- **Recency is given** by serial numbers. In the product it would come from
  timestamps.
- **One reader model.** This tests the retrieval rule, not Aura end to end.

## Freeze record

- `run.py` sha256 `ee954c5849d48779714169076b2781af3b9805c7ffd500ef21782e41feb7b562`; `Conflict_Resolution` parquet sha256 `24d5c3f09ce0ce15625cb9f8a98f44f0d864ca6c94d7b4ad04eb697ca3a5ff45`; official template and metric from the MemoryAgentBench repo (depth-1 clone 2026-10-02).
- 8 contexts, 51,354 facts, 800 questions. Harness check: parsing and the metric on a made-up string only.
