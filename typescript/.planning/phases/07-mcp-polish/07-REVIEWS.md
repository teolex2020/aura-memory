---
phase: 7
reviewers: [claude]
reviewed_at: 2026-05-30T22:19:51.1409902+08:00
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

# Cross-AI Plan Review: Phase 07 - MCP + Polish

## Overall Assessment

The 8-plan, 4-wave decomposition is logically sound and matches the research recommendation. The wave ordering (shared DTOs -> maintenance debt -> core facade -> inspection facades -> explainability -> MCP scaffold -> handlers -> parity) respects real dependency chains. The plans are well-scoped to individual concerns, and each identifies concrete files, verification gates, and success criteria. The folded backlog items (999.1, 999.2) are correctly distributed across plans 01-03 rather than treated as a separate cleanup pass.

However, several plans defer critical design decisions to the executor. This is the GSD pattern, but in a phase this large, three specific risks warrant pre-execution mitigation: the 5 placeholder subsystems in 07-02, the explainability/correction chicken-and-egg in 07-04/07-05, and Mastra Bun/ESM compatibility as a single point of failure for Wave 3.

## 07-01 - MCP-facing Contract DTOs + Error Contract + Maintenance Artifact Stores

**Summary:** Lays the shared type foundation. Adds explainability, analytics/governance, correction, and maintenance artifact DTOs to `@aura/contract`, creates a typed unsupported error contract, and adds storage helpers for persisted trend/reflection data.

**Strengths:**
- Correctly identifies that shared DTOs must live in `@aura/contract`, not `@aura/core` - this prevents later plans from duplicating shapes
- The unsupported error contract in its own file (per D-26) is explicitly called out
- Reuses `CogJsonSnapshotFile` for storage helpers rather than inventing one-off serializers
- Verification gates are concrete: typecheck, package-targeted tests, and a grep for manifest surface coverage

**Concerns:**
- **MEDIUM**: The plan says "enumerate and place the following families" but doesn't lock which specific Rust types from `api_groups.rs` need TS DTOs. The executor will need to reverse-engineer from `RecallExplanation`, `RecallExplanationItem`, `ProvenanceChain`, `ExplainabilityBundle`, `CrossNamespaceDigest`, `CrossNamespaceDigestOptions`, `NamespaceGovernanceStatus`, `MemoryHealthDigest`, `CorrectionLogEntry`, `CorrectionReviewCandidate`, `ContradictionReviewCandidate`, `SuggestedCorrection` - none of which are listed by name. A one-line reference table would make this plan self-contained.
- **LOW**: "If Rust research shows correction log or other phase-critical MCP read models persist on disk" - this conditional is too vague. The Rust `correction_log` in `api_groups.rs` returns `Vec<CorrectionLogEntry>` from an in-memory vec, not a file. The plan should commit to either adding file persistence or explicitly noting it's in-memory only for now.
- **LOW**: The existing `MaintenanceTrendSnapshot` and `ReflectionSummary` types already exist in `@aura/contract` (`Maintenance.ts` and `EpistemicInspection.ts`). The plan should clarify whether new DTOs supplement or replace these.

**Suggestions:**
- Add a concrete DTO checklist in the plan body referencing specific Rust types from `api_groups.rs` lines 30-443
- Clarify the persistence question for correction log: if Rust keeps it in-memory, the TS storage helper scope can be narrowed accordingly

**Risk: LOW** - This is a type-definition and helper-creation plan. Low algorithmic risk. The executor knows where to look.

## 07-02 - MaintenanceService Parity Completion + Persisted Trend/Reflection Outputs

**Summary:** Closes the remaining D-07 maintenance debt. Classifies the 5 `unknown` placeholder subsystems, replaces them with real imports or typed shims, implements the stubbed algorithm sections needed for MCP-facing surfaces, and persists trend/reflection outputs.

