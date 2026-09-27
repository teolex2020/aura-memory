# Changelog

## Unreleased

### Changed

- Aura is plain MIT with no additional patent or commercial-licensing terms. The `PATENT` notice, the license-enforcement module that ran at library load (`ctor`), and the `ctor`/`base64` dependencies are removed. The dashboard `/stats` response no longer has a `license` field and reports the real package version.
- Python `set_belief_rerank_mode`, `set_concept_surface_mode`, `set_causal_rerank_mode`, `set_policy_rerank_mode`, and `set_causal_evidence_mode` raise `ValueError` for unknown modes instead of silently switching the feature off.
- `recall_with_embedding` uses the canonical recall path: temporal validity filtering, belief suppression in limited mode, audit logging, and topology reinforcement now apply.
- C FFI exports are declared `unsafe extern "C"` (the C ABI is unchanged).
- Removed the unimplemented `sync` feature, its `crdts` dependency, and the code gated behind it, which did not compile.
- `Cargo.lock` is committed for reproducible binary builds.

### Security

- **Untrusted evidence can no longer become trusted advice.** Policy hints now carry `evidence_source_floor`, the least trusted `source_type` among their supporting records. Hints resting on anything below `recorded` are capped at `verify` and surfaced with `untrusted_evidence = true` (new fields on `SurfacedPolicyHint`). Previously four `retrieved` records produced a stable `avoid` hint indistinguishable from one built on recorded evidence.
- `supersede` keeps the predecessor's `source_type` instead of always writing `recorded`. Consolidation never changes the surviving record's label and keeps the more trusted record when texts are equivalent (previously the survivor adopted the higher label).
- Generic writes can no longer forge authority. `store`, `update`, MCP/HTTP tools and imports reject consequence tags (`consequence-*`) and `cu_*`/`kind=consequence_unit` metadata; only `capture_consequence` sets them. Provenance (`source`, `verified`, `trust_score`) is always computed from the write channel, and caller-supplied values are kept as `claimed_*`. Future `timestamp`s are clamped. `update` keeps captured consequence tags, cannot edit provenance, and cannot raise `source_type` to a more trusted class. `import_context` strips reserved fields from shared fragments.

- `aura serve` binds `127.0.0.1` by default, refuses non-loopback hosts without an API key (`--api-key` / `AURA_API_KEY`), checks `Authorization: Bearer` or `X-API-Key` in constant time, and no longer sends permissive CORS headers. Cross-origin access is opt-in through `AURA_CORS_ORIGINS`. SSE sessions and queues are bounded, and the lazy brain singleton is created under a lock.
- The Rust dashboard no longer allows `Origin: null` by default, refuses non-loopback binds without `AURA_API_KEY`, rejects non-localhost `Host` headers when no key is set (DNS rebinding), and compares tokens in constant time.

### Fixed

- Fixed deadlocks between concurrent recall and writes: SDR index search vs. store, bounded reranking vs. delete, lexical index guards held into recall activation, and binary-store reads vs. appends. A multi-threaded stress test now covers recall, store, update, delete, and maintenance together.
- Python embedding callbacks now run before any store lock is taken and without holding the callback lock, preventing GIL deadlocks; callback errors are logged instead of silently dropped.
- `compact_active` holds the writer lock throughout, replaces `brain.aura` with one atomic rename (no window without a file), and keeps temporal links.
- Cognitive log compaction reloads the corpus under the writer lock, so concurrent appends are no longer lost, and removes the old snapshot before swapping logs so a crash cannot pair a stale snapshot with the new log. Snapshots pointing past the end of the log fall back to full replay.
- A torn record at the end of `brain.aura` (crash mid-append) is truncated on open instead of preventing the brain from opening; record lengths are validated before allocating.
- An exclusive `brain.lock` prevents two processes (or handles) from opening the same brain directory; `close()` releases it.
- SDR and n-gram candidate pools widen when namespace filtering discards out-of-scope candidates, so in-namespace results are no longer silently dropped in busy multi-namespace stores.
- SDR index and temporal-chain files are written atomically with fsync; maintenance logs persistence failures instead of ignoring them.
- **Consolidation no longer destroys distinct facts.** MinHash similarity ≥ 0.85 merged records that differed only by an identifier, number or negation, keeping one record's text and silently losing the rest (40 distinct facts collapsed into 1 in one maintenance run). A merge now happens only when the removed record's words, numbers and identifiers are all present in the kept one and negations agree. Merged-away records are also removed from SDR, lexical and embedding indexes and the binary store.
- Audit history purge also removes retrieve entries whose query quotes the purged content or names one of its identifier-like tokens.
- Managed audit history purge filters every journal before rewriting any, stages all replacements, and swaps each with one atomic rename, so a decode error or crash can no longer leave the journal half-rewritten or missing.
- Recall no longer clones the whole store on every query once any record has a validity window; a copy is built only when some record is currently outside its window.

