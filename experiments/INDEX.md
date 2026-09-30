# Experiment registry

One number per experiment. Take the next free number here **before**
freezing a protocol, and add a row when the result is recorded. Details are
in each directory's `PROTOCOL.md` and `RESULTS.uk.md`.

Outcome: ✅ gates passed · ❌ gates failed · ◐ partly · — measurement only.

| № | Directory | Question | Outcome | In the core |
|---|---|---|---|---|
| E1 | `purge_verification` | Can poisoned records be purged from every surface? | ✅ (found a consolidation data-loss bug) | `purge_record`, strict `delete()` |
| E1b | `purge_verification_mem0` | Same in mem0 | — deleted text stays in history.db, Qdrant, `history()` | comparison |
| E2 | `trust_laundering` | Can untrusted evidence become trusted advice? | ✅ after fix | evidence floor for policy hints |
| E3/E4 | `claim_certainty` | Hearsay and speculation in user claims | ◐ rules weak; LLM hook ✅ | classifier hook; rules opt-in |
| E5/E6 | `outcome_polarity` | Outcome polarity without keyword lists; embedding clustering | ◐ | structured polarity; clustering opt-in |
| E7/E9 | `locomo_retrieval` | LoCoMo retrieval, embedding write path, fusion modes | ◐ | embedding log; `family` fusion |
| E8 | `recall_determinism` | Same input → same recall? | ✅ 0/200 → 200/200 | deterministic tie-breaking |
| E10 | `context_provenance` | Provenance markers in recall context | ✅ injection 52% → 25% | provenance context |
| E11 | `sybil_resistance` | Repetition flooding from one untrusted source | ◐ 2 of 4 attack kinds | per-source cap in recall |
| E12 | `action_gate` | Tool-call argument provenance gate | ✅ | no (prototype) |
| E12b | `action_gate_inflection` | Gate under inflection and reformatting | ✅ R1 | no (prototype) |
| E13 | `e2e_vs_mem0` | End-to-end attacks: Aura strict vs mem0 | ✅ correct under attack 94% vs 44% | security profiles |
| E14 | `default_provenance` | Provenance context by default; channel → source | ◐ H1 failed by one case | channel → source |
| E14b | `causal_provenance` | Provenance context with causal reasons | ✅ "why" 6/16 → 16/16 | causal provenance context |
| E15 | `identity_budget` | Identity facts under tight budgets; cache | ✅ | provenance default + cache |
| E16 | `auto_capture` | Learning from conversations without learning attacks | ◐ K1 ❌ | capture by role |
| E17 | `extraction_verify` | Verifying where extracted facts come from | ◐ V4, V5 ❌ | — |
| E18 | `hook_capture` | Capturing Claude Code conversations through hooks | ✅ | `python/aura/capture.py` |
| E19 | `longmemeval_retrieval` | LongMemEval retrieval: Aura capture vs mem0 | ✅ top-10 95.8% vs 94.2% | — |
| E20 | `longmemeval_answers` | LongMemEval answers: Aura capture vs mem0 | ✅ 81.7% = 81.7% | — |
| E21 | `memory_framing` | How memory is framed for the model | ❌ frame adds nothing; "answer only from memory" costs ~4 pp | — |
| E22 | `reasoned_recall` | Facts that need a reasoning step: identity block vs reasoning hook | ❌ neither passed all gates | — |
| E22b | `identity_block` | Always-on identity block, powered re-test | ✅ answers needing a fact 40% → 73% | identity block; no novelty promotion into IDENTITY |
| E23 | `context_dates` | Event dates in the provenance context | ❌ time questions 25% → 67.5%, but a newer untrusted date raised attack success 11.5% → 18.3% | superseded by E24; capture stores event time |
| E24 | `first_hand_dates` | Dates on first-hand memory only; header note against newer-looking "updates" | ✅ D3: time questions 25% → 67.5%, attack success 31.0% → 28.2% | default `first_hand` dates + untrusted header note |
| E25 | `final_vs_mem0` | Aura defaults vs mem0 end to end (qwen 4B gated; gemma, gemini-3.1-flash-lite reported) | ◐ F1–F4 ✅ attack success 21.7% vs 73.8% (flash-lite 0% vs 90%); F5 ❌ helpfulness 74% vs labelled mem0 83%. Re-run on `532565d`: 22.9% vs 72.5%, same gates | — |
| E26 | `context_order` | Order inside the provenance context (untrusted first, relevance order, date only) | ❌ helps gemma (57.5% → 28.3%), hurts qwen and flash-lite | — (default unchanged) |
| E27 | `amb_aura` | Aura on the Agent Memory Benchmark (LongMemEval 120, PersonaMem 128 of 589 — daily quota) | ✅ A1: LongMemEval 76.7% vs hybrid-search 65.8% (hindsight 91.7%); PersonaMem 82.0% vs 85.2–85.9%; context 10–20× shorter; preferences weak (6/20) | adapter only |
| E28 | `context_breadth` | How many records the provenance context carries (10 / 20 / 40 / relevance-trimmed) | ❌ B1 (PersonaMem flat 71.5–73.9%); reported: relevance trim +9.2 pp on LongMemEval (75.0 → 84.2%, preferences 7 → 13/20) | — |
| E29 | `relevance_trim` | Confirm relevance-trimmed context on unseen LongMemEval questions | ✅ unseen LongMemEval 81.8% → 88.2%, PersonaMem −0.1, attacks on qwen +2.6 (within gates) | relevance-trimmed default recall (pool 40, cut 0.5, min 5, 8192 tokens) |

E16 was used twice on 2026-09-29 by two sessions; the later pair
(`reasoned_recall`, `identity_block`) was renumbered to E22/E22b. Commit
messages keep the old numbers.

Next free number: **E30**.
