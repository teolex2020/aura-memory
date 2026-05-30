---
phase: 7
reviewers: [claude]
reviewed_at: 2026-05-31T00:16:33.3389427+08:00
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

# Cross-AI Plan Review: Phase 07 — MCP + Polish

## Overall Assessment

These 8 plans collectively target the right things: shared DTOs first, maintenance debt second, core facades, then MCP transport, then parity. The wave structure is sound and the "contract-first, surface-next, transport-last" ordering prevents the MCP layer from becoming a second orchestration layer. However, several plans carry significant implementation risk from under-specified sub-problems (the recall evidence bridge in 07-05, the SDR/TagTaxonomy subsystem resolution in 07-02), and there is a dependency gap between 07-07 and the Wave 2 plans that would block execution in practice.

---

## 07-01 — Contract DTOs + Unsupported Errors + Storage Helpers

**Summary:** Establishes the shared type foundation. The exhaustive Rust-to-TS DTO checklist requirement is the right call — without it, later plans will silently diverge on field shapes. The decision to keep correction-log state in memory rather than inventing file persistence is correct and matches Rust.

### Strengths
- DTO checklist from `api_groups.rs` / `aura.rs` prevents later plans from inferring fields ad hoc
- Dimension flag vocabulary (`concepts`, `tags`, `structural`, `causal`, `belief_states`, `corrections`) is locked upfront, preventing local invention in 07-04
- Explicit `TaggedError`-based unsupported contract in its own file (decision D-26 compliance)
- Sensible: no `Date` objects in DTOs, reuses existing JSON snapshot helpers, no invented correction-log file persistence

### Concerns
- **MEDIUM** — "Copy the checklist from Rust source" is underspecified. `api_groups.rs` imports types from `aura.rs` which defines them elsewhere. The executor needs to trace the full type dependency graph, not just one file. A grep for `pub struct` / `pub type` across the Rust codebase would be more reliable.
- **MEDIUM** — "JSON-safe string/number shapes Rust emits today" — Rust uses `serde` with default serialization. The TS DTO field names must decide: camelCase (TS convention) vs snake_case (Rust/serde default). The plan is silent on this, but it affects every downstream consumer. Given D-03 (Rust alignment over TS style), this should be decided explicitly.
- **LOW** — `MaintenanceTrendSnapshot` and `ReflectionSummary` already exist in `@aura/contract`. The plan says "extend or reuse" but doesn't specify which fields are already present vs. missing from Rust. A diff-first approach would prevent accidental duplication.

### Suggestions
- Add a step to grep `pub struct` across `../src/aura.rs`, `../src/api_groups.rs`, `../src/background_brain.rs` to build the checklist rather than limiting to two files
- Decide and document the field-naming convention (snake_case for Rust parity per D-03, or camelCase with explicit serde rename annotations documented)
- Diff existing TS types against Rust struct fields before extending, to avoid duplicate shapes

---

## 07-02 — MaintenanceService Parity Completion

**Summary:** The most structurally important plan in Wave 1. The classification pass for the five placeholder subsystems is well-designed, and the typed-shim ceiling prevents sprawl. The real risk is that "bounded deterministic" shims may still produce empty/vacuous data that starves downstream governance surfaces.

### Strengths
- Five-subsystem classification pass with explicit three-state outcomes (implemented / typed shim / escalated) prevents silent half-measures
- Typed-shim ceiling is explicit and defensible: `SDRInterpreter` must produce non-empty SDR vectors for non-empty content, `TagTaxonomy` must actually classify, not pass through
- `Aura` runtime ownership of maintenance history is correctly specified as in-memory source of truth with optional derived disk cache
- Test requirements are concrete: `sdrVectorsComputed > 0`, at least one non-zero discovery signal