## 1.60.0

### Fixed

- Decay, reflection, and archival now commit strength updates, graph cleanup, and tombstones as one crash-safe lifecycle frame. Failed writes restore the previous RAM state, and demoted records stay outside active indexes after reopen.
- Explicit `delete` is durable before the record disappears from active state, propagates tombstone failures, removes inbound graph links, and invalidates dependent beliefs, concepts, causal patterns, policies, topology, reflection summaries, and recall replay baselines.
- Operator pins are stored in cognitive records, migrated from legacy anchors, and respected by decay, level correction, reflection, and both archival strategies. Closed temporal versions are also retained for bitemporal recall until explicitly deleted.
- Age retention is scoped per namespace, parses RFC3339 timestamps as instants, and falls back to the record creation time instead of treating missing optional metadata as infinitely old.
- Lifecycle changes invalidate recall caches and remove stale n-gram, lexical, tag, aura, SDR, embedding, and lower-store index entries.
- Deferred recall flushes hold the record snapshot lock through the durable append, preventing concurrent updates or deletions from being overwritten on reopen. Failed flushes retain pending IDs for retry.
- Equal embedding scores use record IDs as stable tie-breakers before top-k selection.
- Opt-in context compaction preserves case-sensitive text distinctions and excludes typed source-code payloads from natural-language rewriting.
- Password-protected Aura stores now persist a wrapped key and authenticate on reopen. Cognitive journals, snapshots, audit entries, derived stores, replay state, and embeddings use authenticated encryption. Enabling encryption on existing plaintext history requires explicit migration into a new directory.
- Recall caches preserve namespace case and distinguish token budgets, exact strength thresholds, and connection expansion. Session recalls bypass result caching so activation still runs.
- Causal previews enforce namespace, validity, and default ACL checks; full-recall fallback applies the same ACL gate. New causal parents must exist in the same namespace.
- Ingest deduplication merges only exact compatible records, preserving negations and changed numbers or versions.
- Explicit graph connections persist both endpoints in one atomic journal frame before publishing either update.
- Recall activation and coactivation changes are durably batched on explicit `flush()` or `close()`, so adaptive state survives a clean restart without adding a disk sync to every query.
- Equal-score recall candidates use stable tie-breakers, keeping top-k rankings reproducible across reopen.
- The rebuilt MinHash n-gram index now uses fixed, documented coefficients instead of a new random family on every process start.
- Embeddings survive restart, reject invalid vectors, and invalidate recall caches after changes. Rust embedding mutations now return `Result`; callers must handle persistence errors. Portable containers include the embedding index; back up `memory.key` separately.

### Added

