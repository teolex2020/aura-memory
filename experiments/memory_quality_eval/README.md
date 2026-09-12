# Aura memory-quality evaluation

This is a deterministic retrieval-only evaluation harness for Aura's proposed
specialization: durable local memory for coding and operational agents. It keeps
answer generation out of the measurement, so retrieval quality, isolation,
temporal correctness, restart consistency and latency remain independently
inspectable.

The checked-in v1 dataset is synthetic and primarily English. Its Ukrainian and
mixed-language queries are small diagnostic slices, not assumptions about the
product's users. The dataset is useful for development and for finding failure
modes; it is not evidence that Aura beats a competitor. Public LoCoMo,
LongMemEval/LongMemEval-V2 adapters and a held-out real-project corpus remain
necessary for that claim.

## Arms

- `recent_history`: the latest eligible records in the requested namespace;
- `token_overlap`: a dependency-free BM25-style lexical baseline;
- `aura`: Aura's read-only `recall_as_of` ranking with all optional overlays off.

Quality calls use `recall_as_of`, including for unbounded facts, to prevent
query-order activation from changing later rankings. A separate cached-latency
measurement uses the normal `recall_structured` API.

## Run

```powershell
cargo run --release --offline --manifest-path experiments/memory_quality_eval/Cargo.toml
```

For a quick CI-sized run:

```powershell
cargo run --release --offline --manifest-path experiments/memory_quality_eval/Cargo.toml -- --quick --strict
```

The runner rewrites `results.json` and prints a compact summary. The JSON records
the dataset revision, configuration, per-query evidence rankings and scores,
overall and slice metrics, uncached and cached Aura latency, neighboring-tenant rank
shift, restart parity, and every acceptance check.

The token-overlap implementation favors readability over speed; its latency is
runner overhead and should not be used as a production BM25 performance claim.

## Metrics and gates

Answerable queries report evidence Recall@5, MRR, binary nDCG@5 and evidence
precision. Temporal and tenant cases also declare forbidden evidence. Empty
expected sets measure abstention, but v1 does not gate that metric because Aura
does not yet expose a calibrated no-answer confidence policy.

The strict gate currently requires:

- Aura Recall@5 at least matches the token-overlap baseline;
- zero forbidden evidence and namespace contamination;
- neighboring-tenant growth reduces Recall@5 by no more than 5 percentage points;
- every top-5 set and every expected-evidence outcome survives close and reopen.

Exact ordering is reported separately because tied scores may reorder without
changing the evidence set. The restart check happens after normal recall has
updated activation and coactivation state, so it also covers durability of
those adaptive mutations.

Any threshold change should include a rationale and preserve the old result for
comparison. Do not tune thresholds or retrieval behavior on a future held-out
corpus.
