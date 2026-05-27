---
phase: "06"
phase_name: "Maintenance Pipeline Completion"
project: "Aura TypeScript Port"
generated: "2026-05-27"
counts:
  decisions: 4
  lessons: 3
  patterns: 3
  surprises: 2
missing_artifacts: []
---

# Phase 06 Learnings: Maintenance Pipeline Completion

## Decisions

### D1: Engine hierarchy — upstream state vs upstream engine reference
CausalEngine receives `ConceptEngineState` (via `.stats()`), not the full `ConceptEngineImpl`. Same for PolicyEngine receiving `CausalEngineState`. This avoids tight coupling between engine tiers while keeping each engine independently testable.

**Rationale:** Pitfall 3 in RESEARCH.md identified that passing the full engine creates coupling. ConceptEngine already takes `BeliefEngineImpl` because it needs `belief_for_record()` — Causal/Policy don't need similar methods on their upstream engines.
**Source:** 06-RESEARCH.md, 06-02-PLAN.md, 06-03-PLAN.md

### D2: Deterministic IDs via xxhash for engine output parity
All engine-generated IDs (causal patterns, policy hints) use xxhash-wasm `h64()` with sorted input concatenation, producing deterministic IDs across replays. Prefixes differentiate entity types: `cp-` for causal patterns, `ph-` for policy hints.

**Rationale:** Rust parity requires deterministic output. ConceptEngine already established the `deterministicId` pattern — Phase 6 extended it to the new engine tiers.
**Source:** 06-02-PLAN.md, 06-03-PLAN.md, 06-RESEARCH.md

### D3: SIMPLE implementation for initial engine algorithms
CausalEngine uses basic co-occurrence scoring (shared record_ids between concept pairs). PolicyEngine extracts hints from stable patterns with threshold gating (confidence > 0.7 → Stable). BoundedReranker uses inverse-position boost without record access. These are marked `SIMPLE IMPLEMENTATION` for future refinement.

**Rationale:** Get the pipeline working end-to-end before optimizing individual algorithms. Each SIMPLE marker includes the Rust reference for future parity alignment.
**Source:** 06-02-PLAN.md, 06-03-PLAN.md, 06-04-PLAN.md

### D4: Contract R-type widening for orchestrator services
EpistemicRuntime contract widened `maintain()` R from `EpistemicTrace` to `EpistemicTrace | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine`. Getter methods similarly widened. This reflects reality: the orchestrator needs all four engine services, and the caller provides them via Layer.

**Rationale:** TypeScript strict checking rejected `Effect<A, never, EpistemicTrace>` when the gen block yielded `Effect.service(BeliefEngine)` etc. The contract was too narrow.
**Source:** 06.1-01-SUMMARY.md, 06-05-PLAN.md

---

## Lessons

### L1: Effect.gen cannot use `await`
Using `await xxhash()` inside `Effect.gen(function* () {})` fails at build time — esbuild rejects top-level await in non-async functions. The fix: wrap in `yield* Effect.promise(() => getHasher())` or use module-level lazy init.

**Context:** CausalEngine initially used `const hasher = await xxhash()` inside the gen block. This passes vitest (which doesn't typecheck) but fails esbuild transform.
**Source:** 06-02-SUMMARY.md

### L2: `Effect.promise()` is the Effect-TS way to wrap async init
When a pure async function like `xxhash()` returns a hasher that needs lazy initialization, the pattern is: module-level lazy getter + `yield* Effect.promise(() => getHasher())` inside gen blocks. `Effect.dieMessage` doesn't exist in effect@4.0.0-beta.68 — use `Effect.die(new Error(...))` instead.

**Context:** Discovered during CausalEngine implementation when the async hasher init failed.
**Source:** 06-02-SUMMARY.md

### L3: `Context.Reference` ≠ `Tag` — Clock provision differs
`Clock` is `Context.Reference<{ nowSeconds: () => number }>`, not a standard `Tag`. It has a `defaultValue()` and uses `Clock.fixed(n)` for test provisioning. You cannot use `Effect.provideService(Clock, ...)` — use `Effect.provide(Clock, Clock.fixed(1000))` or omit provision (the default works). In gen blocks, `yield* Clock.nowSeconds()` returns `number`, not a callback.

**Context:** Multiple test failures and type errors traced to misunderstanding the Clock service type. Fixed by using static `Clock.nowSeconds()` instead of `yield* Effect.service(Clock)` destructuring.
**Source:** 06-VERIFICATION.md, 06.1-01-SUMMARY.md

---

## Patterns

### P1: Engine implementation pattern
All engines follow: `Effect.gen(function* () {})` with `serviceOption(EpistemicTrace)` for optional trace events, `Clock.nowSeconds()` for timestamps, mutable `this.state` for accumulation, and typed `Report` return values with numeric fields (no Option/undefined — deterministic).

**When to use:** Implementing any new epistemic engine tier.
**Source:** 06-02-PLAN.md, 06-03-PLAN.md, 06-RESEARCH.md

### P2: Test provisioning with mock engines
Engine tests provide fake upstream state via factory functions (`fakeConceptState(...)`, `fakeCausalState(...)`), with `EpistemicTrace` provided as NoopTrace via `Effect.provideService()`. Mock clocks use `Clock.fixed(timestamp)` when the service is a `Context.Reference`. Deterministic tests verify `deepStrictEqual` across replays.

**When to use:** Testing any engine that depends on upstream engine state or optional services.
**Source:** 06-02-SUMMARY.md, 06-03-SUMMARY.md

### P3: Optional service integration via `serviceOption()`
Recall Pipeline.ts already had `serviceOption(BoundedReranker)` and `serviceOption(RecallFinalizer)` wired — Phase 6 only needed to provide implementations and register them in DefaultLayer. This decouples the pipeline from specific reranker/finalizer implementations.

**When to use:** Designing extensible pipelines where features may or may not be configured.
**Source:** 06-04-PLAN.md, 06-04-SUMMARY.md

---

## Surprises

### S1: TypeScript strict mode catches real design issues
The EpistemicRuntime R-type errors weren't just type noise — they revealed that the contract was too narrow. `Effect<EpistemicReport, never, EpistemicTrace>` pretended the orchestrator only needed trace, but it actually needs all four engines. Widening the contract was the correct fix, not suppressing types.

**Impact:** Led to a clearer contract that accurately reflects runtime dependencies. This is a feature of Effect-TS's R-type tracking, not a bug.
**Source:** 06.1-01-SUMMARY.md, 06-VERIFICATION.md

### S2: Worktree isolation vs inline execution trade-off is significant on Windows
Phase 6 was executed inline (not via gsd-executor subagents with worktree isolation) because worktree creation on Windows can be slow and error-prone. The total implementation time for 5 plans across 3 waves was ~20 minutes inline, versus an estimated ~2 hours with subagent spawning overhead (worktree setup, merge-back, cleanup per wave).

**Impact:** For phases with clear dependencies and experienced developers, inline execution is dramatically faster. The worktree model is better for phases with independent parallel plans and less experienced executors.
**Source:** 06-CONTEXT.md (execution notes)