- **Portable MCP onboarding** — the wheel installs `aura` and `aura-mcp`, can validate the stdio server with `--check`, and generates ready-to-paste Claude, Cursor, VS Code, or generic client configuration with `--print-config`. MCP storage defaults preserve adaptive routing by treating `level` as an optional policy hint.
- **Observational outcome receipts** — Rust and Python can durably capture candidate IDs, selected IDs, and helpful, unhelpful, or inconclusive task outcomes in the managed audit journal. Receipts are idempotent, integrity-checked, namespace-safe, purge-aware, and never enter recall or retention.
- **Optional outcome evaluation evidence** — schema-v2 receipts can integrity-protect an exact selected-set logging probability and explicit per-candidate verifier verdicts for future offline policy evaluation. Receipts without these fields remain schema v1.
- **Scoped record purge** - Rust and Python expose `purge_record(record_id, scope)` with cumulative `active`, `derived`, `current_storage`, and `history` boundaries. Full managed-history purge rewrites current journals, the legacy binary store, audit rotations, and named snapshots, then keeps only a SHA-256 receipt without record content or raw ID.
- **Opt-in loss-aware context capsules** — `build_compacted_context_capsule()` removes exact natural-language duplication and safe discourse prefixes before token-budget packing, allowing more relevant records to reach an agent without rewriting memory or requiring an LLM.
- **Auditable compaction metrics** — results report baseline/output entry counts, additional entries, equivalent original tokens, saved tokens, reduction ratio, transformed entries, and safety-protected entries.
- **Citation-locked retrieval episodes** — opt-in `RetrievalEpisode` receipts record which evidence was actually opened for one answer and require every declared atomic claim to be supported by opened, citable evidence.
- **Conservative memory routing** — `suggest_memory_intent()` provides an advisory timeline/graph/documentary route while defaulting unknown memory queries to all representations.
- **Rust and Python citation-lock APIs** — `start_retrieval_episode()`, `open_verified_evidence()`, and `finalize()` expose auditable `allow`, `abstain`, or `block` outcomes with structured rejection reasons.

### Safety

- Outcome receipts and their optional evaluation evidence are observational only. They do not change recall scores, importance, strength, decay, retention, consolidation, or forgetting; adaptive use remains gated on a lived temporal holdout.
- Active goals and non-text payloads are excluded from compaction (ordinary final-entry budget truncation can still apply). Full originals stay in Aura and remain expandable by `record_id`; the existing `build_context_capsule()` API and behavior are unchanged.
- Citation admission is recomputed from immutable document/span lineage and current source bytes; caller confidence cannot override failed integrity, superseded/contested status, or citation permission. Episodes are read-only and do not alter ordinary recall behavior.

## 1.59.0

### Added

- **Evidence & Decision Audit Graph** — a deterministic, dependency-free read-model over existing Aura records connects sources, claims, decisions, actions, artifacts, and verifications with directed typed relations.
- **Decision and claim inspection** — `explain_decision()`, `trace_claim_evidence()`, and `find_claim_conflicts()` expose accepted/rejected evidence, source lineage, downstream outcomes, and advisory conflict workflows.
- **Bitemporal audit reconstruction** — append-only entity status events and validity-bounded edges support `audit_graph_at()` without creating a second source of truth.
- **Python audit API** — wheel users can annotate entities and link them using simple string kinds, statuses, and relations; inspection results are returned as ordinary dictionaries.

### Safety

- Audit links are namespace-safe, schema-checked, and persisted with existing typed connections in one atomic journal frame.
- Compact CRC-protected record patches keep graph-heavy journals bounded without weakening all-or-nothing crash replay.
- Conflict workflows remain advisory and never mutate claims or decisions automatically.
- Explicitly contradictory or refuting records are excluded from approximate duplicate consolidation, so a correction cannot inherit the durable level of the claim it opposes.

## 1.58.0

### Added

- **Hybrid lexical recall** — namespace-safe BM25 contributes a transparent ranking signal, with persisted replay traces for detecting ranking additions, removals, moves, and score drift.
- **Permission-aware memory retrieval** — public/restricted record ACLs support role, group, and principal allow-lists with audit and deny-by-default enforcement modes.
- **Portable `.aura` containers** — independently checksummed and compressed generation snapshots support incremental append, partial extraction, historical restore/diff, compaction, retention planning, legal holds, and background cleanup.
- **Safe concurrent container maintenance** — thread and cross-process mutation locks serialize export, append, compaction, retention, and legal-hold control generations.
- **Optional container provenance** — Ed25519 manifest chains, trusted-key import, and external anti-rollback checkpoints detect tampering, signer substitution, rollback, and same-generation forks without changing the simple unsigned workflow.

