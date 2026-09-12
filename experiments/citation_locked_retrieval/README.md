# Citation-locked retrieval experiment

This experiment evaluates one narrow idea from *Agent Zero Memory*: an answer
may cite only evidence that was actually opened during that retrieval episode.

This is the original isolated research harness. The opt-in SDK implementation is
now documented in the [main README](../../README.md#citation-locked-retrieval-episodes).
The historical prototype reuses Aura's existing
immutable lineage and evidence-admission primitives, then adds an in-memory
`RetrievalEpisode` with:

- an intent gate and deterministic memory-bucket router;
- candidate and opened-evidence sets;
- per-answer atomic support requirements;
- a final `allow` / `abstain` decision;
- auditable rejection reasons.

Run the structural experiment:

```powershell
cargo run --release --manifest-path experiments/citation_locked_retrieval/Cargo.toml
cargo test --release --manifest-path experiments/citation_locked_retrieval/Cargo.toml
```

The run emits ignored local-model fixtures under `generated/`. `model_ab.py`
can evaluate the ordinary candidate context against the citation-locked opened
context through any OpenAI-compatible local llama.cpp server.
