# ROADMAP.md

## Phase 1: M1 — Read-Only Skeleton + Workspace Setup

**Goal:** Workspace + effect-smol skeleton + read-only parsing for brain.aura, temporal.bin, brain.cog+snap

**Requirements:** REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-010

**Success Criteria:**

- `bun run typecheck` passes
- `bun run test` passes for read-only fixtures
- Rust-generated fixtures can be parsed by TS
- Cross-package imports use `@aura/*` only

## Phase 2: M2 — Write + Encryption

**Goal:** Write/flush brain.aura + optional encryption + cross-language read-back tests

**Requirements:** REQ-001, REQ-008

**Success Criteria:**

- TS writes brain.aura, Rust reads it back correctly
- Encryption/decryption roundtrip matches Rust oracle
- CRC32, bincode, JSON serialization byte-aligned

## Phase 3: M3 — Indexing + Cognitive + Full Compatibility

**Goal:** Roaring bitmap indexing + cognitive file write + full disk format compatibility

**Requirements:** REQ-001, REQ-009

**Success Criteria:**

- index_manifest.json + sdr.idx read/write aligned with Rust
- brain.cog + brain.snap write verified by Rust
- NGramIndex (MinHash+LSH) aligned with Rust
- InvertedIndex.search semantics aligned with Rust
- Trust/Recency formula aligned with Rust

## Phase 4: Recall Pipeline + Core Facade

**Goal:** Full recall pipeline with optional services + core facade API

**Requirements:** REQ-009, REQ-010

**Success Criteria:**

- SDR + NGram + Tags + optional Embedding signals working
- RRF fusion deterministic
- graph_walk + causal_walk expansion aligned
- recallScored + recallRecords APIs exposed
- Rust/TS parity tests pass (fixture → TS recall → compare ids)

## Phase 5: Epistemic Skeleton + Maintenance Phase 1

**Goal:** Belief/Concept/Causal/Policy skeleton + Trace + Belief implementation

**Requirements:** REQ-011, REQ-012

**Success Criteria:**

- BeliefEngine/Store type-safe with Rust alignment tests
- ConceptEngine/Store skeleton
- CausalEngine/PolicyEngine skeleton
- EpistemicRuntime DI wired

## Phase 6: Maintenance Pipeline Completion

**Goal:** Full maintenance pipeline (Belief → Concept → Causal → Policy) + bounded reranking + finalize

**Requirements:** REQ-012

**Success Criteria:**

- All four engines produce deterministic output matching Rust
- Bounded reranking integrated into recall pipeline
- Finalize mutations (activate/strengthen/session) persisted

**Plans:** 5 plans, 3 waves

Plans:

- [ ] 06-01-PLAN.md — Contract types for Causal and Policy domains + typed interfaces
- [ ] 06-02-PLAN.md — CausalEngine: discover, invalidate_pattern, retract_pattern (TDD)
- [ ] 06-03-PLAN.md — PolicyEngine: discover, retract_hint (TDD)
- [ ] 06-04-PLAN.md — BoundedReranker + RecallFinalizer implementations
- [ ] 06-05-PLAN.md — EpistemicRuntime maintenance pipeline + DefaultLayer registration

### Phase 06.2: MaintenanceService + EpistemicRuntime 重构 — 将维护编排与认知检查分离，对齐 Rust 双层架构

**Goal:** Separate maintenance orchestration from epistemic inspection, aligning with Rust's MaintenanceService + EpistemicRuntime dual-layer architecture. EpistemicRuntime becomes pure read-only inspection surface; MaintenanceService handles full 14-method maintenance cycle orchestration.

**Requirements:** REQ-011, REQ-012
**Depends on:** Phase 6
**Plans:** 8/8 plans complete
Plans:
**Wave 1**

- [x] 06.2-01-PLAN.md — Contract types: Maintenance.ts, EpistemicInspection.ts, updated EpistemicRuntime.Interface

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06.2-02-PLAN.md — Concept surface functions: surfaceConcepts, surfaceConceptsFiltered (TDD)
- [x] 06.2-03-PLAN.md — Policy surface functions: surfacePolicyHints, surfacePolicyHintsFiltered (TDD)
- [x] 06.2-04-PLAN.md — EpistemicRuntime rewrite: remove maintain(), add Refs + telemetry + 12 simple inspection methods
- [x] 06.2-06-PLAN.md — MaintenanceService: 14 Effect functions for full maintenance cycle orchestration

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06.2-05-PLAN.md — EpistemicRuntime complex aggregates + surface delegation (TDD)

