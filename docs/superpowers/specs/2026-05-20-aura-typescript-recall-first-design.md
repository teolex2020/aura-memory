# Aura TypeScript Port (Bun) — Recall-First Design

## Goal

Prioritize implementing the Rust recall pipeline in TypeScript with:

- Disk-format compatibility for inputs that recall depends on (read-path first).
- effect-smol style layering: everything is supplied via `Context` / `Layer`, enabling deterministic mock tests.
- Optional subsystems (embedding + bounded reranking + finalize mutations) supplied as optional services; if not provided, the pipeline skips them.

Write-path cross-language verifier tests are explicitly deferred until recall is stable.

## Non-Goals (This Phase)

- Implementing full write/flush for every persistence surface.
- Implementing backup/restore and versions snapshotting (kept as minimal stubs).
- Building HTTP server.

## Key Principles

### Layered Architecture (effect-smol)

- `@aura/contract`: service contracts only (FileRead/FileWrite/Clock/Crypto + future recall services).
- `@aura/platform-node`: Bun/Node implementations of contracts (Live layers).
- `@aura/utils`: pure functions only.
- `@aura/codec`: binary codecs and crypto primitives.
- `@aura/storage`: persistence formats (read-first) and runtime view builders.
- `@aura/recall`: pure recall pipeline (algorithms) + optional hooks.
- `@aura/core`: façade orchestration (`Aura.open`, `Aura.recall*`) that wires views + provides defaults.

### “Simple Implementation” vs “Full Implementation” Comments

For every module that has an incremental path, code MUST include explicit comment markers:

- `SIMPLE IMPLEMENTATION:` describes what is done now and what is intentionally skipped.
- `FULL IMPLEMENTATION:` describes the Rust-equivalent behavior, file formats, scoring/ranking details, and links to Rust reference locations.

This is mandatory to avoid future re-audits.

## Recall Scope: Align Rust recall_core

We aim to align with Rust:

- Signals: SDR + NGram + Tags + Embedding (optional)
- Fusion: RRF
- Expansion: Graph walk + Causal walk
- Scoring: trust-aware recency weighting
- Optional bounded reranking: belief/concept/causal/policy (optional service)
- Optional finalize: activate + co-recall strengthen + session tracking (optional service)

### Authoritative Data Model

Recall requires both sources:

- Cognitive `Record` set (primary): provides `tags`, `connections`, `caused_by_id`, `metadata`, `source_type`, `strength`, `namespace`, etc.
- Aura-memory storage (secondary): provides SDR headers (`sdr_indices`) and index lookup.

Linking key:

- Each cognitive record may contain `aura_id: string | null`.
- At runtime build `auraIndex: Map<auraId, recordId>` for SDR candidate mapping.

## Persistence Surfaces (Recall-Relevant)

This phase focuses on read-path sufficient for recall runtime.

Required:

- `brain.aura` (read) and aura header cache
- `index/` (`index_manifest.json`, `sdr.idx`) for SDR inverted index
- `brain.cog` + `brain.snap` (read) to build cognitive `Record` map

Also loaded by Rust `Aura::open` but not strictly required for minimal recall:

- `persistence_manifest.json` (already implemented in TS open)
- `beliefs.cog`, `concepts.cog`, `causal.cog`, `policies.cog`
- `maintenance_trends.json`, `reflection_summaries.json`

These become required once bounded reranking is enabled.

## Services (Context) and Optionality

### Core Required Services

- `FileRead`: read required files
- `Clock`: used for recency scoring and deterministic tests

### Runtime View Service

Introduce a single service that represents the recall read model:

- `RecallView` service provides:
  - `records: Map<RecordId, Record>`
  - `auraIndex: Map<AuraId, RecordId>`
  - `invertedIndex: InvertedIndex`
  - `auraHeaders: Map<AuraId, { sdr_indices: number[]; ... }>` (minimal header cache)
  - `ngramIndex` and `tagIndex` (either loaded or derived)
  - `sessionTracker` (for finalize, optional)

`@aura/storage` owns building `RecallView` from disk.

### Optional Services (Provided If Available)

Each optional part is expressed as a service; the pipeline uses it via optional lookup.

- `EmbeddingStore` (optional): `query(text, topK) -> Array<{ record_id, score }>`
- `BoundedReranker` (optional): `rerank(scored, query, view) -> scored`
- `RecallFinalizer` (optional): `finalize(scored, view, sessionId?) -> viewMutations`
- `TrustConfig` (optional): trust weighting config; defaults if absent

If a service is missing, the pipeline must behave as:

- Embedding missing: skip embedding signal.
- BoundedReranker missing: skip reranking.
- RecallFinalizer missing: no activation/strengthen/session updates.

## Algorithm Design (Aligned With Rust)

Reference: Rust implementations are in:

- `recall.rs` (signals, RRF, expansions, recency scoring, finalize helpers)
- `recall_service.rs` (orchestration)
- `index.rs` (inverted index)
- `ngram.rs` (ngram index)

### Signal Collection

- SDR:
  - `query -> SDRInterpreter.text_to_sdr`
  - `invertedIndex.search(bits, top_k*2, min_overlap=1)`
  - map aura_id -> record_id via `auraIndex`, fallback direct match
  - compute Tanimoto against aura header `sdr_indices`
- NGram:
  - `ngramIndex.query(query, top_k*4)` then namespace filter
- Tags:
  - parse query tokens as tag candidates and compute Jaccard
- Embedding (optional):
  - directly produce ranked list (record_id, score)

### Fusion and Expansion

- `rrf_fuse` with `k=60`, normalize by max_possible
- `graph_walk` (2 hops) and `causal_walk` (depth 3)

### Scoring

- Trust-aware recency weighting:
  - `final_score = rrf_score * strength * effective_trust(metadata, now, config, source_type)`

### Optional Bounded Reranking

- For full alignment, reranking uses belief/concept/causal/policy engines.
- In TS, the engines are accessed via `BoundedReranker` service, allowing separate implementation cadence.

### Optional Finalize

- Activations and strengthening are mutations on cognitive records and session tracker.
- In TS, mutations are represented explicitly and applied only if `RecallFinalizer` is provided.

## Testing Strategy (Recall-First)

### Phase A — Pure pipeline tests (no disk)

- Provide a mock `RecallView` layer with a few records.
- Deterministically assert:
  - each signal’s candidate list
  - RRF fusion ranking
  - graph/causal expansion behavior
  - recency scoring effect with fixed `Clock`

### Phase B — Fixture read-path tests (disk)

- Use Rust fixture generators to produce a tiny dataset.
- TS loads via `@aura/storage` view builder, then runs recall and asserts stable results.

### Phase C — Write-path cross-language verifier (deferred)

- Once recall is stable, implement write/flush and add Rust verifiers for persisted mutations.

## Open Questions

- Whether `brain.idx` (backup module) is still relevant long-term; currently separate from `index/`.
- If we need to preserve exact float scoring ordering across Rust/TS; if needed, define deterministic tie-breakers.

