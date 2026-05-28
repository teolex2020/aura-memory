---
plan: 06-01
phase: 06-maintenance-pipeline-completion
type: execute
wave: 0
autonomous: true
requirements:
  - REQ-012
status: complete
completed_tasks: 3
issues: []
deviations: []
---

## Plan 06-01: Contract Types — Complete

**Objective:** Created typed contract definitions for Causal and Policy engine domains.

### What Changed

**New files:**
- `packages/contract/src/causal/CausalTypes.ts` — CausalState, CausalDiscoveryMode, CausalPattern, CausalEngineState, CausalReport
- `packages/contract/src/policy/PolicyTypes.ts` — PolicyState, PolicyHint, PolicyEngineState, PolicyReport

**Updated contract interfaces:**
- `packages/contract/src/Causal.ts` — CausalEngineImpl uses typed `discover(ConceptEngineState, ReadonlyMap, SdrLookup): Effect<CausalReport, never, EpistemicTrace>`, added `stats(): Effect<CausalEngineState>`, CausalStoreImpl uses `CausalEngineState`
- `packages/contract/src/Policy.ts` — PolicyEngineImpl uses typed `discover(CausalEngineState, ReadonlyMap): Effect<PolicyReport, never, EpistemicTrace>`, added `stats(): Effect<PolicyEngineState>`, PolicyStoreImpl uses `PolicyEngineState`
- `packages/contract/src/EpistemicRuntime.ts` — Added `maintain(records, sdr_lookup): Effect<EpistemicReport, never, EpistemicTrace>`, typed getters return proper engine states, defined `EpistemicReport`
- `packages/contract/src/index.ts` — Added `export * from "./causal/CausalTypes"` and `export * from "./policy/PolicyTypes"`

**Updated implementations to match contracts:**
- `packages/storage/src/CausalStoreFile.ts` — `empty_engine()` returns typed `CausalEngineState`, `save/load` typed
- `packages/storage/src/PolicyStoreFile.ts` — `empty_engine()` returns typed `PolicyEngineState`, `save/load` typed
- `packages/causal/src/CausalStore.ts` — `save(engine: CausalEngineState)`
- `packages/policy/src/PolicyStore.ts` — `save(engine: PolicyEngineState)`
- `packages/causal/src/CausalEngine.ts` — Stub updated to match contract (typed params, `stats()` added, re-exports `CausalState`)
- `packages/policy/src/PolicyEngine.ts` — Stub updated to match contract (typed params, `stats()` added, re-exports `PolicyState`)
- `packages/epistemic-runtime/src/EpistemicRuntime.ts` — Stub updated with `maintain()` and typed getters

**Updated tests:**
- `packages/storage/src/CausalStoreFile.test.ts` — Uses typed `CausalEngineState`
- `packages/storage/src/PolicyStoreFile.test.ts` — Uses typed `PolicyEngineState`

### Verification
- `bun run typecheck`: Passes for all affected packages
- `bun run test packages/storage/`: Both store tests pass

### Artifacts
| path | provides | min_lines | status |
|------|----------|-----------|--------|
| packages/contract/src/causal/CausalTypes.ts | Causal type definitions | 50 | ✓ (58 lines) |
| packages/contract/src/policy/PolicyTypes.ts | Policy type definitions | 40 | ✓ (57 lines) |
