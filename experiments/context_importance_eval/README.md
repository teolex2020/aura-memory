# Context adaptation under a compact memory budget

This is the independent-source follow-up to the
[synthetic importance experiment](../cognitive_importance_eval/README.md).
It replays historical operational event logs as next-state prediction tasks.
The context utility candidate **failed** the frozen advancement gate. See
[measured results and diagnosis](RESULTS.uk.md).
The next [evidence-normalization experiment](../evidence_mass_eval/RESULTS.uk.md)
isolates one diagnosed mechanism and reports an unsuccessful quality result.

This is a fixed-width transition-memory surrogate, not a full Aura SDK benchmark.
It uses the Working-level importance algebra and candidate/confirmed route-decay
rates. A unit test compares these against actual SDK `Record` methods. Semantic
retrieval, graph effects, level promotion, persistence and host-agent task execution
are outside this experiment. All policies may forget; forgotten rules have no archive.

## Reproduce

The pinned input CSVs must be present at the local paths listed in
[source_manifest.json](source_manifest.json). Preparation verifies their hashes,
reads them without modification, and exports only opaque identifiers/timestamps.
The export is ignored by Git; original operational payloads are not copied here.
The source files were previously used in a different Aura-clean experiment.

```powershell
python experiments/context_importance_eval/prepare.py
python -m unittest discover -s experiments/context_importance_eval -p test_prepare.py -v
cargo test --offline --no-default-features --example context_importance_eval
cargo run --release --offline --no-default-features --example context_importance_eval
python experiments/context_importance_eval/verify_repeat.py
```

The [frozen protocol](PROTOCOL.md) specifies chronological splits, policy selection,
feedback attribution, context controls and advancement criteria. The runner writes
`selection.json` after validation and before held-out replay. `results.json` records
all dataset/budget cells, including negative results. `diagnostics.json` contains
post-result algebra probes; they never select or modify the evaluated policies.
`verification.json` records exact non-timing replay agreement and two timing runs.
Successful execution returns zero even when the advancement gate is false.

## Accounting and interpretation

One entry is 80 bytes on the measured target. The policy struct is 104 bytes; one
80-byte incoming-rule scratch slot is also charged. Preallocated vectors hold
23/48/100 entries for the 2/4/8 KiB budgets, charging 2024/4024/8184 bytes. This
excludes allocator overhead, general call-stack overhead, input events and external
host state. The host maintains each case's previous observed state and outstanding
prediction; it cannot restore forgotten rules. These numbers are not total process
RSS or the size of arbitrary text memories in the SDK.

At each event, score the previous prediction for that case; tick maintenance;
deliver feedback only if the exact rule generation survives; observe the now-known
transition; issue the next prediction. A route-decay tick is one logical event,
not wall-clock time or a production scheduler invocation. Existing rule observations
increment their count; queries activate them. Lookup favors specific-context rules
over global backoff, then observation count, then deterministic opaque-key ties.
This shared prediction mechanism itself limits the conclusions.

The negative control permutes context IDs only in retention scoring. It preserves
lookup and receipt identity, but deliberately destroys the link between current
context and stored rules. It is a corruption control, not a simulated user regime.

Accuracy is the next *observed* state, with abstentions counted as misses. Operational
history does not label whether an action was desirable. Inspected Aura working-memory
records did not provide enough joined, delayed per-memory task outcomes for a real
host-agent utility replay; that limitation is documented in the source manifest.
The conclusion concerns this retention surrogate on two datasets, not multilingual
quality, general cognitive importance, or comparative market performance.
