# Discounted evidence mass

This isolates the denominator defect identified in the
[context adaptation experiment](../context_importance_eval/RESULTS.uk.md).
Accumulated benefit and effective evidence mass decay on the same event clock.
The original lifetime receipt denominator remains in control arms. This prototype
changes experiment code only; the SDK's production retention policy is unchanged.

See the [protocol](PROTOCOL.md) for the fixed formulas, arms and interpretation.
The [measured result](RESULTS.uk.md) reports successful mechanism checks but failed
quality criteria: consistent evidence mass alone did not improve retained-rule utility.
The runner uses the previous local opaque event export and verifies its SHA-256.
If missing, prepare it using the previous experiment's `prepare.py` and pinned
source files. No original operational payloads are copied into this directory.

```powershell
cargo test --offline --no-default-features --example evidence_mass_eval
cargo run --release --offline --no-default-features --example evidence_mass_eval
python experiments/evidence_mass_eval/verify_repeat.py
```

The Rust example is a separate snapshot of the previous runner so historical code,
protocols and measurements remain reproducible. Before reporting new results it
requires exact equality of all non-timing historical baseline results, including
allocation size, decisions and feedback counters. It also checks that the slot
size remains identical. The new `f32` mass uses existing struct padding on the
measured Windows target; the live compiler's `size_of` is authoritative.

`configuration.json` records fixed choices before replay; no parameter selection
is performed. `results.json` contains every arm/cell and paired comparisons.
`diagnostics.json` isolates sustained feedback and stale evidence. `verification.json`
records repeatability and unchanged historical artifacts. A successful process
exit means the experiment completed, regardless of quality criteria.

Both the data and the last 20% evaluation segment have already been examined.
Results are exploratory paired replay, not independent confirmation. The model
predicts the next observed process state with a bounded table of transition rules;
it does not measure the correctness of operational actions, full SDK retrieval,
or a memory's causal contribution to an agent's task outcome.

One epoch remains one global input event, with a 128-event half-life. Activation,
strength feedback, admission, rule selection and context attenuation are fixed.
The experiment therefore does not remove all time constants or solve context-
dependent forgetting. It tests whether consistent evidence normalization helps
before changing any of those other mechanisms.
