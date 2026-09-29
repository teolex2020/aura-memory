# E20: LongMemEval answers, Aura capture vs mem0 — preregistered protocol

Status: **frozen 2026-09-29** (amendment D1 at the end), before any run.

## Why

E19 showed retrieval is at parity and near the ceiling (evidence session in
the top 10 for 99% of questions), but that Aura's capture ranks the
assistant's own words lower (NDCG 0.47 vs 0.70). LongMemEval's headline
number is answer accuracy judged by an LLM; that is where systems differ.

## Setup

- Data and sample: exactly E19 (LongMemEval-S `2ec2a557`, 120 questions, 20 per
  type, `random.Random(19)`), same stores and the same `bge-m3` embeddings
  (E19 cache), top 10 retrieved turns per question.
- Arms: **M** (mem0 2.2.1, `infer=False`), **A-cap** (Aura as the capture
  adapter writes), **A-flat** (Aura, no channel) — as E19.
- **Context, identical format for every arm:** each retrieved turn as
  `[Session time: <date>]\n<Role>: <text>`, joined by `\n\n---\n\n`, in the
  arm's rank order (date and role looked up from the dataset by text).
- **Reader:** `gemini-3.8-flash` (Google API, the newest stable model available
  to the key; preview Pro models are rate-limited), aegis-memory's reader system
  prompt and user message (`Current date`, `Retrieved memories`, `Question`),
  max 4,096 output tokens including the model's thinking, provider defaults otherwise.
- **Judge:** `gemini-3.8-flash` with the official LongMemEval judge prompts
  verbatim (per question type, `evaluate_qa.py`, via aegis-memory's vendored
  copy); "yes" in the reply = correct.
- Responses are cached; a failed call is retried with backoff and never
  replaced by a guess.

The official judge is GPT-4o, which is no longer served, so accuracies here
compare the arms with each other, not with published tables. Reader and judge
are the same model; this affects every arm alike.

## Metrics

Answer accuracy overall and per question type; retrieved context length;
reader and judge token usage.

## Gates

| Gate | Pass |
|---|---|
| H1 | accuracy: A-cap ≥ M − 5 pp |
| H2 | accuracy: A-cap ≥ A-flat − 5 pp |
| H3 | single-session-assistant accuracy: A-cap ≥ A-flat − 10 pp |

## Decision rule

- **H1 fails:** Aura's memory leads to worse answers than a plain vector
  store; find why before building on it.
- **H2 or H3 fails:** the lower rank of the assistant's words (E19) costs
  answers; fix ranking by source before capture ships widely.
- **All pass:** answering is not a blocker; next is the full 470-question run
  and the provenance-context format of the product (`recall()`).

Failures are reported, not retried away.

## Amendment D1 (2026-09-29, before any run)

- `run.py` sha256 `12aaad18beaf4d2216216a1b892e6879985f048184833e473c6402ce8d78ada7`; retrieval code and embeddings from E19 (`e9929f6`).
- Models available to the key were listed before choosing; `gemini-3.8-flash` answered a
  one-word probe (unrelated to the dataset) to check the API wrapper. No question was sent
  before freezing.
