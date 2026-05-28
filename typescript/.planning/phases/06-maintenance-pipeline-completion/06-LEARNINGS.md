---
phase: 06
phase_name: "Maintenance Pipeline Completion"
project: "AuraSDK TypeScript"
generated: "2026-05-28"
counts:
  decisions: 7
  lessons: 5
  patterns: 5
  surprises: 4
missing_artifacts: []
---

# Phase 6 Learnings: Maintenance Pipeline Completion

## Decisions

### Contract type files isolated per engine domain
CausalTypes.ts and PolicyTypes.ts are created as dedicated files in packages/contract/src/, following the existing ConceptTypes.ts and BeliefTypes.ts pattern. Each file defines a four-part type structure: state enum (CausalState/PolicyState), data type (CausalPattern/PolicyHint), state snapshot (CausalEngineState/PolicyEngineState), and cycle report (CausalReport/PolicyReport).

**Rationale:** Contract types are consumed by contract interfaces (Causal.ts, Policy.ts), store implementations, and engine packages. Isolating them in dedicated files prevents circular imports and provides a single source of truth per domain. Files must be at least 50 lines (Causal) and 40 lines (Policy) with JSDoc comments in Chinese+English.

**Source:** 06-01-PLAN.md Task 1 action

---

### Typed engine interfaces replace unknown types
CausalEngineImpl and PolicyEngineImpl signatures change from generic `unknown` parameters to typed signatures: `discover(ConceptEngineState, ReadonlyMap<string, AuraRecord>, SdrLookup) => Effect.Effect<CausalReport>`. Store files similarly change from `save(engine: unknown)` to `save(engine: CausalEngineState)`.

**Rationale:** All five Phase 5 engine packages used `unknown` as a placeholder. Phase 6 replaces these with concrete types now that CausalTypes.ts and PolicyTypes.ts exist. Type safety cascades from contract through stores to engine implementations.

**Source:** 06-01-PLAN.md Task 2, 06-01-PLAN.md Task 3

---

### TDD for engine implementation plans
Plans 06-02 (CausalEngine) and 06-03 (PolicyEngine) follow strict TDD: RED phase writes failing tests first, GREEN phase implements to pass. Each requires 2-3 commits with the RED commit preceding GREEN.

**Rationale:** Both engines have well-defined behavioral specs from PROJECTION.md with clear input/output boundaries. The TDD gate ensures tests exist before implementation and provides deterministic verification criteria. Both produced 6/6 passing tests per plan.

**Source:** 06-02-PLAN.md (type: tdd), 06-03-PLAN.md (type: tdd)

---

### SIMPLE implementation bounded in scope
CausalEngine uses basic co-occurrence scoring (shared record_ids between concept pairs) with deterministic string hash IDs. PolicyEngine extracts hints from stable patterns with threshold gating (confidence > 0.7 -> Stable). BoundedReranker uses inverse-position boost without record access. RecallFinalizer uses in-memory activation tracking.

**Rationale:** Getting the pipeline working end-to-end is the primary goal. Algorithm sophistication is explicitly deferred (marked SIMPLE IMPLEMENTATION). Bounded scope enabled 31/31 truths verified in a single pass with 23 tests passing.

**Source:** 06-02-PLAN.md (SIMPLE IMPLEMENTATION), 06-04-PLAN.md (SIMPL E IMPLEMENTATION)

---

### EpistemicRuntime.maintain as pure orchestration
EpistemicRuntimeImpl.maintain() chains engine calls sequentially (Belief -> Concept -> Causal -> Policy) using `Effect.service()` to obtain engines from the context and `yield*` each engine's method. It does not mutate intermediate data -- only collects sub-reports into EpistemicReport.

**Rationale:** Separating orchestration from implementation keeps the runtime layer thin and testable with mock engines. Each individual engine owns its own state mutation. The pipeline is inherently sequential because each engine depends on the previous engine's state.

**Source:** 06-05-PLAN.md Task 1, 06-05-SUMMARY.md

---

### BoundedReranker and RecallFinalizer added as optional services
Both services were already wired in the recall Pipeline.ts via `serviceOption()` but had no implementations. Plan 06-04 creates implementations and registers them in DefaultLayer via `Layer.mergeAll()` alongside the existing 11 services.

**Rationale:** The pipeline could already work without these services (optional pattern). Adding implementations completes the optional feature without changing the pipeline architecture. Callers can override or omit them.