### Phase 06.3: Engine Algorithm Parity — 对齐 Rust 引擎算法 (INSERTED)

**Goal:** Align TS BeliefEngine/ConceptEngine/CausalEngine/PolicyEngine algorithms with Rust reference to achieve deterministic cross-language parity. Close 14 systematic deviations identified in AUDIT-DIFF.md across thresholds, clustering strategies, signal sources, scoring formulas, and guard conditions.

**Requirements:** REQ-011, REQ-012
**Depends on:** Phase 06.2
**Source:** AUDIT-DIFF.md, EXPLAIN.md
**Plans:** 4/11 plans executed

**Scope (by priority):**

| Priority | Engine | Gaps |
|----------|--------|------|
| P0 | BeliefEngine | SDR threshold 0.6→0.15, incremental update (key_index), contradiction-based hypothesis |
| P0 | CausalEngine | Rewrite to record-level edge extraction (explicit + temporal edges) |
| P1 | BeliefEngine | Coarse key guard strategies (tag_guarded, bridge_guarded, tag_sdr_guarded) |
| P1 | ConceptEngine | CanonicalFeature mode (stemming + equivalence dictionary), cluster guards |
| P1 | CausalEngine | Evidence gates (support, repeated window, counterfactual) |
| P1 | PolicyEngine | Multi-engine integration, polarity classification + action mapping |
| P2 | BeliefEngine | BridgeKey normalize, TagFamilyAdaptive/TagFamilyBackoff |
| P2 | PolicyEngine | Suppression phase, recommendation text generation |

**Wave 1** *(autonomous)*

- [x] 06.3-01-PLAN.md — Contract type expansions: CausalTypes (20+ fields), PolicyTypes (polarity/recommendation), BeliefTypes (key_index/record_index), updated Causal/Policy discover signatures

**Wave 2** *(blocked on Wave 1)*

- [x] 06.3-02-PLAN.md — BeliefEngine P0: contradiction split, deterministic IDs, thresholds (0.15/14d), incremental update, sample variance (TDD)
- [x] 06.3-03-PLAN.md — BeliefEngine P1: 4 SDR subcluster guards + coarse key mode alignment (Standard truncation, TagFamily, DualKey) (TDD)
- [x] 06.3-04-PLAN.md — BeliefEngine P2: BridgeKey normalize, TagFamily backoff strategies, apply_layer_feedback rewrite (TDD)

**Wave 3** *(blocked on Wave 2)*

- [ ] 06.3-05-PLAN.md — ConceptEngine P1: CanonicalFeature mode (stemming+equivalence+Jaccard) + expanded stop words (TDD)
- [ ] 06.3-06-PLAN.md — ConceptEngine P1+P2: Cluster guards + surface alignment (per-ns cap, 5-dim tiebreak) (TDD)

**Wave 4** *(blocked on Wave 3)*

- [ ] 06.3-07-PLAN.md — CausalEngine P0: record-level edge extraction + belief-level aggregation + MaintenanceService call update (TDD)
- [ ] 06.3-08-PLAN.md — CausalEngine P1+P2: 20+ field scoring + evidence gates + corpus fingerprint (TDD)

**Wave 5** *(blocked on Wave 4)*

- [ ] 06.3-09-PLAN.md — PolicyEngine P1: 3-engine discover + seed selection + polarity + action mapping + MaintenanceService call update (TDD)
- [ ] 06.3-10-PLAN.md — PolicyEngine P2: 4-dim scoring + suppression + recommendation templates + surface alignment (TDD)

**Wave 6** *(blocked on Waves 1-5)*

- [ ] 06.3-11-PLAN.md — Integration: full typecheck + test suite + AUDIT-DIFF.md status update (checkpoint)

### Phase 06.1: 补齐四大引擎未完成功能和修复类型错误 (INSERTED)

**Goal:** Fix TypeScript strict type errors across epistemic engine packages (CausalEngine, BoundedReranker, EpistemicRuntime)
**Requirements:** REQ-012
**Depends on:** Phase 6
**Plans:** 1/1 plans complete

Plans:

- [x] 06.1-01-PLAN.md — Fix strict type errors in CausalEngine, BoundedReranker, EpistemicRuntime

## Phase 7: MCP + Polish

**Goal:** MCP stdio server + full tool coverage + final parity verification

**Requirements:** REQ-001

**Success Criteria:**

- MCP stdio server starts and responds
- All tools (recall/store/search/insights/maintain/etc.) implemented
- Rust MCP and TS MCP produce equivalent responses for same brain directory