- **Context-aware applicability** — experiential memories can declare structured preconditions and receive deterministic `use`, `reject`, or `unknown` annotations during recall, without reranking, model calls, or unsafe inference from missing state.

### Changed

- Release wheel builds and Python smoke tests explicitly include and exercise the portable-container feature.
- Container retention can combine generation count, age, and compacted-size limits while preserving active legal holds.

## 1.57.0

Crash-safe temporal supersession and conservative contradiction-graph resolution.

### Added

- **Temporal memory versioning** — records can carry half-open business-time validity intervals (`valid_from`, `valid_until`) plus the system-time `superseded_at` audit timestamp.
- **Historical business-time recall** — `recall_as_of()` and time-aware context capsules reconstruct the version valid at a chosen Unix timestamp without activating records.
- **Effective-date supersession** — `supersede(..., effective_at=...)` closes the old version and opens its replacement at one deterministic boundary while preserving the causal version chain and namespace.
- **Inspectable memory decisions** — `explain_recall()` now returns a correlation-safe `trace_id`, selected results, bounded rejected candidates, aggregate gate counts, and structured reasons including `expired`, `not_yet_valid`, `below_strength_threshold`, and `outside_top_k`.
- **Governed durable-tier promotion** — one shared policy blocks automatic promotion into Domain/Identity for contradictory, conflicted, or high-volatility records; Identity additionally requires stronger activation and strength evidence.
- **Hypothesis competition traces** — selected and rejected recall evidence now identifies its hypothesis, the resolved winner, both scores, and whether it belongs to the winning side.

- **Atomic cognitive journal batches** — multi-record graph and version updates can be persisted as one CRC-protected, durable replay unit.

### Changed

- Normal recall, structured recall, search, cognitive/core tier recall, full recall, and context capsules exclude future and expired records by default.
- Legacy supersede chains are migrated on open using the successor creation time as their deterministic validity boundary.
- Python structured recall results expose `created_at`, `valid_from`, `valid_until`, and `superseded_at`.
- Explained recall emits a metadata-only `aura.memory_decision` tracing event and span attributes suitable for existing OpenTelemetry export; queries and record content are not written to the span.
- Maintenance refreshes epistemic conflict/volatility before promotion, considers only currently valid records during belief discovery, and reports promotion blocks by conflict, volatility, and Identity evidence threshold.
- Belief recency is based on `valid_from` or record creation time instead of `last_activated`, preventing retrieval from refreshing stale evidence.
- Resolved belief reranking now boosts only the winning hypothesis; losing hypotheses are excluded from current recall activation but remain available through audit/history and `explain_recall()` with `suppressed_by_belief_resolution`.

- Interrupted legacy supersessions with `superseded_by="pending"` are repaired on open: Aura links an existing successor or reopens the old version when no successor was committed.

### Fixed

- Minimal builds without the `encryption` feature compile again. Plain `Aura::open()` remains available, while password-protected opening now fails explicitly instead of referencing unavailable crypto functions or silently degrading to plaintext.
- Prevented contextual-hub promotion and repeated recall from bypassing contradiction governance and entrenching stale Domain/Identity rules.
- Prevented symmetric conflict mass from collapsing both sides of an explicit contradiction edge into the same hypothesis.
- Prevented a failed superseding write from closing the old version without a successor; the version boundary, causal links, and replacement are now committed atomically.
- Non-bipartite contradiction graphs (including odd cycles), disconnected conflict components, and non-binary conflict sets now remain unresolved instead of producing an artificial winner.
- Standalone reflection, decay, and shared-import paths no longer silently discard cognitive-journal write errors; fallible promotion and namespace-move APIs commit live changes only after persistence succeeds.

## 1.5.6

Immutable evidence lineage, deterministic context capsules, and observable recall outcomes.

### Added

