# Phase 6: Maintenance Pipeline Completion - Research

**Researched:** 2026-05-27
**Domain:** Epistemic engine pipeline (Causal + Policy) + bounded reranking + finalize persistence
**Confidence:** HIGH

## Summary

Phase 6 completes the epistemic maintenance pipeline: Belief -> Concept -> Causal -> Policy, integrates bounded reranking into the recall pipeline, and implements finalize mutations. The Belief and Concept engines are fully implemented reference implementations to follow. Causal and Policy engines are stubs (discover/invalidate/retract all throw UnimplementedError). The EpistemicRuntime is a stub needing maintenance pipeline wiring. The recall Pipeline.ts already has BoundedReranker integration (via `serviceOption`) but the reranker needs a real implementation.

**Primary recommendation:** Implement CausalEngine and PolicyEngine following the exact patterns from ConceptEngine (Effect.gen, serviceOption(EpistemicTrace), Clock injection, mutable state, report return types). Create missing `CausalTypes.ts` and `PolicyTypes.ts` in `@aura/contract` following the `belief/BeliefTypes.ts` and `concept/ConceptTypes.ts` patterns. Wire the four-engine pipeline in EpistemicRuntime. Implement a real BoundedReranker service. Implement RecallFinalizer for finalize mutations.

## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion -- pure infrastructure phase.

### Claude's Discretion
- CausalEngine: discover, invalidate_pattern, retract_pattern implementations
- PolicyEngine: discover, retract_hint implementations
- EpistemicRuntime: maintenance pipeline hookup (Trace -> Belief -> Concept -> Causal -> Policy)
- Recall Pipeline: bounded reranking integration
- Finalize mutations: activate/strengthen/session persistence patterns

### Deferred Ideas (OUT OF SCOPE)
None -- all scope is Phase 6 implementation.

### Key Patterns to Follow
- Effect-TS Context/Layer DI across all packages
- @aura/contract defines service interfaces (Tags), implementations are in packages
- Rust parity: all output must be deterministic and match Rust reference implementation
- SIMPLE/FULL IMPLEMENTATION comment markers per project conventions

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-012 | Maintenance Pipeline End-to-End: Trace -> Belief -> Concept -> Causal -> Policy with bounded reranking and finalize | All four engine interfaces identified. Belief/Concept implemented as reference. Causal/Policy stubs need implementation. Pipeline wiring in EpistemicRuntime stubs. BoundedReranker and RecallFinalizer Tags exist in @aura/contract (recall pipeline already integrates them optionally) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Causal pattern discovery | Engine (causal package) | - | Pure computation over belief/concept state, no IO |
| Policy rule extraction | Engine (policy package) | - | Pure computation over causal state, no IO |
| Engine state persistence | Store (causal/policy packages) | Storage (storage package) | Store delegates to StoreFile which uses FileRead/FileWrite services |
| Maintenance pipeline orchestration | EpistemicRuntime | - | Orchestrates the sequential pipeline: Trace -> Belief -> Concept -> Causal -> Policy |
| Bounded reranking | Recall pipeline | - | Optional service injected into recallPipeline (already wired) |
| Finalize mutations | Recall pipeline | Storage layer | RecallFinalizer service persists activation/strengthen/session through storage |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect | 4.0.0-beta.68 | Effect-TS runtime for Effect/Layer/Context DI | All existing engines use this |
| @effect/vitest | 4.0.0-beta.68 | Test integration | Existing test infrastructure |
| vitest | ^2.0.0 | Test runner | Project standard |
| xxhash-wasm | ^1.1.0 | Deterministic hashing for IDs | ConceptEngine uses for deterministicId |
| @aura/contract | workspace | Service interfaces (Tags, types) | Canonical definitions for all engine/service interfaces |
| @aura/utils | workspace | Pure utility functions (id12, nowSecs) | No IO utilities used across engines |
| @aura/storage | workspace | CogJsonSnapshotFile for persistence | StoreFile pattern used by BeliefStoreFile, ConceptStoreFile, CausalStoreFile, PolicyStoreFile |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|--------------|
| @aura/platform-node | workspace | NodeFileReadLive, NodeFileWriteLive | Test provisioning for store tests |
| @aura/belief | workspace | BeliefEngineImpl reference | Pattern reference for Causal/Policy implementation |
| @aura/concept | workspace | ConceptEngineImpl reference | Primary pattern reference -- architecture mirrors what Causal/Policy need |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Effect.gen/yield pattern | Pipe-based Effect.chained | All existing engines use Effect.gen -- consistency matters. Pipe-based would work but break expected code style |
| Service-level DI via Layer.succeed | Class instantiation | All engines use Layer.succeed for DI wiring |

