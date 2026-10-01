# E31: does Aura need semantic embeddings?

Frozen before any run. Measurement only; no core change.

## Question

The desktop app opens Aura without an embedding function, so recall uses
only Aura's own signals (lexical index, character n-grams, structure,
connections). Every benchmark so far (E19–E29) ran with bge-m3 embeddings.
How much retrieval does Aura lose without them?

The owner's rule: adding a model (weight, dependency) is worth considering
only if the effect is radical.

## Arms

- **EMB** — `set_embedding_fn` with bge-m3 through local Ollama, exactly as
  in E19–E29.
- **LEX** — no embedding function (the desktop app today).

Same core build (current HEAD, recorded in RESULTS), same stores, same
queries. Each question gets a fresh store per arm.

## Datasets (already frozen, not re-authored)

- **D1 — LongMemEval-S, 120 questions.** E19's selection: seed 19, 20 per
  question type, `longmemeval_s.json` SHA-256 `08d8dad4…7894`. Stores are
  built with E19's capture mode (`A-cap`).
  Metrics (E19's judge):
  - `turn_any@10`: an evidence turn is among the top-10 recalled records;
  - `ndcg@10`.
- **D2 — E22b personas.** 8 personas (4 uk, 4 en), 48 questions that need an
  identity fact and 80 control questions, built with E22b's `build_store`.
  Metric: the needed fact is in the default `recall()` context, checked
  deterministically:
  - inference questions: `identity_marker`;
  - control questions: any of `expected_any`.

## Decision rule

Let Δ = EMB − LEX on each dataset's primary metric (D1: `turn_any@10`;
D2: share of questions whose needed fact is in context).

- **Radical:** Δ ≥ 10 pp on D1 or on D2 → embeddings matter. The next
  step is a separate experiment on the lightest option (for example, use a
  local Ollama when present, nothing bundled).
- **Small:** Δ < 5 pp on both → close the question. The app stays without
  embeddings.
- **In between:** report the numbers; the owner decides.

## Also reported

- Per question type (D1) and per language and question type (D2).
- Median query latency per arm.
- Questions LEX misses but EMB finds, with 10 examples, to see what kind of
  wording lexical recall misses.

## Limits stated in advance

- Retrieval only, no answer model: this measures what reaches the model, not
  the final answer.
- D2 was authored for E22b, not for this question.
