# E5: language-independent outcome polarity — preregistered protocol

Date frozen: 2026-09-28, before any change to polarity code.

## Question

Policy advice (`avoid` vs `prefer`) depends on whether an action's effects were
good or bad. The core decides that from English keywords in tags and text
(`policy.rs` NEGATIVE/POSITIVE_KEYWORDS, `causal.rs` *_OUTCOME_KEYWORDS). Does
the same experience produce the same advice in other languages, and does a
structured outcome signal fix it without any word list?

## Fixture

For each language (en, uk, de) and each outcome (negative, positive), a fresh
store gets: two cause records (tag `deploy`), two effect records
(`caused_by_id` → cause, tag `result`), six unrelated fillers; two maintenance
runs. Texts say the same thing in each language. Every effect record also
carries `metadata.outcome = negative|positive` — a language-independent
field that the current core ignores.

Tags are language-neutral (`deploy`, `result`) so that only text differs.

## Measure

The action kind of surfaced hints backed by the fixture's records.

## Gates

| Gate | Pass |
|---|---|
| O1 negative parity | all three languages surface `avoid` or `verify` for negative outcomes |
| O2 positive parity | all three languages surface `prefer` or `recommend` for positive outcomes |
| O3 no word lists | polarity code in `policy.rs`/`causal.rs` contains no natural-language keyword list |

Run 1 measures the current core. After the change, run 2 uses the same
fixture and gates.

## Not covered

Other languages, free text without a structured outcome (that is the optional
host classifier hook, evaluated separately), mixed-outcome patterns.