**Version verification:**
```bash
# All packages are workspace-linked -- versions defined in root package.json
npm view effect version           # 4.0.0-beta.68 [VERIFIED: root package.json]
npm view xxhash-wasm version      # 1.1.0 [VERIFIED: root package.json]
```

## Package Legitimacy Audit

> Phase 6 uses only existing workspace packages -- no external packages to install.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| @aura/causal | workspace | - | - | monorepo internal | [OK] | Already exists |
| @aura/policy | workspace | - | - | monorepo internal | [OK] | Already exists |
| @aura/contract | workspace | - | - | monorepo internal | [OK] | Already exists |
| @aura/storage | workspace | - | - | monorepo internal | [OK] | Already exists |
| @aura/epistemic-runtime | workspace | - | - | monorepo internal | [OK] | Already exists |
| @aura/recall | workspace | - | - | monorepo internal | [OK] | Already exists |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### Pipeline Architecture

```
Records (from brain.cog)
       |
       v
  [BeliefEngine.update_with_sdr]
       |  (builds BeliefEngineState: beliefs + hypotheses + record_to_belief)
       |  returns BeliefReport
       v
  [ConceptEngine.discover]
       |  (takes BeliefEngineImpl + records + sdr_lookup)
       |  (builds ConceptEngineState: concepts + key_index)
       |  returns ConceptReport
       v
  [CausalEngine.discover]
       |  (takes ConceptEngineImpl | BeliefEngineState + records + sdr_lookup)
       |  (builds CausalEngineState: patterns + metadata)
       |  returns CausalReport
       v
  [PolicyEngine.discover]
       |  (takes CausalEngineImpl | ConceptEngineState + records)
       |  (builds PolicyEngineState: hints + metadata)
       |  returns PolicyReport
       v
  [Persist all engine states via StoreFile]
       v
  [Recall Pipeline (optional BoundedReranker integration)]
       v
  [Finalize mutations (activate/strengthen/session)]
```

### Effect-Engine Pattern (from BeliefEngine)

Every engine follows this pattern:
```typescript
export class XxxEngineImpl {
  private state: XxxEngineState = { /* initial empty state */ }

  discover(
    /* upstream engine dependency */,
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ): Effect.Effect<XxxReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const { nowSeconds } = yield* Effect.service(Clock)
      const traceOpt = yield* serviceOption(EpistemicTrace)
      // ... implementation ...
      self.state = { /* new state */ }
      return report
    })
  }

  stats(): Effect.Effect<XxxEngineState> {
    return Effect.succeed(this.state)
  }
}

export const XxxEngineLive = Layer.succeed(XxxEngine, new XxxEngineImpl())
```

### Store File Pattern (from BeliefStoreFile)

```typescript
export class XxxStoreFile {
  private constructor(private readonly dir: string) {}
  static new(dir: string): XxxStoreFile { return new XxxStoreFile(dir) }
  static empty_engine(): XxxEngineState { return { /* default empty state */ } }
  load(): Effect.Effect<XxxEngineState, ...> { /* CogJsonSnapshotFile.load */ }
  save(engine: XxxEngineState): Effect.Effect<void, ...> { /* CogJsonSnapshotFile.save */ }
}
```

### Store Wrapper Pattern (from BeliefStore)

```typescript
export class XxxStoreImpl {
  private readonly file: XxxStoreFile
  constructor(dir: string) { this.file = XxxStoreFile.new(dir) }
  load() { return this.file.load() }
  save(engine: XxxEngineState) { return this.file.save(engine) }
}
export function XxxStoreLive(dir: string) {
  return Layer.succeed(XxxStore, new XxxStoreImpl(dir))
}
```

### Layer Composition Pattern (from DefaultLayer.ts)

```typescript
// @aura/core DefaultLayer composes all layers:
return Layer.mergeAll(
  RecallViewLive(brainDir),
  BeliefStoreLive(brainDir),
  BeliefEngineLive,
  ConceptStoreLive(brainDir),
  ConceptEngineLive,
  CausalStoreLive(brainDir),
  CausalEngineLive,
  PolicyStoreLive(brainDir),
  PolicyEngineLive,
  EpistemicRuntimeLive,
  EpistemicTraceLive
)
```

