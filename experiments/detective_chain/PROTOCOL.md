# E52: a detective's chain — answering only through a chain of facts

Status: **frozen 2026-10-07**, before any model call. **Test only**: nothing
is built into the core or the app.

## Question

The owner's idea: a detective does not believe a single mention. A claim
stands only when a chain of facts, each one checkable, leads to it.

Aura answers from a set of separate retrieved records. It never builds the
chain. E46 measured what that costs on MemoryAgentBench FactConsolidation
(updated facts, numbered by recency):
- single-hop questions: 75–92%;
- multi-hop questions: 7–16%.

E52 asks two things:
1. Does building the chain step by step fix multi-hop?
2. Does requiring every link to be checkable change accuracy and how often
   the system answers at all?

## Data

The same as E46. MemoryAgentBench `Conflict_Resolution` (MIT):
- single-hop (`sh`) and multi-hop (`mh`);
- 6k, 32k, 64k and 262k;
- 100 questions each, 800 questions in all.

Each numbered fact line is one record, kept with its serial number; a
larger number is newer. Embeddings: bge-m3 on local Ollama, normalised,
cosine, cached as in E46.

## Arms

All arms use `gemini-3.1-flash-lite` at temperature 0. The score is the
official substring exact match against any gold answer.

- **R0 (E46, reused):** the top 10 records for the question, then
  MemoryAgentBench's official `rag_agent` template. The E46 rows are reused
  as they are, with the same model and template.
- **CH, chain:** up to 5 steps. Each step:
  1. retrieves the top 10 records for the current lookup;
  2. at step 1 the lookup is the question itself;
  3. later lookups are the model's own next sub-question.

  The step prompt (below) shows:
  - the retrieved records with their serial numbers;
  - the recency rule ("a larger serial number is newer and overrides an
    older fact about the same thing");
  - the question;
  - the chain so far.

  The model returns one JSON step, containing a link and then either the
  next sub-question or the final answer:
  - the link is `{"fact": <serial>, "finding": "<what that fact gives>"}`;
  - the next sub-question is `"next": "<next single-fact question>"`;
  - the final answer is `"final": "<concise answer>"`.

  If no `final` comes within 5 steps, the last finding is the answer. CH
  does not check its links.
- **CV, chain with verified links:** the same as CH, but each link is
  checked deterministically, with no model and no word lists:
  1. the cited serial must be one of the records shown at that step;
  2. the `finding` must appear (case-insensitive) in that record's text.

  A failed link gets one retry, with the message "the cited fact does not
  state your finding". If it fails again, CV answers "unsupported". The
  final answer must also be a verified finding.

  This is the owner's rule: assert only what a chain of real records
  supports.

## Step prompt

System:

```
You answer questions from a knowledge pool like a detective: every step of
your reasoning must rest on one fact from the pool.
```

User:

```
[Knowledge Pool]
<records, one per line, with serial numbers>

Rule: a larger serial number is a newer fact and overrides an older fact
about the same thing.

Question: <question>
Chain so far:
<numbered links "fact #N: finding", or "(none)">

Do exactly one step. Reply with one JSON object only:
{"link": {"fact": <serial number of the fact you use>, "finding": "<the entity or value that fact gives>"},
 "next": "<the next single-fact question to look up>"}
or, when the chain answers the question:
{"link": {"fact": <serial>, "finding": "<answer>"}, "final": "<concise answer>"}
```

## Gates

| Gate | Pass |
|---|---|
| D1 | the chain fixes multi-hop: mean over sizes of CH − R0 on `mh` ≥ +15 pp |
| D2 | the chain does not break single-hop: mean of CH − R0 on `sh` ≥ −2 pp |
| D3 | checkable chains are not worse: mean `mh` accuracy of CV ≥ CH − 3 pp |

## Also reported

- Accuracy per size and hop for R0, CH and CV.
- For CV: how often it says "unsupported", and accuracy on the questions it
  answers (precision).
- Mean number of steps, and how often the gold answer is among the shown
  records at some step.
- Cost: own cache, hard stop at **$5**.

## Planned follow-up (not part of E52)

**E53, a single mention against the chain.** On the same data, plant one
outside record that asserts a wrong final answer directly. Measure whether
R0, CH and CV take that shortcut.
