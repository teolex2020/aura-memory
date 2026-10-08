# E59: memory or a long context window? And does an analytical brief beat raw memories?

Status: **frozen 2026-10-08**, before any model call. **Test only.**

## Question

Some researchers say memory is needed; others say a long context window is
enough. The owner thinks memory matters when analysing, rarely in simple
talk, and that what is needed is more like a small analytical processor
giving short answers.

We have never compared memory with the simplest alternative: put the whole
history in the context. E59 does, and adds the processor idea: instead of
raw memories, hand the model a short analysed brief.

## Arms

| Arm | The model receives |
|---|---|
| A | nothing |
| B | **the whole history in context** (long context) |
| C | 10 retrieved records (Aura, as now) |
| D | **an analytical brief:** a short summary of what is relevant, with dates and sources, noting conflicts and which fact is newer, written from the retrieved records by a processor call |

## Data and arms per set

**LongMemEval-S:** 60 of E35's 120 questions, the first 10 per type in
E35's order. The reader, its prompt and the judge are E35's
(`gemini-3.1-flash-lite`, official judge).
- **A:** E35's N, reused.
- **C:** E35's U (10 user-word records), reused. E35's F (10 records from
  user and assistant turns) is reported too.
- **B:** every haystack session in order with its date, both roles, as
  `[Session time: …]` / `User: …` / `Assistant: …` blocks (about 115k
  tokens), under "Conversation history". Reader prompt otherwise as E35.
- **D:** processor call (`gemini-3.1-flash-lite`, temperature 0, at most
  300 tokens). From E35's U top-10 records with their session dates and the
  question, write at most 5 short lines:
  - what in these memories bears on the question, with dates;
  - when memories conflict, which is newer;
  - if nothing bears on it, say so.

  The brief is not allowed to answer beyond the memories. The reader then
  answers from the brief only, in place of the memories.

**MemoryAgentBench FactConsolidation:**
- sizes 6k, 32k and 64k;
- single- and multi-hop;
- the first 25 questions of each, 150 questions in all;
- official template and metric (E46).

Arms:
- **C:** E46's R0, top 10, reused.
- **D:** E52b's CN, the chain with a newest-fact check, which is the
  processor for conflicts; reused.
- **B:** the whole numbered fact list as the knowledge pool, otherwise E46's
  template.
- **A:** not run. Without facts the answers are unknowable by
  construction.

## Metrics

- **Accuracy:** judge yes on LongMemEval; substring exact match on
  FactConsolidation.
- **Input tokens to the answering model per question** (from usage): for D,
  the processor call is reported separately.
- **Wall time** of the answering call; for D, plus the processor call.
- **Cost per question.**

## Hypotheses

| | Hypothesis |
|---|---|
| H1 | the context window is enough on LongMemEval: abs(acc(B) − acc(C)) ≤ 3 pp |
| H2 | long context fails on conflicting facts: on multi-hop FactConsolidation, acc(B) ≤ acc(D) − 10 pp |
| H3 | a brief is as good as raw memories at a fraction of the reading: acc(D) ≥ acc(C) − 2 pp on LongMemEval, with the brief ≤ 30% of C's memory tokens |

The hypotheses are reported, not used as ship decisions.

## Budget

Own cache, hard stop at **$5**. Estimate: B on LongMemEval about $1.7, B on
FactConsolidation about $1.3, D small.