### Anti-Patterns to Avoid
- **Direct instantiation of StoreFile in engines**: Engines should use the Store service Tag, not instantiate StoreFile directly
- **Synchronous blocking in engine logic**: All engine computations should use `Effect.gen` for consistency, even for pure sync logic
- **Missing serviceOption(EpistemicTrace)**: All four engines must use the `serviceOption(EpistemicTrace)` pattern for trace events
- **Hardcoded Clock.new instead of Clock service**: Use `yield* Effect.service(Clock)` then `.nowSeconds()`, not `Date.now()` or `new Date()`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File persistence format | Custom JSON file I/O | CogJsonSnapshotFile.load/save | Handles exists-check, empty-file fallback, JSON parse errors, type-safe generics |
| Effect Context DI | Custom DI container | effect Context + Layer + Tag | Already established across all packages |
| Deterministic IDs | Random/Date-only IDs | xxhash-wasm h64 (as ConceptEngine does) | Rust parity: deterministicId pattern for reproducible results |
| File read/write | Direct fs calls | FileRead/FileWrite service tags | Allows test substitution (NodeFileReadLive vs mock) |

## Common Pitfalls

### Pitfall 1: Missing Causal/Policy Type Definitions in Contract
**What goes wrong:** CausalEngine and PolicyEngine define their own enums (CausalState, PolicyState) locally in their engine files instead of in @aura/contract types.
**Why it happens:** Belief and Concept have `belief/BeliefTypes.ts` and `concept/ConceptTypes.ts` in the contract package. Causal and Policy do not have equivalent type files.
**How to avoid:** Create `causal/CausalTypes.ts` and `policy/PolicyTypes.ts` in `@aura/contract/src/`, following the exact naming/export patterns from `belief/BeliefTypes.ts`.
**Warning signs:** Engine states are typed as generic `unknown` in store save/load methods.

### Pitfall 2: Inconsistent EpistemicTrace Integration
**What goes wrong:** Some engines emit trace events, others don't.
**Why it happens:** The serviceOption(EpistemicTrace) pattern is optional -- it's easy to skip.
**How to avoid:** Every engine must use `const traceOpt = yield* serviceOption(EpistemicTrace)` in its `discover` method, and emit start/end events with structured fields matching the Belief/Concept patterns.
**Warning signs:** Missing trace events in the maintenance pipeline observability.

### Pitfall 3: CausalEngine Take on ConceptEngine as Parameter Instead of ConceptEngineState
**What goes wrong:** Unlike ConceptEngine which takes `BeliefEngineImpl`, CausalEngine might take ConceptEngine directly, creating tight coupling.
**How to avoid:** Follow the ConceptEngine pattern: take the upstream state (ConceptEngineState), not the full engine reference. ConceptEngine takes `BeliefEngineImpl` only because it needs `belief_for_record` and other methods. Causal likely only needs `ConceptEngineState` via `.stats()`. Decide based on actual method requirements.
**Warning signs:** Engine receives full upstream engine reference but only uses its state.

### Pitfall 4: BoundedReranker Not Implemented But Integrated
**What goes wrong:** Pipeline.ts already has `serviceOption(BoundedReranker)` integration (lines 167-171), but there is no BoundedReranker implementation.
**Why it happens:** The recall pipeline was designed with optional services. Without an implementation, reranking is a no-op.
**How to avoid:** Implement a BoundedReranker that provides actual reranking logic (e.g., rerank using concept/policy scores) and register it in DefaultLayer.
**Warning signs:** Reranker option exists in contract but is never provided -- pipeline silently skips it.

### Pitfall 5: Finalize Mutations Not Connected to Storage
**What goes wrong:** RecallFinalizer exists as a Tag but has no implementation that persists mutation data.
**Why it happens:** The contract defines the interface but no package provides the implementation.
**How to avoid:** Implement RecallFinalizer that writes activate/strengthen/session mutations through the cognitive store or a dedicated session store. Register in DefaultLayer.
**Warning signs:** `finalize` is called (traced) but data is lost on process restart.

## Code Examples

### Verified patterns from existing implementations:

### Effect.gen Engine Pattern (from ConceptEngine.discover)
```typescript
// Source: @aura/concept/src/ConceptEngine.ts lines 490-752 (VERIFIED: codebase)
discover(
  belief_engine: BeliefEngineImpl,
  records: ReadonlyMap<string, AuraRecord>,
  sdr_lookup: SdrLookup
): Effect.Effect<ConceptReport, never, EpistemicTrace> {
  const self = this
  return Effect.gen(function* () {
    const traceOpt = yield* serviceOption(EpistemicTrace)
    const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined
    if (trace) yield* trace.event("concept.discover.start", { records: records.size })

    const beliefState = yield* belief_engine.stats()
    // ... processing logic ...

    self.state = { ...self.state, concepts: newConcepts, key_index: newKeyIndex }

    const report: ConceptReport = { /* ... metrics ... */ }
    if (trace) { yield* trace.event("concept.discover.end", { /* ... */ }) }
    return report
  })
}
```

