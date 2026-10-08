# E61: does the analytical processor hurt plain lookups?

Status: **frozen 2026-10-08**, before any model call. **Test only.**

## Question

E60 found no cheap signal that tells when to run the processor. That leaves
two options:
- run it whenever memory is used;
- find another way.

The first option is sound only if the processor does not hurt ordinary
questions. On FactConsolidation, where every question is about changed facts,
the E52b chain never hurt. E61 runs the same chain on LongMemEval, where most
questions are plain lookups.

## Data

LongMemEval-S, all 120 questions of E35's sample (20 per type). The records
are the user's own words (E35's U arm), each with its session time.

## Arms

| Arm | What answers |
|---|---|
| C | E35's U reader on 10 retrieved records, reused (81.7% on E59's 60) |
| P1 | the chain alone: its final answer is the answer |
| P2 | the reader with C's 10 records **plus the chain's notes** (each link's memory, its time and the finding, and the chain's final). This is how a product would use the processor: add the analysis, keep the memories. |

## The chain

The chain is E52b's CN, adapted to dated memories:
- Records are numbered by time (a larger number means later). The rule is
  that a later memory overrides an earlier one about the same thing.
- **Step 1** sees C's 10 records. Each later step sees the top 10 records by
  cosine similarity (bge-m3, as in E19) for the step's `next` lookup.
- **Each step** cites one record and its finding, then gives either `next` or
  `final`. There are at most 5 steps. If nothing bears on the question, the
  step says so and stops.
- **Newest check** (E52b): the 8 records most similar to the cited one that
  are later than it are shown. The step is re-asked, and it uses the newest
  record that states the same thing with a different value.

Model: `gemini-3.1-flash-lite`, temperature 0. The judge is E35's (official
LongMemEval). Record texts are capped at 2,000 characters in chain prompts.

## Metrics

- Accuracy per arm, overall and per type.
- **Model calls per question:** steps, plus newest-check calls.
- **Wall time added by the chain** (median), against the single reader call.

## Hypotheses

| | Hypothesis |
|---|---|
| K1 | the processor does not hurt: acc(P2) ≥ acc(C) − 2 pp |
| K2 | it helps where versions matter: on knowledge-update + temporal-reasoning, acc(P2) ≥ acc(C) |
| K3 | median added wall time ≤ 3 s |

P1 is reported for comparison. The hypotheses are reported, not used as ship
decisions.

## Budget

Own cache, hard stop at **$2**. Estimate: about $0.6.
