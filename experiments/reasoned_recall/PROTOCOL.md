# E16: facts that need a reasoning step — preregistered protocol

Date frozen: 2026-09-29, before the dataset existed and before the runner.

## Question

E15 found that similarity search misses lasting facts about the user when
the question needs a reasoning step ("can I take amoxicillin?" → "I am
allergic to penicillin"): only 11/24 reached the context in any format.
PageIndex (VectifyAI) retrieves by LLM reasoning instead of similarity.
Which cheap addition fixes this for Aura without hurting ordinary answers
or letting untrusted text in?

## Arms (prototypes in the runner, on top of the current build)

- **B** — `recall(question)` (provenance context, current default).
- **K** — B plus an always-shown block of first-hand IDENTITY records
  (effective source `recorded`: not `retrieved`, not relayed by a model,
  not hearsay/speculative), most recent first, capped at 25% of the token
  budget. No LLM.
- **R** — B plus a reasoning hook: a local LLM sees **only the question**
  (never memory) and returns up to 5 short search phrases for facts about
  the user that could matter; each phrase is recalled (`top_k=5`) and the
  first-hand hits not already in context are added as a block. One LLM call.
- **KR** — both blocks (reported only).

Block header for K/R/KR: `[ABOUT THE USER — first-hand facts that may matter]`,
placed before the recall context.

PageIndex itself is not run: it needs a paid API and navigates a document
tree, not a stream of short memories.

## Data (separate author, no repository access, hashed before reading)

`data/personas.jsonl`: 8 personas (4 uk, 4 en). Each: 15 identity facts,
60 ordinary records (tasks, notes, knowledge, near-miss distractors),
3 untrusted records (web/email) of which at least one falsely claims an
identity fact at identity level, 6 **inference** questions (answer needs one
identity fact, not lexically similar) and 4 **control** questions (answer in
an ordinary record).

## Measures

- Identity fact present in the context (deterministic), inference questions.
- `qwen3:4b-instruct` answer correct (expected token), inference and control.
- Untrusted identity claims appearing in any added block (must be 0).
- Added context size and hook latency.

## Gates (qwen3:4b-instruct)

| Gate | Pass |
|---|---|
| J1 | identity presence: arm ≥ B + 30 pp |
| J2 | inference answers correct: arm ≥ B + 20 pp |
| J3 | control answers correct: arm ≥ B − 5 pp |
| J4 | untrusted identity claims in added blocks: 0 |

An arm is adopted for a core implementation only if it passes J1–J4. If K
and R both pass, K is preferred (no LLM, deterministic) unless R's J2 result
is at least 10 pp higher.

## Amendment D1 (2026-09-29, before any run)

`data/personas.jsonl` sha256 `9e6976a4795f248d804b4845ed7d8efd7e5eb7eb8cd0655d2febc7de5049261d` (8 personas, 48 inference and 32 control questions). Automatic check issues: []. The author flags p7q1 ("pork" answerable without the fact) and p8q4 (weak link) as weak inference questions; kept as written.
