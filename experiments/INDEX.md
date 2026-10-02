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

| E30 | `control_facts` | Control facts: can a checker catch answers and actions that ignore what the user said? | ◐ C2 flash-lite ✅ all gates (97.2% caught, 2.8% false alarms, cross-language 100%); C1 qwen 4B local ❌ (71.1% / 14.3%); C0 no model ❌ | — (opt-in API checker candidate) |
| E30b | `control_facts` (b) | Control facts on larger local models (Qwen3.5-4B, Gemma 4 E4B, Qwen3-4B Q8, Phi-4-mini, Hunyuan-7B) | ❌ none pass; best Qwen3.5-4B 88.3% caught but 21.7% false alarms, 12 GB RAM | — (opt-in API checker) |
| E31 | `embedding_need` | Does Aura need semantic embeddings (EMB vs LEX, the desktop default)? | radical: LongMemEval evidence@10 95.8% vs 80.8% (preferences −30 pp, assistant turns −45 pp); E22b at ceiling | — (lightest option next) |
| E32 | `memory_spaces` | Memory spaces from provenance: global vs hard walls vs soft preference | ❌ soft +4.2 pp in-space but cross-space 93→45%; global best (84.6% LEX, 96.2% EMB); identity paraphrase 68% LEX vs 95% EMB | — (spaces only as UI grouping) |
| E34 | `embedding_choice` | Which small embedding model for opt-in smart search (5 candidates, 15 languages, cross-lingual) | ✅ EmbeddingGemma 300M by rule (334 MB, cross-lingual 95.8 best, 2.5× faster than bge-m3 on CPU); bge-m3 (MIT) also qualifies; Qwen3/Harrier not better and 3.4 GB RAM | — (owner decides Gemma terms vs bge-m3) |
| E33 | `research_cache` | Research once into memory vs search every time (quality, cost, citations) | ❌ cache 48.3% vs live search 76.7% (coverage, not retrieval); 34× cheaper per question but break-even ~12 questions/topic; citations 91.4% ✅ | — (grow-on-use cache is the follow-up idea) |
| E35 | `capture_value` | What to keep from a conversation: nothing / user words / full / Remy-style session summaries / user words + summaries (LongMemEval-S 120) | ◐ H1 ❌ user words 79.2% vs full 85.0% (all loss in assistant-said questions, 11 of 14; without them 87.0 vs 83.0) at 12% of the text ✅; summaries 25.0% ❌, add nothing ❌; 50% of summaries invent assistant actions | — (owner decides; recommendation: user words verbatim, assistant replies stay in the journal) |
| E36 | `real_conversations` | What in the owner's real Claude Code conversations is worth remembering (319 messages, 9 sessions, 6 days; private data gitignored) | ✅ K1 by count: 12 restatements out of context (R 8.3% of durable); durable 45.5% (facts 64, preferences 34, decisions 30, corrections 14); 5 of 12 repeats cross projects | build user-words capture, short-term with decay, global across apps |
| E37 | `outcome_memory` | Can memory learn from consequences what to keep? LoCoMo stream, capacity 25%: recency / access count / decay / decay + counterfactual outcome credit | ◐ G1 ❌ outcome credit +1.5 pp over decay (CI −1.0…+4.0); access count worst (34.5 vs recency 44.0); no-forgetting 65.0 | — (remove access-based promotion; per-record credit does not generalize → E38 value net) |

Next free number: **E38**.
