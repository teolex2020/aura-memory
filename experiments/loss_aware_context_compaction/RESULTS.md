# Structural experiment result

Date: 2026-09-02\
Build: Rust release mode, offline\
Corpus: 8 controlled Aura records, 39 declared critical spans\
Iterations: 20,000 whole-capsule compactions

| Metric | Baseline | Compacted | Result |
|---|---:|---:|---:|
| Estimated tokens | 1,101 | 714 | -35.15% |
| Entries fitting a 640-token budget | 4 | 7 | +75% |
| Critical spans retained | 39 | 39 | 100% |
| Structured fields unchanged | — | — | yes |
| Exact original expansion | — | — | yes |
| Median compaction latency | — | — | 0.080 ms |
| p95 compaction latency | — | — | 0.087 ms |
| QA answers present in context | 9/16 | 14/16 | +5 |
| Extractive QA correct | 4/16 | 8/16 | +25 percentage points |
| Extractive QA, same four records | 4/16 | 4/16 | no regression |

All structural and deterministic QA acceptance gates passed after correcting
the sentence splitter so that decimal numbers and semantic versions are not
split at their periods. The QA comparison used the same 640-token budget and
the same 16 questions for both arms. The compact arm fit seven records while the
baseline fit four. No question answered correctly by the baseline regressed in
the compact arm.

## Initial decision

At this stage, do not integrate. The result demonstrates the intended mechanism: more
records in the same prompt can make more questions answerable without damaging
the answers supported by the original four records. It still justifies a second
A/B experiment over a larger, less repetitive corpus and real model answers.
This controlled corpus and deterministic extractor do not prove general
semantic equivalence or predict the behavior of a real LLM.

The experiment remained isolated from Aura's public API, recall implementation,
Python wheel, feature flags, and release build at this stage.

## Local-model A/B

The same prompts and 16 questions were subsequently evaluated offline through
the locally installed llama.cpp server. Temperature was zero, the seed was 42,
and each model was instructed to answer only from the supplied context.

| Model | Baseline | Compacted | Gain | Regressions | Hallucinations |
|---|---:|---:|---:|---:|---:|
| Phi-4 Mini Instruct Q4_K_M | 8/16 | 13/16 | +31.25 pp | 1 | 4 → 1 |
| Qwen 3.5 4B Q4_K_M | 8/16 | 14/16 | +37.50 pp | 0 | 0 → 0 |
| Combined | 16/32 | 27/32 | +34.38 pp | 1 | 4 → 1 |

Both models benefited from the three additional records that fit inside the
same context budget. Qwen answered every question supported by the compacted
context and returned `UNKNOWN` for both unavailable answers.

Phi-4 introduced one paired regression: the compacted context still contained
`release 1.59.0`, but the model returned the adjacent goal identifier `GOAL-31`.
The full baseline repeated the release fact several times, while compaction kept
it once. This shows that byte-level fact retention alone does not guarantee
behavioral equivalence for every model.

### Decision after aggressive model A/B

The benefit is real and substantial on this controlled experiment, but the
current algorithm does not meet the zero-regression safety requirement. Keep it
isolated. Before integration, test a larger non-repetitive corpus and introduce
a policy that preserves emphasis for high-priority goals without relying on
blind textual repetition.

## Safety revision and integrated policy

The production candidate was changed so that `ActiveGoal` entries and non-text
payloads are excluded from compaction. This deliberately trades some capacity
for model-level safety.

| Final-policy metric | Baseline | Compacted | Result |
|---|---:|---:|---:|
| Estimated tokens | 1,101 | 763 | -30.70% |
| Whole entries fitting 640 tokens | 4 | 6 | +50% |
| Critical spans retained | 39 | 39 | 100% |
| Phi-4 Mini correct | 8/16 | 12/16 | +25.00 pp |
| Phi-4 paired regressions | — | — | 0 |
| Phi-4 hallucinations | 4 | 1 | -3 |

The previously failing `release 1.59.0` question became correct after preserving
the active-goal text unchanged. Qwen had already passed the more aggressive
seven-entry policy with zero regressions; it was not rerun for the more
conservative six-entry policy.

### Final decision

Integrate the conservative algorithm as an explicit opt-in API. The original
context-capsule path remains unchanged. Integration includes auditable metrics,
verbatim protection from compaction for active goals and structured payloads,
exact expansion through the stored `record_id`, Rust and Python APIs, and
regression tests.