**Strengths:**
- The "classification pass before implementation" is the right risk-management strategy for the 5 placeholder subsystems
- Explicitly constrains each subsystem to one of three states: implemented, typed shim, or escalated gap - prevents silent ambiguity
- The SUMMARY.md output committing the executor to a disposition table creates accountability
- Correctly targets only the behaviors that feed Phase 7 MCP surfaces, not all Rust maintenance subsystems

**Concerns:**
- **HIGH**: The 5 placeholder subsystems (`SDRInterpreter`, `TagTaxonomy`, `NGramIndex`, `CognitiveStore`, `BackgroundBrain`) are not minor. `SDRInterpreter` in Rust wraps a full SDR encoding/decoding pipeline. `CognitiveStore` is a file-backed append-only store. `BackgroundBrain` is a 500+ line module. If 3+ of these end up as "blocked," Wave 1 stalls and Waves 2-4 can't proceed on the `maintain` path. The plan should define what "typed shim with bounded behavior" means concretely - e.g., "SDRInterpreter shim returns empty SDR vectors and is annotated NON-PARITY" - so the executor has a clear ceiling.
- **MEDIUM**: The Rust `run_initial_phases` calls real functions (`fix_memory_levels`, `guarded_reflect`, `update_epistemic_state`, `insights::detect_all`). The TS stubs return zeroed results. Implementing even 2 of these (decay + reflect) touches record mutation, level computation, and tag taxonomy - each a significant sub-task. The plan doesn't prioritize which stubs matter most for downstream MCP surfaces.
- **MEDIUM**: `runPostDiscoveryPhases` in Rust calls `consolidation::consolidate`, `discover_cross_connections`, `check_scheduled_tasks`, and `archive_old_records`. The plan says "implement only behaviors that feed Phase 7 MCP surfaces" but doesn't specify which of these feed into `insights`, `maintain`, or `memory_health`.
- **LOW**: The plan says "persist MaintenanceTrendSnapshot[] and ReflectionSummary[] using the new storage helpers" but the Rust implementation keeps these in-memory (`Vec<MaintenanceTrendSnapshot>` on `Aura`). If the TS side persists them, that's a divergence from Rust that should be explicitly marked as intentional.

**Suggestions:**
- Define a concrete "typed shim" example for SDRInterpreter so the executor has a template
- Prioritize the stub completion: decay + reflect (feed `insights` + `memory_health`) before consolidation + cross-connections (feed `consolidate` + `cross_namespace_digest`)
- Decide whether persistence of trend/reflection is TS-only (intentional divergence) or should match Rust's in-memory approach

**Risk: HIGH** - This is the plan most likely to discover phase-blocking gaps. The classification pass is a gate; if it surfaces 3+ blocked subsystems, the wave structure needs renegotiation.

## 07-03 - Core Facade Alignment + Backlog 999.1/999.2 Structural Fixes

**Summary:** Adds missing core surfaces (`store_code`, `store_decision`, `search`, `insights`, `maintain`, `consolidate`), replaces `Effect.die` defects with typed failures, fixes `runMaintenance()` record path, and cleans up Policy surface adapter debt.

**Strengths:**
- Directly maps to SPEC requirements 4 (999.1) and 5 (999.2) with verifiable grep checks
- The Policy surface cleanup task correctly identifies ripple effects into `EpistemicRuntime` (which has its own `toSurfacePolicyHint` adapter that duplicates `policyEngineFromState` logic)
- The xxhash NON-PARITY centralization is a pragmatic debt-reduction task that doesn't overreach

