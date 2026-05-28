---
plan: 06-05
phase: 06-maintenance-pipeline-completion
type: execute
wave: 2
autonomous: true
requirements:
  - REQ-012
status: complete
completed_tasks: 3
issues: []
deviations: []
---

## Plan 06-05: EpistemicRuntime + DefaultLayer — Complete

**Objective:** Wired the full maintenance pipeline and updated DefaultLayer composition.

### What Changed

**Modified:**
- `packages/epistemic-runtime/src/EpistemicRuntime.ts` — Full implementation:
  - `maintain(records, sdr_lookup): Effect<EpistemicReport, never, EpistemicTrace>` — chains Belief.update_with_sdr → Concept.discover → CausalEngine.discover → PolicyEngine.discover sequentially, emits maintenance.start/end trace events
  - `get_beliefs()` → `Effect<BeliefEngineState>` (typed)
  - `get_concepts()` → `Effect<ConceptEngineState>` (typed)
  - `get_causal_patterns()` → `Effect<CausalEngineState>` (typed)
  - `get_policy_hints()` → `Effect<PolicyEngineState>` (typed)
  - Surfaced methods remain stubs (Phase 7)
- `packages/core/src/DefaultLayer.ts` — Added `BoundedRerankerLive` and `RecallFinalizerLive` to Layer.mergeAll

**New:**
- `packages/epistemic-runtime/src/EpistemicRuntime.test.ts` — 5 tests:
  - maintain runs full pipeline, returns EpistemicReport with all 4 sub-reports
  - get_beliefs, get_concepts, get_causal_patterns, get_policy_hints all typed

### Verification
- 5/5 tests pass
- Pipeline order verified: Belief → Concept → Causal → Policy
- DefaultLayer registers all 13 services
