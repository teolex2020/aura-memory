---
plan: 06-03
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

## Plan 06-03: PolicyEngine — Complete

**Objective:** Implemented PolicyEngine extracting policy hints from stable causal patterns.

### What Changed

**Modified:**
- `packages/policy/src/PolicyEngine.ts` — Full implementation replacing the stub:
  - `discover(CausalEngineState, records): Effect<PolicyReport, never, EpistemicTrace>` — iterates causal patterns, creates PolicyHint for each non-Rejected pattern (Stable → PolicyState.Stable, Invalidated → Suppressed, confidence>0.7 → Stable else Candidate), deterministic hint IDs (ph- prefix)
  - `retract_hint(id)` — removes hint from state
  - `stats()` — returns current PolicyEngineState
  - Re-exports PolicyState from @aura/contract

**New:**
- `packages/policy/src/PolicyEngine.test.ts` — 6 tests:
  - Initial empty state
  - Empty report when no causal patterns
  - Hint creation from stable patterns
  - Suppressed hints for invalidated patterns
  - Retract removes hint from state
  - Deterministic output across replays

### Verification
- 6/6 tests pass
- Follows ConceptEngine pattern
