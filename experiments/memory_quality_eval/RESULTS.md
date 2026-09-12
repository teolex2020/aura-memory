# Memory-quality baseline result

Date: 2026-09-09\
Dataset: `aura-memory-quality-v1`\
Corpus: 24 fixture records, 256 same-run distractors, 368 neighboring-tenant
distractors; 648 records total\
Queries: 23 (21 answerable, 2 expected abstentions)\
Build: local Windows release build, optional cognitive rerankers disabled

This is a synthetic development baseline, not an independent competitor result.
The complete per-query evidence and configuration are in `results.json`.

## Retrieval quality

| Arm | Recall@5 | MRR | nDCG@5 | Evidence precision@5 | Abstention accuracy |
|---|---:|---:|---:|---:|---:|
| Recent history | 47.6% | 42.9% | 44.1% | 38.1% | 0% |
| Token overlap | 95.2% | 92.9% | 93.5% | 60.9% | 0% |
| Aura baseline | 95.2% | 92.9% | 93.5% | 51.4% | 0% |

Aura passed the initial correctness gates: no forbidden temporal/tenant evidence,
no namespace contamination, no Recall@5 loss after adding neighboring-tenant
records, and identical rankings after close/reopen. Aura matched the lexical
baseline on Recall@5 and ranking metrics in this run. The corpus is too small
and synthetic to infer general equivalence.

The suite is primarily English; Ukrainian and mixed-language queries are small
diagnostic slices, not a product-audience assumption. All exact English,
Ukrainian, mixed-language, code identifier, negation, multi-evidence, temporal
and tenant-isolation queries retrieved their expected evidence. The weak slice
was Ukrainian paraphrase: Recall@5 was 50%. With only two queries, that result
identifies one retrieval failure but is not enough to set a language-specific
product priority or estimate multilingual quality.

Both no-answer questions returned unrelated nearest records, so abstention
accuracy was 0%. The v1 gate reports this but does not fail on it because Aura
does not expose a calibrated no-answer confidence contract yet. A confidence or
evidence-coverage policy should be designed on a development split and tested
on held-out questions.

## Local timing

| Measurement | Mean | Median | P95 |
|---|---:|---:|---:|
| Aura ingestion, 648 records | 0.693 ms | 0.691 ms | 0.945 ms |
| Aura read-only uncached recall | 11.869 ms | 12.194 ms | 15.507 ms |
| Aura cached structured recall | 0.025 ms | 0.035 ms | 0.041 ms |

The token-overlap arm is intentionally simple and re-tokenizes the corpus, so
its timings are harness overhead rather than a production BM25 comparison.
These local timings are observations from one machine and are not an SLA.

## Engineering findings closed during the run

The first run exposed two restart defects beyond the original audit:

1. recall activation and coactivation were updated only in RAM; `flush()` and
   `close()` now persist changed records in one durable batch;
2. the rebuilt MinHash index generated new random hash functions on each open;
   it now uses a fixed non-secret seed, and equal scores use deterministic
   tie-breakers.

Regression tests verify both behaviors. After the fixes, all 23 rankings, top-5
sets and expected-evidence outcomes were identical after reopen.

## Next experiment

Add adapters for pinned LoCoMo and LongMemEval-V2 revisions and an English-first
held-out real-project corpus. Expand language-specific slices only when product
usage data or target-market requirements justify their weighting. Compare
lexical Aura with semantic retrieval across the same records; require a held-out
gain on paraphrases without regression on temporal correctness, isolation,
latency budget or evidence precision. Abstention calibration must use a separate
development split.
