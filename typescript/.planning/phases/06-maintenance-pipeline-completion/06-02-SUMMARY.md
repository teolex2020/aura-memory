---
plan: 06-02
phase: 06-maintenance-pipeline-completion
type: tdd
wave: 1
autonomous: true
requirements:
  - REQ-012
status: complete
completed_tasks: 1
issues: []
deviations: []
---

## Plan 06-02: CausalEngine — Complete

**Objective:** Implemented CausalEngine with co-occurrence based causal pattern discovery from concept state.

### What Changed

**Modified:**
- `packages/causal/src/CausalEngine.ts` — Full implementation replacing the stub:
  - `discover(ConceptEngineState, records, sdr_lookup): Effect<CausalReport, never, EpistemicTrace>` — builds reverse index of record→concept co-occurrence, scores concept pairs with support/confidence/lift, creates CausalPattern entries with deterministic IDs (cp- prefix, xxhash-based)
  - `invalidate_pattern(id)` — marks pattern as CausalState.Invalidated
  - `retract_pattern(id)` — removes pattern from state
  - `stats()` — returns current CausalEngineState
  - Re-exports CausalState from @aura/contract

**New:**
- `packages/causal/src/CausalEngine.test.ts` — 6 tests:
  - Initial empty state
  - Empty report when <2 concepts
  - Pattern creation from co-occurring concepts
  - Invalidate marks pattern Invalidated
  - Retract removes pattern from state
  - Deterministic output across replays

### Verification
- 6/6 tests pass
- Typecheck: passes for causal package
- Follows ConceptEngine pattern: Effect.gen, serviceOption(EpistemicTrace), Clock service, mutable state