**Concerns:**
- **MEDIUM**: `runMaintenance()` currently imports `BrainAuraRecord` and passes `this.records` (typed `BrainAuraRecord[]`) nowhere directly, but loads `records` via `loadCognitiveRecords(dir)` inside the Effect.gen block. The actual `BrainAuraRecord` risk is in the constructor storing `BrainAuraRecord[]` which is never directly used in maintenance - the maintenance path uses `loadCognitiveRecords`. The plan should verify whether the mismatch is real or just a type-level concern before prescribing a fix.
- **MEDIUM**: The Policy surface refactoring task says "consume contract-aligned state directly or through an explicit, non-deprecated adapter." The existing `EpistemicRuntime.getSurfacedPolicyHints()` already constructs a local adapter from contract `PolicyHint` to surface `PolicyHint` via `toSurfacePolicyHint()`. Eliminating the `packages/policy/src/Surface.ts` adapter means either: (a) rewriting surface functions to consume contract types directly, or (b) moving the adapter. The concept `Surface.ts` already consumes contract types directly (`computeSurfaceConcepts` takes `ConceptCandidate[]`) - this is the target pattern. The plan should explicitly reference concept/Surface.ts as the template.
- **LOW**: `store_code` and `store_decision` are thin wrappers over `store` in Rust. The plan correctly groups them as "add core helper" tasks but they could be simple enough to inline rather than create separate facade methods.

**Suggestions:**
- Verify the `BrainAuraRecord` risk is real before fixing - grep for actual type-mismatch usage in the maintenance path
- Reference `packages/concept/src/Surface.ts` as the target pattern for the Policy surface refactoring
- Consider inlining `store_code`/`store_decision` as `Aura` methods that delegate to `store` with preset parameters, matching the Rust pattern exactly

**Risk: MEDIUM** - Depends on 07-02's classification outcomes. The Policy refactoring has known scope but unknown ripple into `EpistemicRuntime`.

## 07-04 - Governance/Inspection/Read-Model Facades

**Summary:** Builds core facades for `belief_instability`, `policy_lifecycle`, `namespace_governance_status`, `memory_health`, and `cross_namespace_digest`, reusing `EpistemicRuntime` primitives and persisted maintenance data.

**Strengths:**
- The per-surface input map requirement is an excellent design discipline - it forces the executor to think about data dependencies before coding
- Correctly delegates to `EpistemicRuntime` for already-implemented primitives (instability summary, policy lifecycle, contradiction clusters, pressure reports)
- Explicitly declares independence from 07-05: "this plan must stand on already-persisted or already-derived read models" - prevents circular dependency
- `cross_namespace_digest` implementation with Rust option handling and dimension flags is the right level of specificity

**Concerns:**
- **HIGH**: `memory_health` in Rust (`MemoryHealthDigest`) aggregates corrections + instability + policy pressure + maintenance trends + startup recovery warnings. The plan says "do not require any write path from 07-05" but correction data won't exist until 07-05 adds the correction write path. This means `memory_health` will ship with zero correction data in Wave 2 and only become complete after Wave 2 finishes. The plan should explicitly acknowledge this as a known two-phase delivery: Wave 2 delivers the facade structure with zeroed correction fields, Wave 2 completion (post-07-05) backfills them.
- **MEDIUM**: `namespace_governance_status` in Rust returns `Vec<NamespaceGovernanceStatus>` which includes `correction_count`, `suggested_corrections_count`, and `latest_maintenance_cycle`. Without 07-05's correction data and without running actual maintenance cycles, these fields will be empty/zero. The plan should define acceptable baseline values for Wave 2 delivery.
- **LOW**: `cross_namespace_digest` in Rust supports `include_dimensions` flags (`concepts,tags,structural,causal,belief_states,corrections`). The TS side needs the `apply_cross_namespace_dimension_flags` equivalent. This is a small but precise implementation detail that matters for parity.

**Suggestions:**
- Add a "known Wave 2 limitation" section documenting which fields will be zeroed until 07-05 completes
- Acknowledge the two-phase delivery for `memory_health` explicitly
- Add the dimension flags helper to the task list for `cross_namespace_digest`

**Risk: MEDIUM** - The facade structures are well-understood, but the data dependency on 07-05 for correction fields creates a known incompleteness that must be documented, not discovered during parity testing.

## 07-05 - Explainability + Correction Facades

**Summary:** Implements the most complex missing surfaces: recall evidence bridge, correction write/read paths, and the explainability DTO construction for `explain_record`, `explain_recall`, and `explainability_bundle`.