### Concerns
- **HIGH** — `SDRInterpreter` resolution: the plan says "import and use the existing `@aura/recall/SDRInterpreter`." Does this exist as an importable, standalone type? The current `MaintenanceService.ts` types it as `unknown`. If it doesn't exist as a clean import, this becomes a discovery-and-build task, not just an import swap.
- **HIGH** — `TagTaxonomy` bounded implementation: "must normalize/classify strongly enough for `fix_memory_levels` and `guarded_reflect`." These are Rust algorithms that operate on taxonomy output. The plan doesn't specify what "strongly enough" means — what specific taxonomy outputs do `fix_memory_levels` and `guarded_reflect` consume? Without that, the executor can't validate the shim.
- **MEDIUM** — `NGramIndex` "typed adapter over the current TS ngram implementation" — does the current TS codebase have an ngram implementation? The plan assumes it does. If it doesn't, this becomes another discovery task.
- **MEDIUM** — `BackgroundBrain` shim returns empty outputs for cross-connections and task reminders. These feed `cross_namespace_digest` and `consolidate`. If 07-02 leaves these empty, 07-04 and 07-05 need to handle the data gap explicitly.
- **LOW** — The plan says "stop once the Phase 7 downstream surfaces have real inputs." This is a judgment call that could lead to premature stopping if the executor is conservative.

### Suggestions
- Before implementation, verify that `@aura/recall` exports a usable `SDRInterpreter` type/instance. If not, add an explicit discovery task as the first step.
- Define the `TagTaxonomy` output contract: what does `fix_memory_levels` consume? What does `guarded_reflect` consume? Write these as interface assertions before coding the shim.
- Audit whether an ngram implementation exists in the TS codebase before assuming it does
- Add a cross-reference table in the summary mapping each `BackgroundBrain` empty output to which downstream plan/tool is affected

---

## 07-03 — Core Facade Alignment + Backlog Closures

**Summary:** Closes the structural debt and adds the basic operational surfaces. The `consolidate` disposition lock (implemented vs. deliberately unsupported, never stub success) and `search` ownership model are the right level of specificity. The Policy surface cleanup is correctly scoped.

### Strengths
- Three explicit `consolidate` outcomes with a forbidden state (dummy success) — this prevents the most common class of parity fraud
- `search` ownership is explicit: `Aura` owns an in-memory view, populated from cognitive-record load, refreshed on write, implementing full Rust filter semantics
- Policy surface cleanup is concrete: make helpers consume contract-aligned state directly, grep for zombie adapter in epistemic-runtime too
- `store_code` / `store_decision` are correctly scoped as thin composition wrappers over `store`

### Concerns
- **HIGH** — `runMaintenance()` record-path fix: the plan says "use the contract-compatible cognitive record path instead of any unsafe `BrainAuraRecord` assumptions" but doesn't specify the current problem. Looking at the code, `Aura.runMaintenance()` calls `loadCognitiveRecords(dir)` which already returns `Map<string, AuraRecord>`. The `BrainAuraRecord[]` is only in the constructor (`this.records`). The plan should specify whether the fix is: (a) stop storing `BrainAuraRecord[]` in the constructor, or (b) normalize at constructor time, or (c) something else.
- **MEDIUM** — `search` in-memory view refresh: "write operations must refresh the same in-memory view." This adds mutation side effects to `store`/`update`/`delete`/`connect`. The plan doesn't specify whether the view is a `Ref` (mutable) or an immutable replacement on each write. The former is simpler but the latter is more Effect-idiomatic.
- **MEDIUM** — `insights` surface decision: "must decide and document whether the MCP-facing TS method mirrors `Aura.stats()` / analytics summary, `Aura.insights()`, or both." This decision affects 07-07 handler wiring and should reference `mcp.rs` line 457-461 which calls `self.brain.stats()` — so Rust's `insights` tool maps to `Aura::stats()`. The plan should note this.
- **LOW** — xxhash NON-PARITY centralization: the plan says "centralize remaining xxhash-related NON-PARITY tracking markers" but doesn't say where. A single file or a grep pattern?