### StoreFile Pattern (from ConceptStoreFile)
```typescript
// Source: @aura/storage/src/ConceptStoreFile.ts (VERIFIED: codebase)
export class ConceptStoreFile {
  private constructor(private readonly dir: string) {}
  static new(dir: string): ConceptStoreFile { return new ConceptStoreFile(dir) }

  static empty_engine(): ConceptEngineState { /* ... */ }

  load(): Effect.Effect<ConceptEngineState, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/concepts.cog`
    return CogJsonSnapshotFile.load(filePath, ConceptStoreFile.empty_engine)
  }

  save(engine: ConceptEngineState): Effect.Effect<void, FileWriteError, FileWrite> {
    const filePath = `${this.dir}/concepts.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, engine)
    })
  }
}
```

### BoundedReranker Integration (in recall Pipeline.ts -- already wired)
```typescript
// Source: @aura/recall/src/Pipeline.ts lines 167-176 (VERIFIED: codebase)
const rerankerOpt = yield* serviceOption(BoundedReranker)
if (Option.isSome(rerankerOpt)) {
  const reranked = yield* rerankerOpt.value.rerank(matched, query)
  matched = Array.from(reranked)
}

const finalizerOpt = yield* serviceOption(RecallFinalizer)
if (Option.isSome(finalizerOpt)) {
  yield* finalizerOpt.value.finalize(matched, opts.sessionId)
}
```

### Deterministic ID Pattern (from ConceptEngine)
```typescript
// Source: @aura/concept/src/ConceptEngine.ts lines 320-326 (VERIFIED: codebase)
async function deterministicId(hasher: Hasher, key: string): Promise<string> {
  const h = hasher.h64(key) & ((1n << 64n) - 1n)
  const hex = h.toString(16).padStart(16, "0")
  return `c-${hex.slice(-12)}`
}
```

### Test Pattern for Engines (from ConceptEngine.test.ts)
```typescript
// Source: @aura/concept/src/ConceptEngine.test.ts (VERIFIED: codebase)
const NoopTrace: EpistemicTraceImpl = {
  event: () => Effect.void,
  span: (_name, _fields, eff) => eff
}

function fakeBeliefEngine(state: BeliefEngineState): BeliefEngineImpl {
  return {
    stats: () => Effect.succeed(state),
    // ... other methods stubbed ...
  }
}

it("test name", async () => {
  const engine = new ConceptEngineImpl()
  const report = await Effect.runPromise(
    engine.discover(fakeBeliefEngine(state), records, sdr)
      .pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )
  assert.strictEqual(report.candidates_found, 1)
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Belief/Concept engines stubs | Belief/Concept fully implemented | Phase 5 | Reference implementations for Causal/Policy patterns |
| Causal/Policy engine stubs | Need full implementation | Phase 6 | Must follow ConceptEngine pattern exactly |
| EpistemicRuntime stubs | Need maintenance pipeline wiring | Phase 6 | Must chain all four engines in sequence |
| BoundedReranker Tag defined, no impl | Need real reranking service | Phase 6 | Provide implementation via Layer |
| RecallFinalizer Tag defined, no impl | Need finalize persistence | Phase 6 | Implement activation/strengthen/session write-through |

**Deprecated/outdated:**
- N/A -- Phase 6 is implementation of new functionality

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | CausalEngine needs causal/CausalTypes.ts and policy/PolicyTypes.ts in @aura/contract | Architecture Patterns | Types live in engine packages instead, causing import ambiguity |
| A2 | Causal/Policy engine discover methods follow ConceptEngine's `Effect.gen` pattern and take `BeliefEngineImpl`/`ConceptEngineImpl` as parameters | Standard Stack | Engine needs different input parameters |
| A3 | The maintenance pipeline in EpistemicRuntime should run sequentially: Trace -> Belief -> Concept -> Causal -> Policy | Pipeline Architecture | Different ordering or parallel execution is required |
| A4 | BoundedReranker and RecallFinalizer must be implemented as new services registered in DefaultLayer | Standard Stack | These are implemented in existing packages (e.g., core or recall) |
| A5 | Finalize mutations (activate/strengthen/session) write through CognitiveStoreFile append | Standard Stack | Different persistence mechanism is needed |

## Open Questions

1. **CausalEngine discover input signature**
   - What we know: ConceptEngine takes `BeliefEngineImpl` (needs `.stats()`, `.belief_for_record()`). CausalEngine will likely follow similar pattern.
   - What's unclear: Does CausalEngine need `ConceptEngineImpl` methods beyond `.stats()`? Or does it only need `ConceptEngineState`?
   - Recommendation: Start with `ConceptEngineState` (via `.stats()`), add more only if needed.

2. **PolicyEngine discover input signature**
   - What we know: PolicyEngine sits above CausalEngine in the hierarchy.
   - What's unclear: Does PolicyEngine need `CausalEngineImpl` or just `CausalEngineState`?
   - Recommendation: Same as above -- start with `CausalEngineState`.

3. **BoundedReranking algorithm specification**
   - What we know: The BoundedReranker tag expects `rerank(scored, query) -> Effect<scored, RerankError>`.
   - What's unclear: What is the specific reranking algorithm? Simple source-trust reordering? Top-N bounded deep reranking?
   - Recommendation: Implement a configurable-depth bounded reranker that re-scores top-K results using concept/policy scores.

4. **Finalize mutation persistence details**
   - What we know: RecallFinalizer interface has `finalize(scored, sessionId?)`. The recall pipeline calls it.
   - What's unclear: What should `finalize` persist? Activation counts? Session references? Strengthen via storage?
   - Recommendation: Implement activation_count increment + session-boundary tracking. Activate records via CognitiveStoreFile.appendUpdate.

5. **EpistemicRuntime maintenance pipeline trigger**
   - What we know: EpistemicRuntime is a service with get_* methods.
   - What's unclear: Who calls the maintenance pipeline? Is there a `maintain()` method on EpistemicRuntime? Or does each get_* lazy-init?
   - Recommendation: Add a `maintain(records, sdr_lookup)` method to EpistemicRuntime that runs the full pipeline and returns a consolidated report.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun | Test runner / typecheck | ✓ | 1.3.13 | npm/yarn |
| TypeScript | Compilation | ✓ | ^5.6.0 | -- |
| vitest | Test framework | ✓ | ^2.0.0 | -- |
| effect | Core runtime | ✓ | 4.0.0-beta.68 | -- |
| Rust | Parity test verification | ? | -- | -- |

**Missing dependencies with no fallback:**
- Rust toolchain: Needed for parity tests (`aura-ts-recall-fixtures`, `aura-ts-verify-recall`). If unavailable, parity tests will be skipped.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.0.0 |
| Config file | Root package.json `"test": "vitest run --passWithNoTests"` |
| Quick run command | `bun run test -- --reporter=verbose` |
| Full suite command | `bun run test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-012 | CausalEngine.discover mines causal patterns | unit | `bun run test -- packages/causal/` (once test created) | Wave 0 |
| REQ-012 | CausalEngine.invalidate_pattern marks pattern invalid | unit | Same | Wave 0 |
| REQ-012 | CausalEngine.retract_pattern removes pattern | unit | Same | Wave 0 |
| REQ-012 | PolicyEngine.discover extracts policy hints | unit | `bun run test -- packages/policy/` (once test created) | Wave 0 |
| REQ-012 | PolicyEngine.retract_hint removes outdated hint | unit | Same | Wave 0 |
| REQ-012 | EpistemicRuntime runs full maintenance pipeline | integration | `bun run test -- packages/epistemic-runtime/` (once test created) | Wave 0 |
| REQ-012 | BoundedReranker re-ranks results | unit | `bun run test -- packages/recall/` (existing) | Wave 0 |
| REQ-012 | RecallFinalizer persists mutations | unit | Same | Wave 0 |
| REQ-012 | Determinstic output matching Rust | parity | See Recall.parity.test.ts pattern | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test -- --changed` (runs tests for changed packages)
- **Per wave merge:** `bun run test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/causal/src/CausalEngine.test.ts` -- covers discover/invalidate/retract
- [ ] `packages/policy/src/PolicyEngine.test.ts` -- covers discover/retract
- [ ] `packages/epistemic-runtime/src/EpistemicRuntime.test.ts` -- covers maintenance pipeline
- [ ] `packages/recall/src/BoundedReranker.test.ts` -- covers reranking algorithm (or extend Pipeline.test.ts)
- [ ] `packages/recall/src/RecallFinalizer.test.ts` -- covers finalize persistence (or extend Pipeline.test.ts)

*(If no gaps: "None -- existing test infrastructure covers all phase requirements")*

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | no | -- |
| V5 Input Validation | no | -- |
| V6 Cryptography | no | -- |

**Note:** Phase 6 is a pure infrastructure/computation phase. Engines operate on already-validated records. No new security boundaries are introduced. The existing security enforcement (ASVS Level 1) applies to the platform-node package and FileRead/FileWrite services, which are unchanged in this phase.

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Data corruption in engine state | Tampering | All engine state is transient (rebuild on each maintenance cycle). Disk persistence uses CogJsonSnapshotFile which writes atomically. |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase] `packages/causal/src/CausalEngine.ts` -- Current stub state
- [VERIFIED: codebase] `packages/causal/src/CausalStore.ts` -- Current store wrapper
- [VERIFIED: codebase] `packages/policy/src/PolicyEngine.ts` -- Current stub state
- [VERIFIED: codebase] `packages/policy/src/PolicyStore.ts` -- Current store wrapper
- [VERIFIED: codebase] `packages/belief/src/BeliefEngine.ts` -- Reference implementation
- [VERIFIED: codebase] `packages/concept/src/ConceptEngine.ts` -- Reference implementation
- [VERIFIED: codebase] `packages/contract/src/Causal.ts` -- CausalEngine Tag definition
- [VERIFIED: codebase] `packages/contract/src/Policy.ts` -- PolicyEngine Tag definition
- [VERIFIED: codebase] `packages/contract/src/belief/BeliefTypes.ts` -- Belief type definitions
- [VERIFIED: codebase] `packages/contract/src/concept/ConceptTypes.ts` -- Concept type definitions
- [VERIFIED: codebase] `packages/contract/src/Recall.ts` -- BoundedReranker, RecallFinalizer Tags
- [VERIFIED: codebase] `packages/contract/src/EpistemicRuntime.ts` -- EpistemicRuntime Tag
- [VERIFIED: codebase] `packages/recall/src/Pipeline.ts` -- Current pipeline with reranker/finalizer integration
- [VERIFIED: codebase] `packages/storage/src/CausalStoreFile.ts` -- Persists to causal.cog
- [VERIFIED: codebase] `packages/storage/src/PolicyStoreFile.ts` -- Persists to policies.cog
- [VERIFIED: codebase] `packages/storage/src/ConceptStoreFile.ts` -- Persists to concepts.cog
- [VERIFIED: codebase] `packages/storage/src/BeliefStoreFile.ts` -- Persists to beliefs.cog
- [VERIFIED: codebase] `packages/storage/src/CogJsonSnapshotFile.ts` -- JSON persistence utility
- [VERIFIED: codebase] `packages/core/src/DefaultLayer.ts` -- Layer composition
- [VERIFIED: codebase] `packages/core/src/Aura.ts` -- Core facade (no maintenance method yet)
- [VERIFIED: codebase] `packages/contract/src/Errors.ts` -- Error types
- [VERIFIED: codebase] `packages/contract/src/Clock.ts` -- Clock service with nowSeconds

### Secondary (MEDIUM confidence)
- [VERIFIED: codebase] `packages/belief/src/BeliefEngine.test.ts` -- Test patterns for engines
- [VERIFIED: codebase] `packages/concept/src/ConceptEngine.test.ts` -- Test patterns with fake upstream engines
- [VERIFIED: codebase] `packages/recall/src/Pipeline.test.ts` -- Test patterns with optional services
- [VERIFIED: codebase] `packages/storage/src/CausalStoreFile.test.ts` -- Store file test pattern

### Tertiary (LOW confidence)
- [ASSUMED] Causal and Policy engine types need to be defined in @aura/contract (no equivalent of BeliefTypes.ts/ConceptTypes.ts exists yet)
- [ASSUMED] Bounded reranking algorithm scope and depth
- [ASSUMED] CausalEngine.discover signature will follow ConceptEngine pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All dependencies verified via codebase/package.json
- Architecture: HIGH - Patterns extracted from working reference implementations
- Pitfalls: MEDIUM - Two pitfalls verified via codebase (types missing, trace pattern), others are anticipatory based on common mistakes
- Types needed: HIGH - Direct observation shows no causal/policy type files in contract package

**Research date:** 2026-05-27
**Valid until:** 2026-07-01 (stable codebase, slow-moving dependencies)
