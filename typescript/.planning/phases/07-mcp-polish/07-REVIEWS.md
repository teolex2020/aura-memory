---
phase: 7
reviewers: [claude]
reviewed_at: 2026-05-30T22:39:10+08:00
plans_reviewed:
  - 07-01-PLAN.md
  - 07-02-PLAN.md
  - 07-03-PLAN.md
  - 07-04-PLAN.md
  - 07-05-PLAN.md
  - 07-06-PLAN.md
  - 07-07-PLAN.md
  - 07-08-PLAN.md
---

# Cross-AI Plan Review - Phase 7

## Claude Review

# Cross-AI Plan Review: Phase 07 (MCP + Polish)

## Overall Assessment

The 8-plan, 4-wave structure is logically sound in its dependency ordering and correctly identifies the full scope of Phase 7's four responsibilities (DTOs, maintenance debt, MCP transport, parity harness). However, several plans carry scope risk, and the deep serial dependency chain from Wave 1 through Wave 4 means any stall in early waves cascades. The key architectural tensions are: (a) whether Plan 07-02's typed shims produce enough real data for downstream plans to be meaningful, and (b) whether Plan 07-05's scope (evidence bridge + correction write paths + 6 explainability surfaces) is executable as a single plan.

---

## 07-01 — Contract DTOs + Unsupported Errors + Storage Helpers