**Strengths:**
- Correctly identifies that explainability needs a "recall evidence bridge" - intermediate provenance data, not just final scored outputs
- The ordering is right: correction write path first, then read models, then explainability on top
- Explicitly requires correction mutations (`deprecate_belief_with_reason`, `invalidate_causal_pattern_with_reason`, `retract_policy_hint_with_reason`) - this is the right scope
- The SUMMARY.md requirement to list "fully implemented vs deliberately unsupported residuals" creates accountability

**Concerns:**
- **HIGH**: The "recall evidence bridge" is a novel abstraction not present in Rust. In Rust, `explain_record` directly queries the belief engine for the belief associated with a record, then builds a `RecallExplanationItem` from the belief's hypotheses, patterns, and hints. The TS side currently has `recallRecordsEffect` which returns scored records but loses the intermediate belief/hypothesis/pattern/hint mapping. Building this bridge means reconstructing the belief->record, concept->record, causal->record, and policy->record relationships that the TS recall pipeline currently discards. This is a significant implementation task, not a small adapter.
- **HIGH**: The correction persistence question. Rust keeps correction log in-memory on `Aura` (a `Vec<CorrectionLogEntry>`). If TS needs to persist corrections for parity tests, it needs either: (a) the same in-memory approach (simpler, matches Rust), or (b) a file-backed approach (diverges from Rust). The plan says "if persistence/storage location must match Rust, verify it before coding" - but the Rust side is in-memory, so "matching" means in-memory. The plan should commit to this decision.
- **MEDIUM**: `explainability_bundle` in Rust wraps `explain_record` + `provenance_chain` + correction excerpts + instability summary + maintenance trend. Building this requires all of 07-04's outputs plus correction data. If 07-04 ships with zeroed correction fields, the bundle will be incomplete. The plan should define what a "valid but incomplete" bundle looks like.
- **MEDIUM**: The belief/causal/policy engine packages (`packages/belief/src/*`, `packages/causal/src/*`, `packages/policy/src/*`) are listed in `files_modified` but the plan body doesn't specify what changes they need. Adding correction mutations (`deprecate_belief_with_reason` etc.) likely needs engine-level state changes. The plan should enumerate which engine methods need to be added.
- **LOW**: The existing `EpistemicRuntime.getContradictionClusters()` already computes contradiction clusters from belief engine state. The `contradiction_review_queue` in Rust is a prioritization layer on top of clusters. The plan should note this reuse opportunity.

**Suggestions:**
- Scope the "recall evidence bridge" more precisely: it needs to capture (record_id -> belief_id -> hypotheses -> concept_ids -> causal_pattern_ids -> policy_hint_ids) mapping that the recall pipeline currently discards
- Commit to in-memory correction log matching Rust, avoiding unnecessary file persistence
- Enumerate the specific engine-level methods needed for correction mutations
- Note the `EpistemicRuntime.getContradictionClusters()` reuse for `contradiction_review_queue`

**Risk: HIGH** - This is the most architecturally ambitious plan. The recall evidence bridge is a hidden subsystem that the plan's current description understates. If the bridge is complex, explainability tools will be shallow.

## 07-06 - @aura/mcp Package Scaffold

**Summary:** Creates the `@aura/mcp` workspace package with Mastra dependencies, env-based startup, tool schema declarations, inventory registration, and a stdio smoke test.

**Strengths:**
- The "minimal compatibility spike before full scaffold" is exactly right for Bun/ESM + Mastra integration
- Explicitly calls out that Mastra docs must be re-opened during execution (per D-05 in RESEARCH)
- The fail-fast initialization (brain path not found -> exit) correctly matches Rust behavior
- The "documented fallback" for Bun/ESM incompatibility shows pragmatic risk management