- **Immutable evidence lineage** — SHA-256 binding between a source revision, its exact byte span, and an Aura claim, with independent verification and answer-permission gates.
- **Evidence-aware research ingestion** — Rust and Python APIs for findings carrying document revision, source-span integrity, verification status, and citation admission.
- **Context capsules** — deterministic, namespace-isolated, token-bounded hot context with selection reasons, omission counts, and stable content hashes.
- **Recall/search outcome telemetry** — counters for total and empty formatted recall, structured recall, tier recall, and exact search operations, with Python bindings and reset support.
- **Release metadata gate** — CI validation that the GitHub release tag, Rust crate, Python package, runtime version, and changelog agree.

### Changed

- Evidence-aware research reports are composed only from admitted findings. Free-form synthesis is omitted until synthesis can carry claim-level lineage.
- MCP stdio, MCP HTTP, and health responses now use the package `__version__` instead of stale hard-coded values.
- PyPI release metadata now links to the correct `aura-memory` project page.
- Repository metadata and documentation now use the canonical `teolex2020/aura-memory` GitHub URL.

### Fixed

- Prevented a valid integrity report for one source span from authorizing a claim bound to a different span.
- Prevented blocked evidence from being reintroduced through a generated research synthesis.
- Normalized blocked and superseded metadata before context-capsule filtering.
- Included the primary formatted `recall()` path and cache hits in empty-recall telemetry.

## 1.5.5

Learned weighted-graph topology, proven research-line capabilities, and a Colab quickstart.

### Added

- **Learned weighted-graph topology** (`topology` module) — a shared, decayable weighted graph that learns from use and fades with neglect ("use it or lose it"):
  - `Topology`, `Edge`, `NodeId`, and the `node_id_for` record-id bridge
  - Idempotent `connect_bidirectional`, saturating `reinforce_edge` (cap 1.0), `weaken_edge`, aging `decay_edges` (with prune), `remove_node`, max-policy `merge_nodes`
  - Two similarity metrics: `tanimoto_neighbors` (set Jaccard) and `weighted_neighbor_overlap`
  - Serde-backed `TopologyStore` persisting to `topology.cog`
- **Consequence Unit substrate** (`consequence` module) — `ConsequenceUnit`: a structured, first-class record of what happened after an agent or tool acted in the world (consequence polarity, units, policy hint). Exposed to Python.
- **Source credibility** (`credibility` module) — domain-reputation scoring for sources (rewritten from `source_credibility.py`).
- **Executable-judge world fact** (`executable_judge` module) — turns a real command's output into a 3-state world fact that can close an evidence debt (`world_fact_from_output`).
- **Neighbor-mass role similarity** (`neighbor_mass` module) — role similarity as overlap of external interaction mass (not entity identity); 512-bit bloom Jaccard via `neighbor_mass_role_similarity`.
- **Colab quickstart** — `examples/colab_quickstart.ipynb`.

### Changed

- **Recall now learns connections** — records that co-surface in a recall reinforce their topology edge (bounded, top-K capped), so frequently co-recalled records accrue weight over time.
- **Maintenance ages the topology** — each cycle decays un-reinforced edges and persists the result before causal discovery.
- **Causal discovery reads learned weights** — the causal layer prefers the learned topology weight over the static `Record.connections` map (and the historical `0.5` default), so causal edges reflect what memory actually learned. Opt-in and fully backward-compatible; the public API is unchanged.
- **Extended cognitive layers** — substantial additions to `belief`, `record`, `causal`, `consolidation`, `background_brain`, `aura`, and `maintenance_service` to support the substrate and consequence work above.
- README description updated; fixed broken Colab + Documentation links.

### Fixed

- Repaired a broken module reference: `lib.rs` declared `pub mod topology;` while the file was untracked, so a fresh clone would not compile. The `topology.rs` source is now committed.

## 1.5.4

Autonomous plasticity, cognitive guidance, and production integrity.

### Added

- **Autonomous cognitive plasticity (v5)**
  - Agents learn from their own inference without fine-tuning or LLM calls
  - `capture_experience()` / `ingest_experience_batch()` APIs
  - `PlasticityMode` with anti-hallucination guards, risk scoring, and purge/freeze controls
