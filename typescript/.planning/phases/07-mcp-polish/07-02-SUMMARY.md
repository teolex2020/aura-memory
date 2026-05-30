---
phase: 07-mcp-polish
plan: 02
subsystem: core-maintenance
tags: [maintenance, mcp, sdr, taxonomy, persistence, effect]
requires:
  - phase: 07-mcp-polish
    provides: [MCP DTO contracts, maintenance artifact storage helpers]
provides:
  - Typed MaintenanceService dependency dispositions for SDRInterpreter, TagTaxonomy, NGramIndex, CognitiveStore, BackgroundBrain
  - Non-empty content-derived SDR lookup for maintenance runs
  - Deterministic taxonomy, insight, epistemic, reflection, and maintenance history inputs for Phase 7 MCP surfaces
  - Aura-owned maintenance trend and reflection history with JSON mirror persistence
affects: [phase-07-wave-2, maintain, insights, memory_health, explainability, governance]
tech-stack:
  added: []
  patterns: [typed bounded shim, Rust-shaped DTO mirror, Aura runtime-owned maintenance history]
key-files:
  created: [.planning/phases/07-mcp-polish/07-02-SUMMARY.md]
  modified:
    - packages/core/src/MaintenanceService.ts
    - packages/core/src/Aura.ts
    - packages/core/src/MaintenanceService.test.ts
key-decisions:
  - "SDRInterpreter is real and imported from @aura/recall; no empty SDR fallback remains for non-empty content."
  - "TagTaxonomy is a deterministic bounded core adapter instead of a pass-through shim."
  - "NGramIndex remains a documented NON-PARITY trigram adapter until Rust MinHash+LSH lands."
  - "BackgroundBrain autonomous paths remain explicitly disabled and never claim work was performed."
requirements-completed: [REQ-001, REQ-012]
duration: 20min
completed: 2026-05-30T19:17:00Z
---

# Phase 07 Plan 02: Maintenance Debt Completion Summary

**MaintenanceService now uses real SDR vectors, deterministic taxonomy inputs, bounded typed adapters, and Aura-owned persisted trend/reflection histories for Phase 7 MCP surfaces.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-30T18:57:00Z
- **Completed:** 2026-05-30T19:17:00Z
- **Tasks:** 1 implementation pass
- **Files modified:** 4

## Subsystem Disposition

| Subsystem | Disposition | Go/No-Go for Wave 2 | Evidence |
|-----------|-------------|---------------------|----------|
| `SDRInterpreter` | Implemented | Go | Imported from `@aura/recall`; seeded run computed `sdrVectorsComputed = 4` and non-empty vectors. |
| `TagTaxonomy` | Typed bounded shim | Go | Deterministically classifies normalized tags, namespace, semantic type, level, identity/non-identity/task/contradiction cues. |
| `NGramIndex` | Typed bounded shim | Go with parity caveat | Provides candidate query via trigram Jaccard; marked `NON-PARITY IMPLEMENTATION` until Rust MinHash+LSH lands. |
| `CognitiveStore` | Typed adapter | Go | Wraps `CognitiveStoreFile` delete/flush path; no new append-only store invented. |
| `BackgroundBrain` | Explicit disabled shim | Go for maintain/health, No-Go for scheduler-only surfaces | Cross-connection and scheduled-task paths return deterministic empty arrays with `NON-PARITY IMPLEMENTATION` markers. |

## Seeded Evidence

- `runMaintenance()` seeded fixture: `sdrVectorsComputed = 4`.
- Same fixture: `insightsFound = 4`, so downstream surfaces are not built on all-zero maintenance output.
- Reflection generation produced non-empty findings from overdue active scheduled-task input.
- Persistence mirror wrote one trend and one reflection summary, then reopen/hydrate produced `trendSummary.snapshotCount = 2` after the second run.

## TagTaxonomy Contract

`fix_memory_levels` consumes `identityCue` and `nonIdentityCue` so identity records are kept only for identity-specific tags/cues or earned activation/strength thresholds; non-identity task/decision/contradiction cues downgrade accidental Identity records to Domain.

`guarded_reflect` consumes level and deterministic taxonomy context to prevent overpromotion: Working records stay Working, and records cannot reach Identity unless they meet the Rust activation/strength gate.

