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

### Phase 06.1: 补齐四大引擎未完成功能和修复类型错误 (INSERTED)

**Goal:** [Urgent work - to be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 06.1 to break down)

## Phase 7: MCP + Polish

**Goal:** MCP stdio server + full tool coverage + final parity verification

**Requirements:** REQ-001

**Success Criteria:**

- MCP stdio server starts and responds
- All tools (recall/store/search/insights/maintain/etc.) implemented
- Rust MCP and TS MCP produce equivalent responses for same brain directory
