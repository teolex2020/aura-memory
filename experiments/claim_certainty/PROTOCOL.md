# E3: claim certainty and hearsay — preregistered protocol

Date frozen: 2026-09-28, before the detector was written.

## Question

A user's own statement ("I was born on May 12") and a relayed claim ("I heard
the factory closed") come through the same channel but deserve different
trust. Can Aura tell them apart from the text, well enough to use as a trust
signal, without demoting the user's own facts?

## Labels (fixed before writing data)

- `asserted` — the speaker states something first-hand, including reports of
  their own speech ("I said no").
- `hearsay` — the speaker relays a claim that originates from someone else or
  unspecified others ("told me", "I heard", "they say", "according to",
  "reportedly", "the article claims"), regardless of that source's reliability.
- `hedged` — first-hand but qualified ("probably", "I think", "мабуть").
- `speculative` — explicitly uncertain or hypothetical ("maybe", "might",
  "може бути", "не знаю, чи").

## Data

- `data/heldout.jsonl` — 80 sentences (20 per label, 10 uk + 10 en each),
  written and hashed **before** the detector:
  `sha256 3083cd9478eacbc0d70dde95ab84006834aa4c20b19cdd347d0c72140c597bee`.
  It is scored once. It must not be read while developing markers.
- `data/dev.jsonl` — separate sentences used while developing the detector.

## Gates on the held-out set

| Gate | Pass condition | Why |
|---|---|---|
| H1 hearsay recall | ≥ 0.80 | relayed claims must be caught |
| H2 first-hand safety | ≤ 1 of 20 `asserted` classified as `hearsay` or `speculative` | never demote the user's own facts |
| H3 hearsay precision | ≥ 0.85 | don't mislabel other kinds as hearsay |
| H4 4-class accuracy | ≥ 0.70 | overall usefulness |

## Integration gates (Aura store path)

| Gate | Pass condition |
|---|---|
| I1 | a first-hand identity fact ("Я народився …") is stored `asserted` with confidence unchanged from its source, at Identity level |
| I2 | a hearsay record is stored with `claim_certainty = hearsay` and lower confidence than the same text asserted |
| I3 | a policy hint resting only on hearsay records is marked `untrusted_evidence` (E2 mechanism) |
| I4 | the MCP store path without `source_type` stores `inferred`; with `recorded` it keeps `recorded` but is marked `relayed_by_model` and counts as untrusted evidence |

## Not covered

Other languages, sarcasm, nested reports ("she said he heard"), long
multi-claim paragraphs, LLM-based classification.

## Amendment D1 (2026-09-28, before scoring the independent set)

The first held-out set scored 80/80. It was written by the same author, in the
same session, minutes before the detector, and several markers were taken
from its own phrasing; it cannot show generalization. It is kept and reported,
but it is not evidence of real-world accuracy.

A second held-out set, `data/independent.jsonl`, was written by a separate
agent with no access to the repository or the marker lists, instructed to use
varied and tricky phrasings (120 sentences, 30 per label, half uk / half en).
It was hashed before being read or scored and is scored exactly once, with the
same gates H1–H4:

`sha256 cf3da5b975fea3fc94866d7a7259d78fc3f04e2170a5b4d3e52c142413e26566`

The independent author flagged one item as borderline ("Нібито наш відділ
хочуть об'єднати з маркетингом.", labeled hearsay). Labels are used as given.