`guarded_reflect` and reflection inputs also consume `taskCue` and `contradictionCue` so scheduled-task and contradiction surfaces have stable, searchable classifications.

## BackgroundBrain Empty Outputs

| Output | Current TS behavior | Affected Phase 7 surfaces | Alternate real inputs |
|--------|---------------------|---------------------------|-----------------------|
| `discover_cross_connections` | Explicit empty disabled shim | `consolidate`, `cross_namespace_digest` may lack autonomous cross-connection discoveries | NGram consolidation clusters and maintenance trend/reflection summaries are real. |
| Scheduled tasks/reminders | Explicit empty disabled shim | Reminder-only MCP behavior remains unsupported | Active scheduled-task records still feed reflection findings and task reminder IDs. |
| Autonomous background scheduling | Not implemented by design | No background daemon in Phase 7 | `maintain` is explicit and deterministic. |

## Files Created/Modified

- `packages/core/src/MaintenanceService.ts` - Replaced `unknown` placeholders with real import/typed adapters; added SDR lookup, taxonomy, epistemic, insight, reflection, and bounded post-discovery behavior.
- `packages/core/src/Aura.ts` - Hydrates, owns, updates, and persists maintenance trend/reflection histories through 07-01 storage helpers.
- `packages/core/src/MaintenanceService.test.ts` - Adds shim classification, SDR, reflection, persistence, and end-to-end maintenance evidence tests.
- `.planning/phases/07-mcp-polish/07-02-SUMMARY.md` - Execution record and Wave 2 go/no-go table.

## Task Commits

1. **Maintenance service inputs and Aura persistence** - `223c01f` (`feat(07-02): complete maintenance service inputs`)

## Verification

- `bun run typecheck` — passed.
- `bun run test --filter "@aura/core"` — failed because Vitest 2.1.9 does not support `--filter`.
- Substitution: `bun run test packages/core/src/MaintenanceService.test.ts` — passed, 26 tests.
- Regression scope: `bun run test packages/core/src/MaintenanceService.test.ts packages/core/src/Aura.test.ts` — passed, 28 tests.
- Full suite: `bun run test` — passed, 43 files / 463 tests.
- `rg "type .* = unknown|TODO: Full algorithm deferred per D-07" packages/core/src/MaintenanceService.ts` — no matches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Rust churn denominator parity**
- **Found during:** MaintenanceService implementation.
- **Issue:** `layerChurn` divided by previous key count; Rust divides by current key count.
- **Fix:** Updated denominator and corrected the test expectation.
- **Files modified:** `packages/core/src/MaintenanceService.ts`, `packages/core/src/MaintenanceService.test.ts`
- **Verification:** Typecheck, targeted tests, full suite.

**2. [Rule 1 - Bug] Preserved legacy mock compatibility for feedback**
- **Found during:** Full workspace test run.
- **Issue:** Existing `Aura.test.ts` mock returned `undefined` for `apply_layer_feedback`, crashing trend snapshot construction after the real feedback path was wired.
- **Fix:** Added a defensive empty feedback report fallback for invalid legacy test doubles.
- **Files modified:** `packages/core/src/MaintenanceService.ts`
- **Verification:** `Aura.test.ts`, targeted core tests, full suite.

## Known Stubs

- `NGramIndex`: bounded trigram adapter only; not Rust MinHash+LSH parity.
- `BackgroundBrain`: autonomous cross-connection and scheduler outputs deliberately disabled.
- `runPostDiscoveryPhases`: native merge/meta creation and archival remain zero-output bounded paths; they do not block `maintain`, `insights`, or `memory_health` inputs created by this plan.

## Threat Flags

None. No new network endpoint, auth path, file access pattern outside existing storage helpers, or trust-boundary schema change was introduced.

## Next Phase Readiness

Wave 2 can consume `maintain`, `insights`, `memory_health`, explainability, and governance inputs with explicit caveats: SDR, taxonomy, trend, reflection, and insight inputs are real; NGram and BackgroundBrain remain bounded and documented rather than ambiguous.

## Self-Check: PASSED

- FOUND: `.planning/phases/07-mcp-polish/07-02-SUMMARY.md`
- FOUND: `packages/core/src/MaintenanceService.ts`
- FOUND: `packages/core/src/Aura.ts`
- FOUND: commit `223c01f`

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-30*
