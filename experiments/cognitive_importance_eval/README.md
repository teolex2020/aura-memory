# Cognitive importance under a fixed state budget

This experiment asks whether past task outcomes improve what Aura keeps and
forgets, while every policy is allowed to delete records. It does not add a
database, archive, embedding model, or production retention policy.

Read the [protocol](PROTOCOL.md) for the frozen selection procedure and limitations.
The [measured result](RESULTS.uk.md) includes the favorable average and individual
context-shift regressions; both are material to the next decision.
The [independent-source follow-up](../context_importance_eval/RESULTS.uk.md) failed
its advancement gate; the favorable synthetic average did not establish transfer.
The implementation is [a Rust example](../../examples/cognitive_importance_eval.rs)
using Aura's actual `Record::activate`, `Record::importance`,
`Record::apply_route_state_decay`, and `Record::is_alive` functions.

```powershell
cargo test --offline --no-default-features --example cognitive_importance_eval
cargo run --release --offline --no-default-features --example cognitive_importance_eval
```

The runner fits 15 utility settings on training seeds, shortlists three, selects
one on validation seeds, writes `selection.json`, and then evaluates the held-out
seeds. `results.json` contains every case/budget/seed result, baselines, negative
controls, timing observations and the advancement gate. It exits successfully
after a completed experiment even when the advancement gate is false.

The utility score is the existing importance plus a fitted weight on signed,
discounted prior outcome benefit, divided by the entry's serialized bytes. Its
feedback horizon is fitted too. Benefit is supplied by the simulated task host
after an outcome. The prototype cannot independently identify causal contribution
or the business cost of a mistake; that instrumentation is a separate requirement.

All policies receive direct feedback effects on strength; positive verified
outcomes also mark the record `consequence-support`. This is an experimental
composition of feedback and consequence evidence, not a claim that Aura's current
`feedback()` method automatically assigns that tag. Shared graph, level promotion,
salience hints, SDK caches and persistence are outside this retention-only model.

The shuffled control moves only the additional utility receipt to a different
retained record. Existing strength/tag effects stay correctly attributed. The
no-feedback ablation withholds all receipts, including those existing effects;
it tests feedback availability, not solely the added score feature.

IDs are seeded opaque random values, so neither the policy nor its tie-breaker
uses semantic role labels. Exact evidence availability is evaluated by ID; a
successful synthetic task requires all designated records. Warm-up outcomes can
inform selection, but only subsequent tasks count toward reported success.

The representation budget includes retained record text and per-entry metadata.
It excludes allocator overhead, map keys, fixed runner state, and one in-flight
candidate. JSON encoding and full scans intentionally make accounting transparent;
their timings are not a production implementation benchmark. Cold storage is not
used. The evaluator keeps the input trace outside the policy for scoring only.

Training and test use different seeds but the same five synthetic scenario
families. Reported uncertainty measures variation among those seeded traces,
not uncertainty about arbitrary real-world users. A favorable result justifies
independent trace replay and an efficient implementation experiment, not a claim
that general cognitive importance has been solved.
