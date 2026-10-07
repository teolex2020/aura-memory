# E57: when is it worth consulting memory? Cost, benefit and harm of recall policies

Status: **frozen 2026-10-07**, before any measurement. **Test only**.

## Question

The owner's analogy: a person has short-term memory, which is cheap and
always at hand, and long-term memory, which costs energy to search. The
person reaches into long-term memory when a signal says it is worth it.

Should Aura consult long-term memory on every message, never, on a cheap
signal, or once per session? What does each policy cost in latency and
tokens, especially in agentic loops, and what does it give or take away in
answer quality?

## Part L — latency (local, real measurements)

1. **Aura recall latency** (`recall_structured`, top 10, `aura` from this
   branch) on stores of **300, 3,000 and 30,000** records:
   - records are LongMemEval-S turns, in order;
   - with embeddings from E19's cache;
   - also lexical-only, without an embedding function;
   - 50 queries per size (LongMemEval sample questions; their embeddings
     are cached);
   - report the median and p95 in ms.
2. **Query embedding time:** bge-m3 on local Ollama, 30 new short texts,
   one at a time; median and p95.
3. **Hook process start:** wall time to start `aura-bridge.exe` and exit
   (`--help` or an invalid argument, so nothing is written to the app); 20
   runs.
4. **Model latency against added context:**
   - `gemini-3.1-flash-lite` and `gemini-2.5-flash` (thinking off);
   - added context of 0, 1,000, 4,000 and 16,000 tokens (LongMemEval turns);
   - a short question, at most 30 output tokens;
   - 5 runs per size;
   - median wall time.

## Part B — benefit and harm (public data)

- **Memory needed:** E35's 120 LongMemEval-S questions.
  - Answers without memory (N) and with the user's-words memory (U) are
    reused from E35, unchanged.
  - For the gate, each question's top-1 recall score comes from a fresh
    Aura store of its user turns. Same construction as E35 U, with the
    score taken from `recall_structured`.
- **Memory not needed:** 120 TruthfulQA questions (`random.Random(57)`).
  - **None:** the question alone.
  - **Irrelevant:** the question plus the top 10 user-word memories that a
    LongMemEval haystack (assigned round-robin) returns for it.
  - Reader: E35's prompt and model (`gemini-3.1-flash-lite`).
  - Judge: E54's TruthfulQA judge (`gemini-2.5-flash`). Correct means
    `CORRECT` or `BOTH`.
  - The top-1 score is kept here too.
- **Policies, evaluated per question:**
  - **Never:** N for LongMemEval, None for TruthfulQA.
  - **Always:** U for LongMemEval, Irrelevant for TruthfulQA.
  - **Gate(τ):** inject only when the top-1 score ≥ τ. τ is swept over all
    observed scores; the ROC of the score for separating "memory needed"
    from "not needed" is reported.
  - **Session profile:** not testable on these single-question data.
    Modelled in Part A only as a fixed token cost.

## Part A — agentic loops (local, real trajectories)

From E45's OpenHands trajectories (`E:\aura-benchmarks\nebius__SWE-rebench-openhands-trajectories`), for a fixed sample of 2,000 trajectories (`random.Random(57)`), count:
- model calls per user message;
- input tokens per call, where available.

Then model the extra input tokens per user message:

| Policy | Extra input tokens per user message |
|---|---|
| per-call injection (proxy) | k × calls |
| per-message injection (hook) | k once, then carried in the conversation: k × (calls remaining) without caching, ~k with caching |
| session-start injection | k once per session |

Here k = the injected memory size (median of U's 10 records from Part B,
in tokens).

## Output

For workload mixes where memory is needed in 5%, 10%, 30% and 50% of
messages, each policy gets:
- expected accuracy;
- harm rate;
- added latency per message;
- added tokens per message;

plus the best τ.

## Gates (decide whether "always recall" is a sound default)

| Gate | Pass |
|---|---|
| W1 | memory helps where needed: acc(U) − acc(N) ≥ 30 pp on LongMemEval (expected from E35) |
| W2 | irrelevant memory does not hurt: acc(None) − acc(Irrelevant) ≤ 2 pp on TruthfulQA |
| W3 | a cheap gate separates: ROC AUC of the top-1 score ≥ 0.80 |
| W4 | recall stays cheap: median recall ≤ 50 ms at 30,000 records |

Rules for reading the gates:
- If W2 fails and W3 passes, a gate beats "always".
- If both pass, "always" is acceptable, and the choice comes down to cost.

## Budget

Hard stop at **$3** across the API calls of Parts L and B.