**Source:** 06-04-PLAN.md (objective), 06-05-PLAN.md Task 2

---

### RecallFinalizer tracks activations in-memory only
The SIMPLE implementation maintains a `Map<string, number>` in memory with no persistence across restarts. Session tracking uses a `Set<string>`. A getActivationCount() accessor is provided for testing.

**Rationale:** A FULL implementation would write activation counts through to CognitiveStoreFile. In-memory tracking is sufficient to demonstrate finalization behavior without introducing persistent state dependencies. The threat model accepts this as ephemeral state.

**Source:** 06-04-PLAN.md Task 2 (SIMPLE IMPLEMENTATION, threat model T-06-04)

---

## Lessons

### Following established engine patterns accelerates implementation
CausalEngine (06-02) and PolicyEngine (06-03) both explicitly reference the ConceptEngine implementation as their pattern. The `Effect.gen`, `serviceOption(EpistemicTrace)`, `Clock` service, and mutable `state` field pattern are copied directly. Both plans completed in a single wave with 6/6 tests passing.

**Context:** The ConceptEngine was implemented in Phase 5 with 200+ lines of production code. Both plans reference "Follow the exact ConceptEngine pattern" and provide partial code in the plan, reducing design overhead to near zero.

**Source:** 06-02-PLAN.md (objective, context), 06-03-PLAN.md (objective)

---

### Type cascade from contract through stores requires coordinated multi-file updates
When CausalTypes.ts and PolicyTypes.ts are introduced, the type change propagates through: contract interfaces -> store interfaces -> store file implementations -> engine stubs -> test files. 14 files across 5 packages (contract, storage, causal, policy, epistemic-runtime) must be modified in a single plan to maintain typecheck.

**Context:** Plan 06-01 explicitly lists all 14 affected files in its `files_modified` frontmatter and splits changes across 3 coordinated tasks. Without this explicit file inventory, it would be easy to miss a file and break typecheck.

**Source:** 06-01-PLAN.md (files_modified), 06-01-SUMMARY.md (what changed)

---

### Store files need load, save, and empty_engine aligned simultaneously
CausalStoreFile and PolicyStoreFile require changes to `save(engine: T)`, `load(): Effect<T>`, AND `empty_engine(): T` signatures simultaneously. The default state object returned by empty_engine must be a complete, valid instance of the typed state.

**Context:** Previously these files accepted/returned `unknown`. Changing to concrete types (CausalEngineState, PolicyEngineState) required the empty_engine() function to construct a properly structured default object with `version: 1 as const`, empty maps, and default enum values.

**Source:** 06-01-PLAN.md Task 3, 06-01-SUMMARY.md

---

### Inline execution is faster than subagent worktree execution for tightly coupled plans
Phase 6 was executed inline (not via gsd-executor subagents with worktree isolation) because worktree creation on Windows can be slow and error-prone. Total implementation time for 5 plans across 3 waves was approximately 20 minutes inline versus an estimated 2+ hours with subagent overhead.