**Summary:** Lays the shared type foundation. Correctly places DTOs in `@aura/contract`, defers correction-log file persistence (matching Rust's in-memory model), and reuses existing JSON snapshot infrastructure. Well-scoped for Wave 1.

**Strengths:**
- Correct architecture decision: shared DTOs in `@aura/contract`, not duplicated in `@aura/core` or `@aura/mcp`
- Explicitly avoids creating correction-log file persistence where Rust doesn't have it
- Reuses `CogJsonSnapshotFile` rather than inventing one-off serializers
- Dedicated unsupported-error file matches D-26 requirement

**Concerns:**
- **MEDIUM:** The DTO list is illustrative ("at minimum cover these named payloads") rather than exhaustive. The executor could miss types. The plan should reference a concrete checklist derived from `api_groups.rs` — specifically `ExplainabilityBundle` has sub-fields (`explain_record`, `provenance_chain`, `correction_excerpts`, `instability_snapshot`, `maintenance_trend_summary`) that each need DTO definitions.
- **MEDIUM:** `CrossNamespaceDigestOptions` has an `include_dimensions` string-array flag parsed by `apply_cross_namespace_dimension_flags` in Rust. The plan doesn't mention that helper or its dimension set (`concepts`, `tags`, `structural`, `causal`, `belief_states`, `corrections`). This helper needs a TS equivalent.
- **LOW:** The "round-trip shape stability" tests need concrete fixtures. If the DTOs use `Date` or `number` for timestamps, JSON round-trip behavior differs from Rust's `String` timestamps.

**Suggestions:**
- Add a concrete DTO checklist appendix referencing each Rust struct from `api_groups.rs` with its field set
- Note that `CrossNamespaceDigestOptions` needs a companion `applyCrossNamespaceDimensionFlags` helper
- Specify timestamp representation (ISO string vs epoch seconds) to preempt serialization mismatches

---

## 07-02 — MaintenanceService Parity Completion

**Summary:** The most architecturally critical plan. Replaces 5 `unknown` placeholders and 15 D-07 stubs with either real implementations or typed shims. The classification-pass-before-implementation approach is good discipline, but the shim ceiling creates a tension: shims that are too minimal produce empty discovery results, making `maintain` a timing-only no-op that starves downstream plans of real data.

**Strengths:**
- Classification pass before implementation prevents sprawl
- Typed-shim ceiling with explicit per-subsystem disposition prevents "build every missing subsystem"
- Clear three-state outcome (implemented / typed shim / escalated gap) with documented disposition table
- Recognizes that in-memory `Aura` state is source of truth, with disk as derived cache

**Concerns:**
- **HIGH:** The `SDRInterpreter` shim is defined as "deterministic empty/identity SDR decode helpers only." In Rust, `build_sdr_lookup` calls `sdr.text_to_sdr(&rec.content, false)` to produce real SDR vectors. These vectors are the foundation of concept discovery, causal discovery, and policy discovery. An empty/identity shim means `buildSdrLookup` produces no useful vectors, which means concept/causal/policy discovery phases produce zero results. The entire maintenance cycle becomes a timing shell. Downstream plans (07-04 `cross_namespace_digest`, 07-05 `explainability_bundle`) will operate on empty data. This is the single biggest parity risk in the phase.
- **HIGH:** `TagTaxonomy` as "read-only normalization/classification against existing tag strings" — Rust's `fix_memory_levels` and `guarded_reflect` both consume `TagTaxonomy`. If these algorithms can't run, the `levelFix` and `reflect` phases remain stubs.
- **MEDIUM:** The `insights::detect_all` requirement — Rust's implementation scans records for patterns. The plan says to implement "minimum parity" but doesn't define what "minimum" means. If the SDR and taxonomy shims are empty, insights detection may find nothing.
- **MEDIUM:** The `BackgroundBrain` shim as "no-op/disabled" is fine for this plan, but `runPostDiscoveryPhases` in Rust uses it for `discover_cross_connections` and `check_scheduled_tasks`. Post-discovery will produce zero cross-connections and zero task reminders.

**Suggestions:**
- Re-evaluate the SDR shim ceiling. At minimum, `buildSdrLookup` needs to produce real (even if simplified) SDR vectors for records that have content. An "empty array" shim cascades to empty discovery for the entire pipeline. Consider a "minimum viable SDR" that at least produces token-level sparse vectors.
- Split the plan into two sequential sub-passes: (A) replace `unknown` placeholders with typed shims (safe, mechanical), then (B) implement real algorithms for the phases that feed downstream surfaces. This prevents the executor from stopping at (A) and calling it done.
- Add a verification gate: after this plan, `runMaintenance()` must produce at least one non-zero discovery report (concept or causal) when run against a brain with real content.

---

## 07-03 — Core Facade Alignment + Backlog 999.1/999.2

**Summary:** Adds 6 missing operational surfaces to `Aura`, replaces `Effect.die` defects with typed failures, fixes the `BrainAuraRecord`/`AuraRecord` mismatch in `runMaintenance`, and cleans up the Policy surface zombie adapter. The scope is broad for a single Wave 1 plan.

**Strengths:**
- Correctly identifies the `BrainAuraRecord[]` vs `Map<string, AuraRecord>` mismatch in `runMaintenance()` (line 410 of Aura.ts loads cognitive records while the constructor stores `BrainAuraRecord[]`)
- Policy surface cleanup scope is well-defined: remove the deprecated `PolicyEngine` flat container and `policyEngineFromState` adapter
- Grep for zombie adapter in `epistemic-runtime/src/` is a good defensive check
- Centralizing xxhash NON-PARITY markers is practical

**Concerns:**
- **HIGH:** Adding `search` to the core facade. Rust's `Aura::search` in `api_groups.rs` takes 8 parameters (query, level, tags, limit, content_type, source_type, namespaces, semantic_type) and searches an in-memory record index. TS has no search index — `Aura` stores `BrainAuraRecord[]` in memory but `search` needs to filter across all cognitive records. The plan doesn't address where the search index lives or how it's populated.
- **HIGH:** Adding `consolidate` — Rust's implementation calls `consolidation::consolidate()` which operates on `records`, `ngram_index`, `tag_index`, and `aura_index`. TS has none of these indexes (they're part of the `NGramIndex` and `CognitiveStore` placeholders from Plan 07-02). The plan needs to specify whether `consolidate` is implemented or explicitly unsupported.
- **MEDIUM:** `store_code` and `store_decision` are thin wrappers in Rust (they compose content and call `store`). The plan should note this so the executor doesn't over-engineer them — each is ~15 lines in Rust.
- **MEDIUM:** `insights` — Rust calls `self.brain.stats()` which returns a `(HashMap, usize, f64, f64)` tuple. TS `Aura` has no `stats()` method. The plan should specify what data `insights` returns (record counts by namespace? total records?).

