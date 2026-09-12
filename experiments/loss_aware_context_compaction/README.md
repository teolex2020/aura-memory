# Loss-aware context compaction experiment

This is the original isolated research harness, kept for reproducing its results.
An opt-in SDK implementation is now documented in the [main README](../../README.md).
The harness itself is not part of the default recall path or Python wheel; its
historical measurements are not measurements of later SDK fixes.

The experiment asks one narrow question: can a deterministic, dependency-free
presentation layer remove duplicated and known boilerplate text from an Aura
context capsule without changing critical facts or structured metadata?

It deliberately keeps the original capsule available for exact expansion. The
compacted text is never written back to memory.

## Run

```text
cargo run --release --manifest-path experiments/loss_aware_context_compaction/Cargo.toml
```

To emit the exact baseline and compacted prompts used by the local-model A/B:

```text
cargo run --release --manifest-path experiments/loss_aware_context_compaction/Cargo.toml -- --emit-model-ab
python experiments/loss_aware_context_compaction/model_ab.py
```

## Acceptance gates

- estimated context-token reduction is at least 30%;
- every declared critical span survives byte-for-byte;
- all structured entry fields remain unchanged;
- every compacted entry expands to the exact original text;
- p95 whole-capsule compaction time is below 1 ms on the test machine.
- fixed-budget deterministic QA improves and does not regress;
- compression causes no regression when baseline and compacted prompts contain
  the same records.
- local-model QA improves by at least 20 percentage points with zero paired
  regressions before the policy is considered for integration.

Passing these structural and deterministic QA gates is only evidence that the
idea deserves a second, model-based A/B evaluation. It is not sufficient
evidence to integrate the experiment into Aura.
