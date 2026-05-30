---
phase: 07-mcp-polish
plan: 03
subsystem: core-mcp-facade
tags: [mcp, aura-core, search, maintenance, policy-surface, typed-errors]
requires:
  - phase: 07-mcp-polish
    provides: [MCP DTO/error contracts, maintenance storage helpers, MaintenanceService real inputs]
provides:
  - MCP-facing Aura core surfaces for store_code, store_decision, search, stats, insights, maintain, and consolidate
  - Aura-owned contract Record search view with immutable replacement refresh on write-affecting mutations
  - runMaintenance contract-record boundary through brain.cog/brain.snap
  - typed unsupported failures for still-missing Rust-facing surfaces
  - policy surface helpers consuming contract PolicyEngineState directly
affects: [07-07-mcp-transport, 07-08-parity-harness, mcp-tool-inventory]
tech-stack:
  added: []
  patterns:
    - Aura owns normalized cognitive Record view for search and maintenance boundaries
    - Public MCP-facing gaps return UnsupportedSurfaceError instead of Effect.die defects
    - Policy surfacing consumes contract state directly with no local flat adapter
key-files:
  created:
    - .planning/phases/07-mcp-polish/07-03-SUMMARY.md
  modified:
    - packages/core/src/Aura.ts
    - packages/core/src/Aura.test.ts
    - packages/policy/src/Surface.ts
    - packages/policy/src/Surface.test.ts
    - packages/epistemic-runtime/src/EpistemicRuntime.ts
key-decisions:
  - "Search view strategy: Aura owns a Map<string, AuraRecord> populated from loadCognitiveRecords() at open/maintenance time and immutably replaced after store/update/delete/connect."
  - "runMaintenance boundary: brain.cog/brain.snap contract Records are the source of truth; BrainAuraRecord[] remains only for legacy brain.aura listRecords compatibility."
  - "MCP insights contract: TS exposes stats() and insights(); insights() intentionally aliases stats() because Rust MCP calls Aura::stats for the insights tool."
  - "consolidate disposition: explicit UnsupportedSurfaceError until a Rust-parity merge algorithm and coherent index mutation path exist."
  - "Policy surface contract: surfacePolicyHints consumes PolicyEngineState directly; the deprecated flat adapter path was removed from policy and epistemic-runtime."
patterns-established:
  - "MCP core facade first: transport can call Aura methods without reconstructing business logic."
  - "Typed unsupported is the default for missing Rust-facing surfaces; no dummy success counts."
requirements-completed: [REQ-001, REQ-012]
duration: 15min
completed: 2026-05-30T19:41:43Z
---

# Phase 07 Plan 03: MCP Core Facade Summary

**Aura core now owns MCP-facing write/search/maintenance facades with typed unsupported gaps and direct contract-state policy surfacing.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-30T19:27:17Z
- **Completed:** 2026-05-30T19:41:43Z
- **Tasks:** 1 implementation pass
- **Files modified:** 6

## Accomplishments

- Added `Aura.store_code`, `Aura.store_decision`, `Aura.search`, `Aura.stats`, `Aura.insights`, `Aura.maintain`, and `Aura.consolidate`.
- Replaced all public `Effect.die(new UnimplementedError(...))` paths in `Aura.ts` with recoverable `UnsupportedSurfaceError` failures.
- Made `Aura` own an in-memory `Map<string, AuraRecord>` search view populated from `loadCognitiveRecords()` and refreshed by immutable map replacement after `store`, `update`, `delete`, `connect`, and maintenance runs.
- Refactored policy surfacing to consume `PolicyEngineState` / contract `PolicyHint` directly, removing `policyEngineFromState` and the mirrored adapter in `EpistemicRuntime`.

## Boundary Decisions

### runMaintenance Record Boundary

`runMaintenance()` now refreshes from `brain.cog` / `brain.snap` through `loadCognitiveRecords()` before engine orchestration. The `BrainAuraRecord[]` state remains only for `listRecords()` compatibility with the legacy binary `brain.aura` fixture path; it is not the maintenance or search source of truth.

### Search View Strategy

The chosen strategy is immutable replacement. `Aura.open()` loads the cognitive records into `searchRecords`; write-affecting methods construct a new `Map` with the changed record or deletion. `runMaintenance()` refreshes from disk at the start and replaces the view again after maintenance mutations.

Search semantics mirror Rust `Aura::search`: default namespace is `default`, optional case-insensitive query substring match, filters for `level` / `tags` / `content_type` / `source_type` / `semantic_type`, importance ordering, and limit truncation.

### Insights Contract

Rust MCP `insights` calls `self.brain.stats()` rather than `Aura::insights()`. TS therefore exposes both `stats()` and `insights()`, with `insights()` intentionally returning the stats map so 07-07 can wire the MCP handler without rediscovering this naming mismatch.

### Consolidate Disposition