### Suggestions
- Specify the exact `BrainAuraRecord` → `AuraRecord` boundary fix with a code-level description (e.g., "normalize `BrainAuraRecord[]` to `Map<string, AuraRecord>` in the constructor and drop the `BrainAuraRecord[]` field")
- For `insights`, reference `mcp.rs:457` which shows Rust maps it to `Aura::stats()` — decide upfront rather than during implementation
- Specify the search view implementation approach (Ref vs. immutable replacement) to avoid executor ambiguity

---

## 07-04 — Governance/Inspection Read Models

**Summary:** Builds the read-model facades for operator/governance tools. The staged delivery concept (zero baseline in 07-04, backfill from 07-05) is a smart decoupling pattern. The main risk is that 07-02's maintenance outputs may not be rich enough to produce meaningful governance data.

### Strengths
- Per-surface input map requirement forces the executor to trace data dependencies before coding
- Staged delivery: zero/empty correction fields in 07-04 baseline, backfilled by 07-05 — clean separation of concerns
- `cross_namespace_digest` has explicit option handling, dimension flags, clamping, and output shape requirements
- Test requirement for non-vacuous multi-namespace fixture output is critical given the maintenance-data dependency

### Concerns
- **HIGH** — `cross_namespace_digest` algorithm: the Rust implementation computes namespace-level concept overlap, shared tags, structural overlap, and causal-signature overlap. The TS side may have none of these primitives. The plan says "verified Rust option handling" but doesn't acknowledge which algorithmic primitives need to be built vs. already exist.
- **HIGH** — Data dependency on 07-02: if 07-02's `BackgroundBrain` shim produces empty cross-connections, and `cross_namespace_digest` depends on structural overlap data, the digest will be vacuous. The plan's test requirement ("at least one non-zero digest dimension") may be hard to satisfy with the 07-02 shim ceiling.
- **MEDIUM** — `memory_health` field checklist from Rust: the plan says "copy the exact MemoryHealthDigest field checklist from Rust into the summary before implementation" but doesn't list what file to copy from. The struct is in `aura.rs`.
- **LOW** — `namespace_governance_status` "by namespace" grouping: the Rust implementation groups by namespace. The plan doesn't specify whether the TS implementation should pre-group or return flat with namespace field.

### Suggestions
- Audit which `cross_namespace_digest` algorithmic primitives exist in TS before implementation; flag missing ones as either "build now" or "zero baseline with explicit marker"
- Specify that `MemoryHealthDigest` fields should be copied from `../src/aura.rs` (the struct definition), not inferred from `api_groups.rs` (which only shows the facade signature)
- Consider whether 07-04 should have a soft dependency on 07-02 producing meaningful maintenance data, with an explicit "if maintenance is vacuous, governance is vacuous" acceptance clause

---

## 07-05 — Explainability + Correction Facades

**Summary:** The most ambitious and highest-risk plan. The recall evidence bridge is the linchpin — without it, explainability surfaces collapse to shallow scored-record wrappers. The three-pass structure is correct, but Pass A (evidence bridge) is under-specified for the architectural commitment it requires.

### Strengths
- Three-pass structure (evidence bridge → correction path → explainability surfaces) enforces the right build order
- Evidence bridge specification is conceptually right: per-contribution buckets (SDR, tags, ngram, graph, causal, trust, recency), not just final scores
- Correction write path explicitly enumerates the three engine mutations plus log append/list helpers
- In-memory correction log model correctly mirrors Rust
- Backfill requirement: rerun 07-04 governance tests with non-zero corrections

