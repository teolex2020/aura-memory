# E4: host LLM classifier for claim certainty — preregistered protocol

Date frozen: 2026-09-28, before `data/independent2.jsonl` was read or scored.

## Question

E3 showed the built-in phrase rules are safe (no first-hand statement demoted,
hearsay precision 1.00) but miss a third of hearsay and most hedging. The user
does not want to grow dictionaries. Does a small local LLM plugged in through
`set_claim_classifier` pass the E3 gates on unseen data?

## Arms

- `rules` — built-in phrase rules only (E3 detector, unchanged).
- `llm:qwen3:4b-instruct` — LLM only; unparseable output counts as `asserted`.
- `llm+rules:qwen3:4b-instruct` — LLM first; unparseable output falls back to
  rules (the production hook behaviour).
- `llm:gemma3n:e4b` — second local model, LLM only.

Models are already installed locally (Ollama). Temperature 0, no network.

## Prompt (fixed; see `llm_eval.py` `PROMPT`)

Zero-shot label definitions identical to the E3 protocol, asking for exactly
one word. No examples from any dataset.

## Data

Primary: `data/independent2.jsonl`, 160 sentences (40 per label, 20 uk + 20 en)
written by a separate agent with no repository access; hashed before reading.
Secondary: `data/independent.jsonl` (E3). It is reported but not decisive: its
misses were seen while writing E3 results, which may bias prompt wording.

## Gates (same as E3, on the primary set)

| Gate | Pass |
|---|---|
| H1 hearsay recall | ≥ 0.80 |
| H2 first-hand safety | ≤ 2 of 40 `asserted` classified as `hearsay` or `speculative` (5%) |
| H3 hearsay precision | ≥ 0.85 |
| H4 4-class accuracy | ≥ 0.70 |

Also reported, not gated: median and p95 latency per sentence.

## Decision rule

If an LLM arm passes all four gates, document `set_claim_classifier` with that
model as the recommended way to get certainty. The built-in rules stay as the
no-LLM fallback. If none passes, report numbers and keep the rules-only default.

## Frozen input

`data/independent2.jsonl` sha256 `f65d3b94a18023b64e6bb29d356f7b19014b09d2f1186db2705d2b746eea049f` (recorded before reading or
scoring). The author flagged 12 items as genuinely ambiguous (forecasts, labels,
rhetorical questions, "reckons"); labels are used as given.