- **Cognitive guidance (v6)**
  - Salience weighting, maintenance-time reflection synthesis, contradiction governance, honest-answer support
- **Production integrity (v7)**
  - Concept persistence across restarts; belief reranking active by default
  - Concept partition cap; internal refactor into dedicated service layers
- **Operator surfaces**
  - Startup validation, persistence contract, namespace governance, correction review queues, suggested corrections

## 1.5.1

### Fixed

- MCP stdio transport rewritten to eliminate per-byte read latency
- MCP `_read_message` supports both `Content-Length` framing and bare JSON lines
- `Level` serialized to `str` in the `tool_search` response

### Added

- HTTP + SSE MCP server for Make.com, n8n, and other remote clients
- MCP registry files plus Cursor / Zed install docs; MCP tools table expanded to 11 tools

## 1.5.0

Full cognitive pipeline with activation-based decay.

### Added

- Activation-based decay across the cognitive pipeline (Phase 4 complete)
- Gemini demo: a cheap model with AuraSDK vs. an expensive model alone

### Fixed

- `ExplicitTrusted` pipeline — 5 gate bugs that blocked policy-hint formation
- Restored the `relation` module required by the `aura.rs` public API

## 1.4.1

This release completes the full 5-layer cognitive recall pipeline and ships a convenience API for enabling it in one call.

### Added

- **Phase 4d — `PolicyRerankMode::Off | Limited`**
  - Policy hints now shape recall ranking as the final bounded signal
  - Pipeline: `Belief (±5%) → Concept (±4%) → Causal (±3%) → Policy (±2%)`
  - `Prefer`/`Recommend` hints boost relevant records; `Avoid` hints slightly downrank
  - All scope guards retained: min 4 results, top_k ≤ 20, coverage > 0
  - `set_policy_rerank_mode()` / `get_policy_rerank_mode()` API

- **`enable_full_cognitive_stack()` / `disable_full_cognitive_stack()`**
  - Single-call convenience API to activate or deactivate all four cognitive reranking phases
  - Available from both Rust and Python

- **Python bindings for all cognitive mode setters**
  - `aura.enable_full_cognitive_stack()`
  - `aura.disable_full_cognitive_stack()`
  - `aura.set_belief_rerank_mode("off" | "shadow" | "limited")`
  - `aura.set_concept_surface_mode("off" | "inspect" | "limited")`
  - `aura.set_causal_rerank_mode("off" | "limited")`
  - `aura.set_policy_rerank_mode("off" | "limited")`

- **A/B quality benchmark** (`tests/quality_benchmark.rs`)
  - Proves All-Limited pipeline is not worse than All-Off across Precision@K, MRR, NDCG@K
  - Ground-truth labeled corpus with known relevant IDs

- **`ConceptSurfaceMode::Off | Inspect | Limited`**
  - `Inspect` exposes bounded surfaced concepts and per-record annotations
  - `Limited` activates concept reranking as Phase 4b in the recall pipeline
  - Runtime concept-surface telemetry in maintenance reporting

### Production-Relevant

- Full cognitive recall pipeline active: Belief → Concept → Causal → Policy (all bounded)
- Policy surfaced output: stable advisory API
- `enable_full_cognitive_stack()` recommended for new integrations

### Advisory / Inspect Only

- Concept surfaced output (`get_surfaced_concepts()`)
- Causal surfaced patterns (`get_surfaced_causal_patterns()`)
- Policy surfaced hints (`get_surfaced_policy_hints()`)

### Safety Guarantees Preserved

- No LLM dependency introduced
- No cloud dependency introduced
- All rerank phases bounded: score cap + positional shift cap + scope guards
- Deterministic: same query always returns same order (cache-hit path)
- Zero result removal: downrank ≠ remove

### Validation

- Full suite green at release: `828 passed, 0 failed`
- Policy Limited eval: 10 tests (no degradation, score bounds, soak)
- Full stack eval: 12 combined-mode tests
- Quality benchmark: 9 A/B tests (MRR, P@K, NDCG@K)