### Concerns
- **HIGH** — Recall evidence bridge implementation approach: the plan offers two options: (a) trace-capable helper that reruns collectors/walk stages, or (b) trace variant of the recall pipeline. Both are significant architectural changes to the recall pipeline. The plan doesn't assess which is feasible given the current recall code structure. If the recall pipeline doesn't expose intermediate state, this becomes a recall-pipeline refactor disguised as a Phase 7 task.
- **HIGH** — Engine mutation wiring: "The current TS contracts already expose most of the required engine mutations." This claim needs verification. Do `BeliefEngine.Interface`, `CausalEngine.Interface`, and `PolicyEngine.Interface` actually expose `deprecate_belief`, `invalidate_pattern`, `retract_hint`? The plan should not assume this.
- **MEDIUM** — `explainability_bundle` has 9 sub-members (explain_record, provenance_chain, record_corrections, belief_corrections, causal_corrections, policy_corrections, reflection_digest, related_reflection_findings, maintenance_trends). Many of these depend on correction data that won't exist until Pass B completes. The plan's Pass C must handle partial data availability.
- **MEDIUM** — This plan has the most files_modified of any plan (6 packages). The blast radius is large and the executor needs discipline to stay within scope.
- **LOW** — The plan says "do not attempt to infer provenance only from the already-collapsed final score array" but doesn't specify what to do if the recall pipeline can't be restructured. An explicit fallback decision is needed.

### Suggestions
- Before starting Pass A, audit the current recall pipeline for intermediate-state observability. If the pipeline is opaque, escalate the architectural decision (refactor pipeline vs. accept degraded explainability) before coding.
- Verify that `BeliefEngine.Interface`, `CausalEngine.Interface`, and `PolicyEngine.Interface` expose the three mutation methods. If not, add them to 07-03 scope or define typed shims here.
- Add an explicit acceptance clause: if the recall pipeline cannot be restructured for evidence capture, explainability surfaces must return typed unsupported rather than shallow success

---

## 07-06 — MCP Package Scaffold

**Summary:** Creates the `@aura/mcp` package with Mastra stdio server. The Bun/ESM compatibility spike with pre-decided fallback is the right approach. The plan is well-scoped as infrastructure-only.

### Strengths
- Compatibility spike before full scaffold — prevents wasted work if Mastra+Bun doesn't work
- Fallback to `@modelcontextprotocol/sdk` is pre-decided, not left for executor discovery
- Rust-aligned startup: env vars, default path, fail-fast
- Full inventory declared up front, even if handlers aren't wired yet

### Concerns
- **MEDIUM** — Dependency declared as only 07-03, but tool schema definitions for governance/explainability tools (from 07-04/07-05) will need to be added in 07-07. The split is intentional (07-06 = scaffold, 07-07 = wiring) but means the executor of 07-06 must leave handler stubs for tools whose core surfaces don't exist yet.
- **MEDIUM** — Mastra dependency addition: the plan says "add the minimum MCP-side dependencies." Mastra may pull in transitive dependencies that conflict with the workspace's strict TS/ESM setup. The spike should include `bun run typecheck` after dependency installation.
- **LOW** — No mention of the MCP server binary entry point. The Rust side has `aura-mcp.rs` as a separate binary. The TS side needs a similar entry script (e.g., `packages/mcp/src/bin.ts` or a `bin` field in package.json). The plan should specify where the stdio entry point lives.

### Suggestions
- Add a step to verify `bun run typecheck` passes after adding Mastra/zod dependencies, before writing any MCP code
- Specify the MCP server entry point location (e.g., `packages/mcp/src/server.ts` or `bin/server.ts`) and how it's invoked
- Note that handler stubs for 07-04/07-05 tools can be placeholder `unsupported` handlers until 07-07 wires them properly

---

## 07-07 — Full MCP Handler Wiring

**Summary:** Wires all tool handlers as thin adapters over `@aura/core`. The inventory ledger requirement is good discipline. But there's a dependency gap: the plan depends only on 07-06, yet needs governance/explainability core surfaces from 07-04 and 07-05.

### Strengths
- Every tool must be invocable and return either success or standardized unsupported — no silent omissions
- Rust output media decisions preserved (text content wrapping JSON, not structured payloads)
- Centralized MCP error mapping from core typed errors
- Inventory ledger marks each tool as implemented or explicitly unsupported for 07-08 consumption