**Suggestions:**
- Downgrade `consolidate` to explicit unsupported in this plan if the consolidation indexes don't exist, or add it as a dependency on 07-02 completing the `NGramIndex` shim
- Add a note that `store_code` and `store_decision` are composition-only (no new algorithms)
- Specify the `insights` output shape: should it mirror Rust's `get_analytics()` tuple or be a richer DTO?

---

## 07-04 — Governance/Inspection Read Models

**Summary:** Builds 5 core facades (`belief_instability`, `policy_lifecycle`, `namespace_governance_status`, `memory_health`, `cross_namespace_digest`) reusing `EpistemicRuntime` for read-only primitives and composing them with maintenance data. The staged approach (zero/empty correction fields now, backfill in 07-05) is architecturally sound.

**Strengths:**
- Reuses `EpistemicRuntime` instead of duplicating business logic (matches D-12)
- Per-surface input map is explicitly documented
- Staged delivery with documented zero-data baseline prevents circular dependency with 07-05
- `cross_namespace_digest` implementation notes cover Rust option handling, clamping, and dimension flags

**Concerns:**
- **MEDIUM:** `cross_namespace_digest` in Rust computes namespace-level concept overlap, shared tags, structural overlap (shared record IDs), causal signature overlap, belief state summaries, and correction counts. Even with zero correction data, the concept/tag/structural/causal computations need real discovery output from engines. If Plan 07-02's SDR shim produces empty discovery, the cross-namespace digest will show namespaces with zero concepts, zero shared tags, and zero structural overlap. All "parity" tests would pass (deterministic zeros) but be vacuous.
- **MEDIUM:** `memory_health` in Rust returns a `MemoryHealthDigest` struct. The plan doesn't enumerate the struct's fields or their data sources. Without knowing what `MemoryHealthDigest` contains, the executor can't verify they've wired the right inputs.
- **LOW:** The plan says to add methods to `Aura` but doesn't specify whether these are instance methods or static methods. Rust uses instance methods (`&self`). TS should match.

**Suggestions:**
- Add a concrete field checklist for `MemoryHealthDigest` from `aura.rs`
- Verify that `cross_namespace_digest` has at least one non-zero output dimension when run against a brain with real multi-namespace content (acceptance gate)
- Make the dependency on Plan 07-02's discovery data quality explicit: if discovery produces no results, note this as a known limitation in 07-04-SUMMARY.md

---

## 07-05 — Explainability + Correction Facades

**Summary:** The highest-risk plan by scope. Builds a recall evidence bridge (provenance layer), correction write paths (deprecate/invalidate/retract), correction read models (log, review queues, suggested corrections), and 3 explainability surfaces. This is a mini-phase unto itself.

**Strengths:**
- Evidence bridge concept is architecturally correct — building provenance before explainability prevents shallow implementations
- Correction write path enumeration is explicit and matches Rust's `CorrectionApi` surface
- Reuses `EpistemicRuntime.getContradictionClusters()` for the contradiction review queue
- Requires that empty fields stay present in DTOs as empty arrays rather than being omitted (structural stability)