`Aura.consolidate()` returns `UnsupportedSurfaceError`. This is deliberate: 07-02 provided a bounded trigram `NGramIndex` adapter and cognitive store helpers, but not a Rust-parity merge algorithm or coherent mutation path for ngram/tag/aura indexes. Dummy `{ merged: 0, checked: 0 }` success is forbidden and was not implemented.

## Task Commits

1. **Task 1: MCP-facing core surfaces and policy cleanup** - `36edf2b` (feat)

## Files Created/Modified

- `packages/core/src/Aura.ts` - Added MCP-facing facades, search/stats/insights, immutable search view refresh, maintenance boundary refresh, and typed unsupported failures.
- `packages/core/src/Aura.test.ts` - Added store/search/update/connect/delete, typed unsupported, and maintenance record-boundary tests.
- `packages/policy/src/Surface.ts` - Removed local flat adapter and consumes contract `PolicyEngineState` directly.
- `packages/policy/src/Surface.test.ts` - Updated surface tests to build contract policy engine states.
- `packages/epistemic-runtime/src/EpistemicRuntime.ts` - Removed downstream policy adapter reconstruction and delegates contract state directly to `@aura/policy`.
- `.planning/phases/07-mcp-polish/07-03-SUMMARY.md` - Execution record.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed downstream policy adapter dependency**
- **Found during:** Policy surface cleanup.
- **Issue:** Removing the deprecated adapter from `packages/policy/src/Surface.ts` left `packages/epistemic-runtime/src/EpistemicRuntime.ts` as a direct consumer of the same zombie adapter shape.
- **Fix:** Updated EpistemicRuntime surfaced-policy methods to pass `PolicyEngineState` directly to `surfacePolicyHints*`.
- **Files modified:** `packages/epistemic-runtime/src/EpistemicRuntime.ts`
- **Verification:** `bun run typecheck`, `bun run test packages/epistemic-runtime/src/EpistemicRuntime.test.ts`, full suite.
- **Committed in:** `36edf2b`

**Total deviations:** 1 auto-fixed blocking issue.

## Known Stubs

- `packages/core/src/Aura.ts`: `recordImportance()` uses `salience = 0` because contract `Record` does not expose Rust salience yet. This affects only the final 10% salience component of Rust importance ordering.
- `Aura.consolidate()` is explicit typed unsupported, not a fake implementation.

## xxhash Parity Tracking

Central Phase 7 reference for remaining xxhash parity debt:

- `packages/belief/src/BeliefEngine.ts` uses `xxh64` rather than Rust `xxh3_64`.
- `packages/concept/src/ConceptEngine.ts` uses `xxh64` rather than Rust `xxh3_64`.
- `packages/causal/src/CausalEngine.ts` still documents lazy xxhash initialization drift risk.

No new xxhash markers were added in this plan.

## Threat Flags

None. The plan adds local core methods only; no network endpoint, auth path, new file access pattern, or schema trust boundary was introduced.

## Issues Encountered

- `bun run test --filter "@aura/core"` and `bun run test --filter "@aura/policy"` are unsupported by Vitest 2.1.9 (`Unknown option --filter`). File/package-scoped substitutions were run instead.
- Existing untracked `../.codex/`, `.planning/*.lock`, and `.planning/debug/` entries were unrelated and intentionally left untouched.

## Verification

- `bun run typecheck` - passed.
- `bun run test --filter "@aura/core"` - not feasible; Vitest rejects `--filter`.
- `bun run test --filter "@aura/policy"` - not feasible; Vitest rejects `--filter`.
- `bun run test packages/core/src/Aura.test.ts` - passed, 5 tests.
- `bun run test packages/policy/src/Surface.test.ts` - passed, 16 tests.
- `bun run test packages/epistemic-runtime/src/EpistemicRuntime.test.ts` - passed, 45 tests.
- `bun run test packages/core/src packages/policy/src` - passed, 7 files / 85 tests.
- `bun run test` - passed, 43 files / 466 tests.
- `rg "Effect\\.die\\(" packages/core/src/Aura.ts` - no matches.
- `rg "policyEngineFromState|deprecated local|flat container adapter|SurfacePolicy" packages/policy/src packages/epistemic-runtime/src -n` - no matches.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

07-07 can wire MCP handlers to `Aura` for store/write/search/insights/maintain without transport-side business composition. `consolidate` should be exposed as explicit unsupported until a later plan delivers the real merge algorithm and index mutation path.

## Self-Check: PASSED

- FOUND: `.planning/phases/07-mcp-polish/07-03-SUMMARY.md`
- FOUND: `packages/core/src/Aura.ts`
- FOUND: `packages/policy/src/Surface.ts`
- FOUND: commit `36edf2b`
- Stub scan reviewed; only intentional local collection initializers and the documented `salience = 0` / typed unsupported consolidation disposition remain.

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-30*
