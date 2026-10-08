# E60: when should the analytical processor switch on?

Status: **frozen 2026-10-08**, before any model call. **Test only.**

## Question

E59 showed two things:
- for plain lookups, ten retrieved records are enough;
- for facts that changed, the processor (E52b chain with a newest-fact check, "CN") is needed. On FactConsolidation, E52b CN beats plain retrieval (R0) on single-hop (96.2% vs 82.5%) and on multi-hop (40.0% vs 10.2%).

The processor costs several model calls, so it should run only when needed.
E58 showed that, on the owner's real messages, similarity cannot tell when
memory is needed.

E60 asks whether a cheap signal can tell when to run the processor. Two
conditions must hold:
1. it switches on where the processor helps (FactConsolidation);
2. it stays off on plain lookups (LongMemEval) and on the owner's everyday
   messages.

## Routers

| Router | Decides from | Cost |
|---|---|---|
| never | — | the cheap path: retrieval plus one reader call |
| always | — | the processor on every question |
| oracle | knows the answers | upper bound only: the processor exactly when R0 is wrong and CN right |
| **L** | the question alone, local `qwen3:4b-instruct` (Ollama): "would answering need combining two or more separate facts in a chain, or deciding which of several versions of a fact is newest?" yes/no | one local call |
| **LM** | the question plus the 10 retrieved records, same local model: "do these memories hold several versions of the same fact, or does the answer need a chain of facts?" yes/no | one local call |
| **S** | the cheap reader itself: it answers and adds `"escalate": true/false`, set to true when the answer needs a chain of facts, the memories hold different versions of a fact, or the memories are not enough | the cheap call; on escalation, the processor too |

No word lists are used anywhere. All decisions come from the models.

## Data

| Set | What is measured | Notes |
|---|---|---|
| **FactConsolidation**, all 800 questions (4 sizes × single/multi-hop × 100) | accuracy and calls under each router | R0 and CN correctness per question reused from E46 and E52b. A routed question takes CN's result when the router fires; otherwise it takes R0's result (L, LM) or S's own answer (S). |
| **LongMemEval-S**, E59's 60 questions | fire rate of L, LM and S; accuracy of S's own answers | retrieved records are E35's U top-10; the reader prompt is E35's plus the escalate instruction; E35's judge |
| **The owner's real messages**, E58's 163 | fire rate of L and LM, overall and among the 17 that E58's judge marked "needs earlier conversations" | LM's memories are rebuilt as in E58 (each earlier message stored in turn, bge-m3), up to 10 hits from other sessions. Local only, nothing leaves the machine; rows stay in `private/`. S is not run here, because it needs the cloud reader. |

## Metrics

- **Accuracy on FactConsolidation** under each router, per hop.
- **Fire rate per set.** The processor should fire high on FactConsolidation, low on LongMemEval, and low on the owner's messages.
- **Model calls per question on FactConsolidation:**
  - cheap path: 1;
  - CN: steps × 2, an upper bound, since each step may add one newest-fact call;
  - S: 1, plus CN calls when it escalates.
- **Local router time:** median ms.

## Hypotheses

| | Hypothesis |
|---|---|
| W1 | some router keeps ≥ 90% of the processor's gain on FactConsolidation: acc(router) − acc(never) ≥ 0.9 × (acc(always) − acc(never)) |
| W2 | the same router fires on ≤ 20% of LongMemEval questions and ≤ 20% of the owner's messages (for S, which cannot run on the owner's data, LongMemEval only) |
| W3 | the local router takes ≤ 1 s median per message |

The hypotheses are reported, not used as ship decisions.

## Budget

Own cache, hard stop at **$2**. Estimate:
- S on FactConsolidation: about $0.2;
- S on LongMemEval with the judge: about $0.05;
- L and LM run locally.