**Concerns:**
- **HIGH:** The evidence bridge requires reconstructing per-record provenance across SDR, tags, ngram, graph, causal, trust, and recency dimensions. This is essentially building a full recall explainability infrastructure. In Rust, this is powered by `RecallExplanation` which is backed by the recall pipeline's internal scoring. TS's recall pipeline (`recallScoredEffect`) returns scored IDs but doesn't expose per-signal contribution breakdowns. The plan needs to either extend the recall pipeline to expose signal-level scores or define a compatible reconstruction.
- **HIGH:** The correction write path needs mutation methods on engine state. Looking at the existing code, `BeliefEngine.Interface` in the contract likely has `discover()` and `stats()` but not `deprecate_belief()`. The plan says "add the smallest contract-aligned correction writers" but this requires extending engine contracts — a cross-package change that wasn't mentioned in Plan 07-01's contract scope.
- **MEDIUM:** The plan depends on 07-04 but 07-04's read models are populated with zero correction data. After 07-05 adds correction write paths, 07-04's outputs need to be re-verified with non-zero data. This backfill coupling isn't tracked in either plan's verification steps.
- **MEDIUM:** `explainability_bundle` in Rust bundles `explain_record`, `provenance_chain`, `correction_excerpts`, `instability_snapshot`, `maintenance_trend_summary`. If any sub-component is unsupported, the bundle is incomplete. The plan should specify what a "degraded but valid" bundle looks like.

**Suggestions:**
- Split into two plans: 07-05a (evidence bridge + correction write/read path) and 07-05b (explainability surfaces that consume the bridge). This gives a natural checkpoint and prevents the executor from implementing explainability on top of an incomplete bridge.
- Add engine contract extension requirements to Plan 07-01's scope or create a new contract addition step
- Add a cross-plan verification step: after 07-05 completes, re-run 07-04's tests to confirm correction data backfills correctly

---

## 07-06 — @aura/mcp Package Scaffold

**Summary:** Creates the new workspace package with Mastra-based stdio server. The Bun/ESM compatibility spike and explicit fallback to `@modelcontextprotocol/sdk` are good risk management.

**Strengths:**
- Bun/ESM compatibility spike before full inventory registration prevents late-stage tooling failures
- Explicit fallback to `@modelcontextprotocol/sdk` with documented decision point
- Fail-fast initialization matches Rust's startup contract (D-07)
- Tool inventory declared up front but split by family for maintainability

**Concerns:**
- **MEDIUM:** The plan depends on 07-03, 07-04, and 07-05 — the entire Wave 1 and Wave 2. If any Wave 2 plan has scope issues, the MCP scaffold can't start. A partial scaffold that registers only the operational tools (store, recall, search — from 07-03) could be built in parallel with Waves 2.
- **LOW:** The plan doesn't specify whether `package.json` for `@aura/mcp` uses `"type": "module"` (matching the workspace convention) or needs special ESM/CJS configuration for Mastra compatibility.
- **LOW:** Mastra's MCP server documentation (as noted in RESEARCH.md) needs live verification. If the Mastra API has changed since the research was done, the Bootstrap step might need different imports.

**Suggestions:**
- Relax the dependency to `depends_on: [07-03]` with a note that tool handlers for governance/explainability tools are wired in 07-07 after 07-04/07-05 complete. This allows parallel work.
- Add a `"type": "module"` verification step for the new package

---

## 07-07 — Full MCP Handler Wiring

**Summary:** Wires all tool handlers as thin adapters over `@aura/core`. The inventory ledger is a good visibility mechanism for 07-08.

**Strengths:**
- Handlers delegate only to `@aura/core` (matches D-08)
- Preserves Rust output media decisions (text-vs-JSON)
- Deterministic error mapping for unsupported paths
- Inventory ledger visible to 07-08