### Concerns
- **HIGH** — Dependency gap: `depends_on: [07-06]` is incomplete. Governance handlers (`namespace_governance_status`, `memory_health`, `cross_namespace_digest`, `policy_lifecycle`, `belief_instability`) need core surfaces from 07-04. Explainability/correction handlers need surfaces from 07-05. If 07-07 starts before 07-04 and 07-05 complete, those handlers can only be unsupported stubs. The plan should either depend on `[07-04, 07-05, 07-06]` or explicitly document the partial-wiring strategy.
- **MEDIUM** — "Every declared Phase 7 tool" — but the declared inventory spans 20+ tools (from RESEARCH.md's Rust-to-TS mapping table). The plan doesn't reference the canonical tool list. A cross-reference to 07-SPEC.md's inventory would prevent drift.
- **LOW** — "Add deterministic MCP error mapping" — the plan doesn't specify what MCP error codes map to what core error types. The Rust side uses `McpError::internal_error`. The TS side should be similarly explicit.

### Suggestions
- Broaden `depends_on` to include `[07-04, 07-05]` or add an explicit note that governance/explainability handlers start as documented unsupported stubs until those plans deliver
- Cross-reference the exact tool inventory from 07-SPEC.md so the executor doesn't need to rediscover it
- Define the error mapping table: which core `TaggedError` types map to which MCP error codes

---

## 07-08 — MCP Parity Harness + Closeout

**Summary:** The final verification layer. The Rust binary build/discovery/skip contract is thorough, and the normalization pass rules are correctly aligned with D-21. The two special branches (TS-only tools, golden fallback) cover important edge cases.

### Strengths
- Rust binary contract: pre-flight cargo detection, build attempt, binary path discovery, explicit skip conditions
- Normalization pass is explicit: recursive JSON key sorting, float/time normalization, whitespace only where allowed, never field/media-type changes
- Two special verification branches: TS-only tools validated locally, golden payload fallback when Rust can't build
- Final closeout explicitly accounts for implemented vs. unsupported tools

### Concerns
- **MEDIUM** — Golden payload fallback: "compare TS MCP responses against saved Rust golden payloads generated from a previous verified run." This requires someone to have run the Rust MCP against the fixtures at least once. If the executor is on a machine without Rust, there are no golden payloads. The plan should specify how to generate or obtain them.
- **MEDIUM** — Windows-specific concerns: Rust `cargo build` on Windows may produce `.exe` binaries. The binary discovery path should account for platform-specific extensions. The plan mentions "Windows workspaces" but doesn't specify the path convention.
- **LOW** — The plan modifies `.planning/STATE.md` and `.planning/ROADMAP.md`. These are project-level tracking files. The closeout should be additive (marking Phase 7 complete) not destructive.
- **LOW** — `recall_parity/*` appears in files_modified. The existing `recall_parity/` directory contains `brain.aura`, `brain.cog`, `brain.snap`, `index/`, `temporal.bin`. The parity harness will need MCP-specific fixtures, not just the recall-parity fixtures. The plan should clarify whether it reuses or creates new fixture directories.

### Suggestions
- Add a golden-payload generation step: if Rust MCP can build, generate golden payloads from the Rust side as the first verification step, then compare TS against them
- Specify platform-specific binary discovery: `target/debug/aura-mcp` on Linux/macOS, `target/debug/aura-mcp.exe` on Windows
- Clarify fixture directory strategy: reuse `recall_parity/` as a base fixture set, create new `mcp_parity/` for MCP-specific multi-namespace fixtures

---

## Cross-Cutting Issues

### 1. Wave 1 Capacity Risk (HIGH)
07-01, 07-02, and 07-03 together represent: new DTO families (~15+ structs), 5 subsystem classifications with implementations or typed shims, MaintenanceService algorithm completion, new core surfaces (search, consolidate, store_code, store_decision), backlog closures, and Policy surface refactoring. This is 3 plans that each could be their own phase. If the executor underestimates any one, the wave stalls.

### 2. Dependency Graph Gap (HIGH)
07-07 depends on `[07-06]` only, but governance/explainability handlers need core surfaces from 07-04 and 07-05. Either the dependency should be broadened or the plan should document a partial-wiring strategy with explicit unsupported markers for not-yet-built surfaces.

### 3. Mastra + Bun/ESM Compatibility (MEDIUM)
The entire MCP layer assumes Mastra works under Bun with ESM. The plan has a fallback (`@modelcontextprotocol/sdk` direct wiring) but switching mid-phase would be costly. A compatibility spike should be the very first action in Wave 3, not part of 07-06's normal task flow.

### 4. Explainability Data Dependency Chain (MEDIUM)
explainability surfaces (07-05) depend on: recall evidence bridge (architectural change to recall pipeline) → correction data (new write paths) → maintenance data (07-02 completion) → engine state (existing). Any break in this chain makes explainability tools return vacuous or unsupported responses. The chain has 4 links, each in a different plan.

### 5. MCP Tool Inventory Canonical Source (LOW)
The tool inventory appears in RESEARCH.md (Rust-to-TS mapping table), 07-SPEC.md, and is referenced in 07-06/07-07/07-08. There's no single canonical inventory file that all plans can reference. If the inventory drifts between plans, the final closeout will have inconsistencies.

---

## Risk Assessment: **HIGH**

**Justification:** The phase scope is large (8 plans, 4 waves, 20+ MCP tools, 3 folded backlogs) and three plans carry implementation risks that could cascade:

1. **07-02's subsystem classification** — if `SDRInterpreter` or `TagTaxonomy` can't be resolved within the typed-shim ceiling, downstream governance/explainability data will be vacuous
2. **07-05's recall evidence bridge** — this is an architectural change to the recall pipeline disguised as a feature task; if the pipeline can't be restructured, explainability collapses to unsupported
3. **07-07's dependency gap** — governance/explainability handlers can't be wired until 07-04 and 07-05 deliver, but the plan doesn't declare that dependency

The wave structure is correct, but Wave 1 is overloaded and the Wave 2→3 handoff has a dependency gap. Mitigation: broaden 07-07's dependencies, run the Mastra compatibility spike before any Wave 3 code, and ensure 07-02's summary includes explicit go/no-go signals for each subsystem before 07-04/07-05 start.

---

## Consensus Summary

Single-reviewer cycle with `claude`. No cross-reviewer disagreement data is available in this cycle, so the summary captures the highest-signal findings from this run.

### Agreed Strengths

- The overall wave ordering is sound: contract/maintenance/core surfaces first, MCP transport later, parity last.
- `07-01`'s DTO-first approach and explicit unsupported-error contract reduce downstream shape drift.
- `07-06`'s Mastra compatibility spike plus fallback to `@modelcontextprotocol/sdk` is the right containment strategy for transport risk.
- `07-08`'s normalization and explicit Rust-binary/golden fallback rules are strong closeout mechanics.

### Agreed Concerns

- `07-02` still has the highest execution risk because `SDRInterpreter` and `TagTaxonomy` are not yet concretely resolved at the contract/implementation boundary.
- `07-05` remains a likely scope and architecture hotspot because the recall evidence bridge may require a recall-pipeline refactor, not just facade work.
- `07-07` has a real dependency bug: governance and explainability handlers depend on `07-04` and `07-05`, but the plan currently depends only on `07-06`.
- Wave 1 is overloaded enough that a miss in `07-02` or `07-03` can stall the entire phase.
- The MCP inventory still needs one canonical source to avoid drift between `07-SPEC.md`, `07-RESEARCH.md`, and the handler/parity plans.

### Divergent Views

None in this cycle. Only the `claude` reviewer was invoked.