**Concerns:**
- **HIGH**: Mastra's MCP server support is relatively new. The docs at `mastra.ai/en/reference/tools/mcp-server` may not cover Bun/ESM. Mastra internally uses `@modelcontextprotocol/sdk` which has Node.js-specific dependencies (stdio transport, child_process). If the Bun/ESM spike fails, the fallback options are: (a) use `@modelcontextprotocol/sdk` directly without Mastra, (b) write a minimal stdio JSON-RPC handler, or (c) use a Node.js subprocess. The plan should pre-define which fallback is acceptable.
- **MEDIUM**: The plan lists `packages/core/src/*` in `files_modified` but this plan shouldn't modify core - it should only consume core. If core changes are needed, they belong in 07-03/07-04/07-05.
- **MEDIUM**: Tool schema definitions for Mastra typically use Zod. The workspace doesn't have Zod yet. The plan should acknowledge the new dependency and ensure it's added at the workspace level.
- **LOW**: The plan says "declare the entire Phase 7 tool inventory in one place" but the actual inventory is 21 tools. A single-file registration could become unwieldy. Consider suggesting a split (e.g., by family: memory tools, inspection tools, governance tools).

**Suggestions:**
- Pre-define the Bun/ESM fallback strategy: "If Mastra MCP server is incompatible with Bun stdio, fall back to @modelcontextprotocol/sdk directly with a handwritten tool router"
- Remove `packages/core/src/*` from files_modified - this plan consumes core, doesn't modify it
- Acknowledge the Zod dependency explicitly
- Consider tool registration file split by family

**Risk: MEDIUM** - The Bun/ESM + Mastra compatibility is the single point of failure for Wave 3. The spike-first approach mitigates this, but the fallback strategy needs to be locked before execution begins.

## 07-07 - Full MCP Handler Wiring

**Summary:** Implements all tool handlers delegating to `@aura/core`, with Rust-shaped text payloads, deterministic error mapping, and invocation coverage tests.

**Strengths:**
- Correct emphasis on thin handlers - "delegating only to @aura/core surfaces"
- The "single inventory ledger" in tests/summary creates a machine-readable status that feeds directly into 07-08
- Text-vs-JSON media type decisions are explicitly called out as following Rust

**Concerns:**
- **MEDIUM**: The plan depends on all core facades being complete. If 07-04 ships `memory_health` with zeroed correction fields and 07-05 ships `explainability_bundle` with a partial evidence bridge, handlers for those tools will return data that passes the "invocable" bar but fails the "parity" bar. The plan should distinguish between "invocable" (returns success) and "parity-grade" (matches Rust shape), since 07-08 tests the latter.
- **MEDIUM**: The Rust MCP server uses `rmcp` (a Rust MCP framework), not Mastra. The `Content::text(...)` vs structured content decision is framework-specific. TS Mastra may have different content type defaults. The plan should include a content-type verification step.
- **LOW**: 21 tools with individual handler implementations is a lot of boilerplate. The plan should suggest handler generation patterns (e.g., a `createTextTool` helper) to reduce repetition.

**Suggestions:**
- Add a distinction between "invocable" (Wave 3 gate) and "parity-grade" (Wave 4 gate) in the success criteria
- Include a Mastra content-type verification step
- Suggest a handler factory pattern to reduce boilerplate

**Risk: MEDIUM** - This is an integration plan. Its success depends entirely on the completeness of Waves 1-2. If core facades are solid, this is straightforward. If not, this plan becomes a bug-farm.

## 07-08 - Rust-vs-TS MCP Parity Harness + Phase Closeout

**Summary:** Builds the automated black-box comparison harness, runs family-level E2E tests, produces the final implemented-vs-unsupported table, and closes out Phase 7.

**Strengths:**
- The Rust binary discovery/skip contract is well-designed - it prevents "parity passed" when the Rust side was never actually running
- Family-level grouping (write, retrieval, maintenance/inspection, explainability/governance) matches the SPEC requirement
- Sequential state accumulation as a feature (not a bug) for discovering real deviations is explicitly embraced per D-34
- Final closeout updating STATE.md and ROADMAP.md is properly scoped