**Concerns:**
- **MEDIUM:** The `maintain` tool doesn't exist in Rust's MCP. The plan needs to define the MCP response shape for `maintain`. Should it return the full `MaintenanceReport` as JSON text? The plan says "follow Rust closely" but there's no Rust reference for this tool's MCP shape.
- **MEDIUM:** The plan says to test "every advertised tool can be called and returns either success or the standardized explicit unsupported response." Without comparing to Rust (that's 07-08), these tests only verify the tools don't crash — not that they produce Rust-equivalent outputs. A tool could return a "success" with completely wrong data.
- **LOW:** `recall` and `recall_structured` in Rust's MCP return `Content::text(json_string)`. The plan should explicitly test that the TS response is `Content::text(...)` with a JSON string body, not structured content.

**Suggestions:**
- Define the `maintain` tool's MCP response shape explicitly: recommend `MaintenanceReport` serialized as JSON text
- Add at least one golden-file test per tool family that compares against a saved Rust MCP response for a known fixture

---

## 07-08 — MCP Parity Harness + Phase Closeout

**Summary:** The final verification plan. Black-box Rust-vs-TS comparison, explicit normalization, and closeout artifacts. The binary discovery/skip contract is necessary for environments without Rust.

**Strengths:**
- Explicit normalization pass (JSON key sorting, float/time normalization, whitespace)
- Binary discovery contract with build/skip states
- Final inventory accounting
- Closeout updates for ROADMAP.md and STATE.md

**Concerns:**
- **MEDIUM:** Rust's `aura-mcp` binary is feature-gated: `#[cfg(feature = "mcp")]`. The build command must be `cargo build --bin aura-mcp --features mcp`. The plan doesn't mention the feature flag.
- **MEDIUM:** The `maintain` tool has no Rust counterpart. The harness needs a documented exception for tools that are TS-only.
- **MEDIUM:** If Rust can't be built (no Cargo, wrong platform), the entire parity verification collapses to "skipped." The plan should specify minimum fixture-based tests that can run without Rust — comparing TS MCP output against saved golden files from a previous Rust run.
- **LOW:** The recall_parity directory already exists with `brain.aura`, `brain.cog`, `brain.snap`, `index/`, `temporal.bin`. The plan should reference whether these are reused or new MCP-specific fixtures are created.

**Suggestions:**
- Add `--features mcp` to the Rust build command
- Define golden-file fallback tests for environments without Rust
- Reference the existing `recall_parity/` directory and decide reuse vs new fixtures

---

## Cross-Cutting Concerns

### 1. Aura Instance State Management (HIGH)

The Rust `Aura` struct holds in-memory state: `correction_log: Vec<CorrectionLogEntry>`, maintenance trend history, reflection history. The TS `Aura` class currently has only `brainDir: string` and `records: BrainAuraRecord[]`. Plans 07-02, 07-04, and 07-05 all need to add state fields to `Aura`. Without coordination, they'll produce merge conflicts or inconsistent state management. No plan mentions adding instance fields to the `Aura` class.

**Suggestion:** Plan 07-02 should explicitly add the maintenance history state fields to `Aura` (trend history, reflection history). Plan 07-05 should add correction log state. Document the state ownership in each plan's implementation notes.

### 2. SDR Shim Cascading Failure (HIGH)

Plan 07-02's `SDRInterpreter` as "empty/identity" shim is the single biggest risk to phase success. In Rust's maintenance cycle, SDR vectors are computed from record content in `build_sdr_lookup`, then consumed by belief, concept, and causal discovery. If SDR is empty:
- Concept discovery finds no seeds (no meaningful SDR clusters)
- Causal discovery finds no patterns (no SDR-based correlation)
- Policy discovery finds no hints (depends on causal output)
- `cross_namespace_digest` shows empty concepts and zero overlap
- `memory_health` shows no real health indicators
- `insights` detects nothing

The entire governance/explainability stack would operate on empty data. All tests would pass (deterministic zeros are correct), but real parity would be zero.

**Suggestion:** The SDR shim must produce at minimum a token-level sparse vector from record content. A simple word-level hash-to-sparse-vector is sufficient for maintenance bookkeeping and would enable non-empty discovery. Mark it `NON-PARITY IMPLEMENTATION:` to document that the encoding differs from Rust's SDR.

### 3. Deep Serial Dependency Chain (MEDIUM)

The wave structure is strictly serial: Wave 1 -> Wave 2 -> Wave 3 -> Wave 4. Within waves, some plans could be parallelized:
- 07-06 (MCP scaffold) only needs 07-03's operational surfaces, not 07-04/07-05. The governance/explainability tool handlers can be added in 07-07.
- 07-04 and 07-05 could be partially parallelized: 07-04's read models and 07-05's correction write paths are independent; only the backfill step needs sequencing.

**Suggestion:** Relax 07-06's dependency to `[07-03]` and relax 07-05's dependency to `[07-01, 07-02, 07-03]` (removing 07-04). Add a cross-plan note that 07-05's correction data backfills 07-04's read models.

### 4. Missing Engine Contract Extensions (MEDIUM)

Plan 07-05 needs to mutate belief/causal/policy engine state (deprecate, invalidate, retract). The existing engine contracts (`BeliefEngine.Interface`, etc.) may not expose these mutation methods. Extending engine contracts is a cross-package change that should be scoped in Plan 07-01 or a dedicated contract-extension step.

**Suggestion:** Add engine contract method requirements to Plan 07-01's DTO checklist, or add a note in Plan 07-05 that it may need to extend engine contracts.

### 5. No Integration Test Between Waves (LOW)

The first end-to-end integration test of core facades happens at the MCP boundary in Plan 07-07. If core facades compose incorrectly (e.g., 07-04's `cross_namespace_digest` calling 07-02's maintenance data in the wrong format), the failure is discovered late.

**Suggestion:** Add a lightweight integration test step to Plan 07-04 (or 07-05) that instantiates Aura, runs maintenance, and calls the new facades in sequence.

---

## Risk Assessment: **MEDIUM-HIGH**

**Justification:** The plan structure is architecturally correct and the wave decomposition is logical. The two HIGH risks are:

1. **SDR shim quality (Plan 07-02):** If the SDR shim is too minimal, the entire maintenance -> governance -> explainability chain produces empty data. All tests pass but parity is vacuous. This is a single-point failure that affects 5 of 8 plans.

2. **Plan 07-05 scope:** The evidence bridge + correction write paths + 6 explainability surfaces is a mini-phase worth of work. If it stalls, Plans 07-06, 07-07, and 07-08 can't complete (they depend on it).

The phase can succeed if: (a) the SDR shim produces real (even if simplified) vectors, and (b) Plan 07-05 is either split or given explicit scope boundaries with a "degraded but complete" baseline for each surface.

---

## Consensus Summary

Single-reviewer cycle with `claude`. No cross-reviewer disagreement data is available in this cycle, so the summary records the highest-signal findings from this review.

### Agreed Strengths

- The 8-plan / 4-wave decomposition matches the real dependency chain and keeps MCP transport layered on top of `@aura/core`.
- Rust's in-memory correction-log behavior is now reflected in the review baseline instead of forcing unnecessary file persistence.
- The Mastra/Bun compatibility spike plus fallback to `@modelcontextprotocol/sdk` is a sound risk-control pattern for the transport layer.

### Agreed Concerns

- `07-02` still carries two unresolved HIGH risks: the SDR shim currently remains too weak for downstream discovery, and `TagTaxonomy`-dependent maintenance phases may remain stubbed without a concrete bounded implementation strategy.
- `07-03` still overpromises `search` and `consolidate` without locking whether they are implemented or explicitly unsupported when the required indexes do not exist.
- `07-05` still bundles a large recall evidence bridge, correction writers, and explainability surfaces into one plan, with missing engine-contract extension details.
- Cross-plan state ownership inside `Aura` is still implicit even though maintenance history and correction logs both need in-memory instance state to match Rust behavior.
- `07-08` still needs to encode the Rust `--features mcp` build path and a fallback verification strategy when the Rust binary cannot be built locally.

### Divergent Views

None in this cycle. Only the `claude` reviewer was invoked.