**Context:** Plans 06-01 through 06-05 have sequential dependencies (each depends on the previous plan's output). The REFACTOR phase was skipped in some plans (06-02, 06-03) because the implementation was clean enough on first pass.

**Source:** 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-CONTEXT.md

---

### Deterministic ID generation avoids external dependencies
Both CausalEngine and PolicyEngine use a simple string hash function for deterministic IDs instead of importing xxhash-wasm. The prefix convention is `cp-` for causal patterns and `ph-` for policy hints.

**Context:** The ConceptEngine uses xxhash-wasm for IDs but the Phase 6 SIMPLE implementation explicitly chooses a lightweight string-to-hex hash to avoid the xxhash dependency. The plan notes this decision explicitly: "do NOT import xxhash-wasm as the CausalEngine."

**Source:** 06-02-PLAN.md (implementation note)

---

## Patterns

### Type definition triad: State enum + Data type + State snapshot + Cycle report
Each engine domain follows a four-part type structure: a string enum for state values, a readonly data type for individual items, a readonly state snapshot for persistence, and a readonly report type for per-cycle telemetry. All fields use `readonly` modifier.

**When to use:** New engine domains or sub-domains that need typed state management across the contract -> implementation -> persistence boundary. Follow ConceptTypes.ts as the canonical reference.

**Source:** 06-01-PLAN.md (Task 1), 06-VERIFICATION.md (Truths 1-2)

---

### Effect.gen + yield* for sequential engine composition
All engine discovery methods use Effect.gen with sequential yield* calls: obtain engine service from context, call engine method, trace events, return report. The generator body provides natural sequential flow without nested callbacks or pipe chains.

**When to use:** Any method that composes multiple Effect operations in sequence, especially when engine services need to be obtained from context before use.

**Source:** 06-02-PLAN.md (implementation), 06-05-PLAN.md (Task 1 action)

---

### serviceOption(EpistemicTrace) for optional observability
Engines emit start/end trace events using `yield* serviceOption(EpistemicTrace)` followed by `trace.event("name", { data })`. The serviceOption pattern makes tracing optional -- when no EpistemicTrace service is provided, events are silently skipped.

**When to use:** Cross-cutting observability that should not block the main computation path. Trace events enable debugging and monitoring without mandatory service provision.

**Source:** 06-02-PLAN.md (behavior), 06-03-PLAN.md (behavior)

---

### Layer.succeed for test service injection
Test files create mock services using `Layer.succeed(Tag, mockImpl)` and provide them via `Effect.provideService()`. The NoopTrace pattern (empty trace service) is used for tests that don't need observability verification.

**When to use:** Unit tests for Effect-based services that depend on engine Tags, stores, or observability services. The Layer abstraction decouples service creation from consumption.

**Source:** 06-02-PLAN.md (implementation), 06-03-PLAN.md (implementation)

---

### Optional service wiring via serviceOption in pipelines
Pipeline stages that add value but are not required for correctness use `serviceOption(Tag)` to wire optional services. The pipeline works whether or not services are registered, enabling gradual rollout.

**When to use:** Extensible pipelines where features may or may not be configured. Already established in Pipeline.ts (Phase 4) and extended in Phase 6 with BoundedReranker and RecallFinalizer.

**Source:** 06-04-PLAN.md (objective), 06-04-SUMMARY.md

---

## Surprises

### All 31 must-have truths verified in a single verification pass
The Phase 6 verification report shows 31/31 truths verified, zero gaps, zero anti-patterns found, and 23/23 tests passing across 5 test files. Behavioral spot-checks confirmed each engine's discover/invalidate/retract cycle.

**Impact:** The explicit must_haves per plan produced a verifiably complete phase output. Each plan's must_haves (truths + artifacts + key_links) provided verification criteria that mapped directly to real code changes.

**Source:** 06-VERIFICATION.md (score, observable truths, behavioral spot-checks)

---

### BoundedReranker and RecallFinalizer had zero implementation despite being wired in Pipeline.ts
The recall Pipeline.ts (from Phase 4) already contained `serviceOption(BoundedReranker)` and `serviceOption(RecallFinalizer)` calls at lines 167-176. Both services were silently no-ops -- the pipeline ran without errors but did nothing for reranking and finalization.

**Impact:** Two entire service implementations and 6 tests had to be created retroactively. The optional service pattern masked the missing implementations because no runtime error occurred.

**Source:** 06-04-PLAN.md (objective: "reranking is a no-op and finalization is silent")

---

### Type cascade required 14 simultaneous file changes from a single plan
Introducing typed CausalTypes and PolicyTypes required coordinated modifications to 7 contract/interface files, 2 engine stubs, 2 store wrappers, 2 store files, and 1 index export. Every file had to be updated in lockstep to maintain typecheck.

**Impact:** The plan design explicitly accounted for this by listing all files in must_haves and splitting work across 3 tightly coordinated tasks. Without this structure, cascade failures would be likely.

**Source:** 06-01-PLAN.md (files_modified: 14 files), 06-01-SUMMARY.md (what changed)

---

### Deterministic output verified for both Causal and Policy engines across replays
Both engines use deterministic ID generation (hash-based string IDs) and avoid any random or sampling behavior. Tests use `deepStrictEqual` to verify identical reports across separate calls with the same input.

**Impact:** Deterministic output enables reproducible debugging, snapshot testing, and regression detection. This is explicitly listed as must-have truths and verified independently for each engine. Determinism is a design requirement, not an accident.

**Source:** 06-VERIFICATION.md (Truths 20, 26), 06-02-PLAN.md (behavior), 06-03-PLAN.md (behavior)
