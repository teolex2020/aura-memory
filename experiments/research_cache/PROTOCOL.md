# E33: research cache — research once into memory, or search every time?

Frozen before data. Measurement only.

## Question

The owner's idea:

- research a topic **once** (gather sources, extract statements with their
  sources) into Aura;
- afterwards any AI answers from memory instead of searching the web again
  with expensive tokens;
- the same block serves every connected AI.

Is the answer quality close enough, and is the cost per question much lower?

## Topics and gold (independent author with web access, hashed before reading)

An author who has no access to this repository and does not know our
pipeline writes:

- **6 topics** the answer models are unlikely to know from training:
  events after 2026-06, or niche subjects. 3 relevant to Ukraine (questions
  in uk) and 3 international (questions in en).
- **10 questions per topic, 60 in total.** Each has:
  - a short gold answer;
  - the URL(s) that support the answer.

  Questions mix single facts, numbers and dates, and synthesis across two
  sources.

## Arms

The answer model is `gemini-3.1-flash-lite` (temperature 0) in both arms.
Web search uses Gemini API grounding with Google Search.

- **R — research every time.** For each question, a grounded call (search
  plus answer).
- **C — cache.**
  - **Build:** per topic, grounded calls collect sources, and statements with
    their URL are extracted from them, one statement per record.
  - **Store:** each record goes into Aura as outside content (`retrieved`,
    metadata `url`, `topic`).
  - **Answer:** each question is answered from Aura's `recall()` context,
    with no web call.
  - Embeddings are bge-m3 (E31: needed for this kind of material). The
    ungrounded arm is also reported.

The build budget is fixed before running: a set number of grounded calls
per topic, recorded in `run.py`.

## Metrics

- **Accuracy:** answer matches gold, judged by `gemini-2.5-flash-lite` with
  a fixed prompt.
- **Cost:** tokens and dollars:
  - C: build once, then per question;
  - R: per question.

  Also the break-even number of questions per topic.
- **Citation support:** for 60 random cached statements, does the cited
  page support it? Same judge, against fetched page text.

## Gates (build only if all hold)

1. Accuracy: C ≥ R − 5 pp.
2. Cost per question at 5 questions per topic, build included: C ≤ R / 5.
3. Citation support of cached statements ≥ 90%.

## Budget

Total spend ≤ $5. If grounding pricing makes the planned run exceed that, the
run stops and the owner is asked first.

## Limits stated in advance

- One answer model, one search provider.
- Synthetic questions from one author.
- Freshness over time (re-research) is not tested.