**Concerns:**
- **MEDIUM**: The Rust `aura-mcp` binary requires a Cargo build. On Windows, this means `cargo build --bin aura-mcp`. The plan acknowledges binary discovery but doesn't address: (a) whether the harness should attempt `cargo build` automatically, (b) where the binary is expected (`../target/release/aura-mcp.exe` on Windows), or (c) what happens when Cargo isn't installed. The skip contract should include a pre-flight check script.
- **MEDIUM**: The normalization rules from D-21 allow ignoring "JSON whitespace, object key order, safe time/float formatting differences" but prohibit ignoring "media type changes, missing/extra fields, core text structure changes." A robust comparison needs a JSON normalization step (sort keys, normalize floats, strip whitespace) followed by a structural diff. The plan should reference or define this normalization.
- **LOW**: The recall_parity directory already has `brain.aura`, `brain.cog`, `brain.snap`, `index/`, `temporal.bin`. These are library-level fixtures, not MCP fixtures. The plan correctly says "MCP-specific fixture first" but should note whether existing fixtures are reusable as a starting point.
- **LOW**: The final closeout says "mark the folded backlog work as closed through Phase 7 execution rather than separate backlog items." This should include removing or updating any remaining references in `.planning/todos/pending/`.

**Suggestions:**
- Add a pre-flight check script for Rust binary discovery: check for `cargo`, attempt build, report skip reason
- Define the JSON normalization + structural diff approach explicitly
- Note whether existing recall_parity fixtures can seed MCP fixtures
- Explicitly list the closeout artifacts that must be updated (STATE.md, ROADMAP.md, todos/pending/, phase verification artifact)

**Risk: MEDIUM** - This is a verification plan. Its risk is proportional to the accumulated quality of Waves 1-3. The Rust binary availability on Windows is the main environmental risk.

## Risk Assessment

**Overall: MEDIUM-HIGH**

The plan structure is sound, but three intersecting risks could cascade:

1. **07-02's placeholder subsystem classification** - if 3+ of the 5 subsystems are blocked, the entire maintenance path in Waves 1-2 produces skeleton data, and governance/health/explainability tools in Waves 2-3 are built on empty read models. Mitigation: the classification pass must happen first, and results must be reviewed before proceeding to implementation.

2. **07-05's recall evidence bridge** - this is a hidden architectural dependency. If the bridge is expensive to build, explainability tools are shallow. Combined with (1), this could mean Wave 2 delivers facades that compile and pass tests but don't produce parity-grade data. Mitigation: scope the evidence bridge precisely before coding.

3. **07-06's Mastra Bun/ESM compatibility** - if this fails and the fallback isn't pre-agreed, Wave 3 stalls. Mitigation: the spike should be the very first execution step of 07-06, and the fallback strategy should be locked before the spike runs.

The wave dependency chain is correct but long (Wave 2 depends on Wave 1, Wave 3 on Wave 2, Wave 4 on Wave 3). A stall in Wave 1 blocks everything. The executor should consider whether any Wave 3 tasks (e.g., tool schema definitions, which don't need real core facades) can be done in parallel with Wave 2 to de-risk the schedule.

## Consensus Summary

Single-reviewer cycle with `claude`. No cross-reviewer disagreements are available in this cycle, so the summary records the highest-signal findings from this review.

### Agreed Strengths

- The 8-plan / 4-wave decomposition is coherent and tracks the real dependency graph.
- The plan keeps `@aura/mcp` as a transport layer and routes domain work through `@aura/core`.
- Backlog `999.1` / `999.2` closure is attached to concrete verification hooks instead of vague cleanup language.

### Agreed Concerns

- `07-02` still needs a concrete bounded typed-shim strategy for the five missing maintenance subsystems, or Wave 1 can stall.
- `07-04` and `07-05` still have an explicit correction-data dependency that must be acknowledged as staged delivery rather than discovered late in parity tests.
- `07-05` still understates the size of the recall evidence bridge and must lock the correction log storage model to the Rust in-memory behavior.
- `07-06` still needs a pre-decided Bun/ESM fallback if Mastra MCP bootstrap fails.
- `07-08` improved its Rust binary contract, but it still needs a concrete pre-flight/build path and diff-normalization rule in execution.

### Divergent Views

None in this cycle. Only the `claude` reviewer was invoked.
