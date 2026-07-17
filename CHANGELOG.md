# Changelog

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
