# E6: embedding-based belief clustering across languages — preregistered protocol

Date frozen: 2026-09-28, before the embedding model was downloaded.

## Question

E5 showed advice parity across languages fails because belief clustering
needs near-identical wording. With host embeddings from a multilingual model
(`set_embedding_fn`), do paraphrases and translations of one claim form one
belief, so that the same experience gives the same advice in en, uk and de —
without merging unrelated records?

## Embedding model

`bge-m3` via local Ollama (`/api/embed`), chosen by the user. No other model.

## Step 1 — threshold calibration (before scoring)

A fixed list of calibration pairs (in `e6_eval.py`, `CALIBRATION`) that do
not appear in the fixture: same-meaning pairs (paraphrase, translation) and
different-meaning pairs (same domain, opposite outcome, unrelated). The
threshold is set to the midpoint between the lowest same-meaning cosine and
the highest different-meaning cosine, if they separate; otherwise the run
stops and reports that the model cannot separate them. The threshold is
written to the results before Step 2 and not changed afterwards.

## Step 2 — scored run (once)

The E5 fixture (en/uk/de × negative/positive, structured `outcome` on effect
records) plus, in every store, two distractor records with the same tag
(`result`) but unrelated meaning. A seventh case mixes languages in one store
(cause and effect records half English, half Ukrainian).

## Gates

| Gate | Pass |
|---|---|
| P1 negative parity | en, uk, de negative cases all surface `avoid` or `verify` |
| P2 positive parity | en, uk, de positive cases all surface `prefer` or `recommend` |
| P3 no false joins | no distractor shares a belief with an outcome effect record |
| P4 cross-language | the mixed en/uk case surfaces the expected negative advice |

## Not covered

Other embedding models, larger or noisier corpora, recall quality changes,
performance at scale (embedding snapshot per maintenance cycle).
