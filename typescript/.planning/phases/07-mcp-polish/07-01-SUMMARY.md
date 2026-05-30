---
phase: 07-mcp-polish
plan: 01
subsystem: contract-storage
tags: [mcp, dto, rust-parity, effect, storage]
requires:
  - phase: 06.3-engine-algorithm-parity
    provides: Rust parity discipline and contract export conventions
provides:
  - Rust-shaped MCP DTO families in @aura/contract
  - Typed unsupported/parity error contracts in @aura/contract
  - maintenance_trends.json and reflection_summaries.json storage helpers in @aura/storage
affects: [07-mcp-polish, mcp-transport, governance, explainability, maintenance]
tech-stack:
  added: []
  patterns:
    - Rust/serde-shaped DTOs separated from existing internal camelCase TS inspection types
    - Data.TaggedError domain errors for recoverable unsupported/parity failures
    - CogJsonSnapshotFile-backed persisted maintenance artifact helpers
key-files:
  created:
    - packages/contract/src/McpDtos.ts
    - packages/contract/src/McpDtos.test.ts
    - packages/contract/src/Unsupported.ts
    - packages/storage/src/MaintenanceArtifactFiles.ts
    - packages/storage/src/MaintenanceArtifactFiles.test.ts
  modified:
    - packages/contract/src/index.ts
    - packages/storage/src/index.ts
key-decisions:
  - "MCP-facing DTOs use Rust/serde snake_case field names, while existing internal TS inspection types remain camelCase."
  - "Existing top-level MaintenanceTrendSnapshot and ReflectionSummary exports were not replaced; Rust-shaped MCP variants use Mcp* names to avoid shadowing."
  - "Cross-namespace dimension handling mirrors Rust alias behavior and ignores unknown dimensions."
patterns-established:
  - "Use @aura/contract McpDtos.ts for Phase 7 external payload shapes."
  - "Use @aura/storage MaintenanceArtifactFiles.ts for manifest-declared maintenance artifact persistence."
requirements-completed: [REQ-001, REQ-012]
duration: 10min
completed: 2026-05-30
---

# Phase 07 Plan 01: MCP Contract and Storage Foundation Summary

**Rust-shaped MCP DTO contracts with typed unsupported errors and persisted maintenance artifact helpers**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-30T18:40:17Z
- **Completed:** 2026-05-30T18:50:16Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments

- Added MCP-facing DTO families in `@aura/contract` for explainability, cross-namespace analytics, governance, correction review, memory health, maintenance trends, and reflection summaries.
- Added reusable `UnsupportedSurfaceError` and `ParityContractError` as `Data.TaggedError` domain errors.
- Added `MaintenanceTrendsFile` and `ReflectionSummariesFile` storage helpers using injected file services and `CogJsonSnapshotFile`.
- Added targeted tests for Rust-shaped key stability, dimension flag behavior, typed errors, storage round trips, and manifest compatibility.

## Rust DTO Checklist

Built from concrete Rust definitions in `../src/aura.rs`, `../src/api_groups.rs`, and `../src/background_brain.rs`.

| Family | Rust definition | TS contract |
| --- | --- | --- |
| explainability | `RecallBeliefExplanation` | `RecallBeliefExplanation` |
| explainability | `RecallConceptExplanation` | `RecallConceptExplanation` |
| explainability | `RecallCausalExplanation` | `RecallCausalExplanation` |
| explainability | `RecallPolicyExplanation` | `RecallPolicyExplanation` |
| explainability | `RecallSignalScore` | `RecallSignalScore` |
| explainability | `RecallTraceScore` | `RecallTraceScore` |
| explainability | `HonestAnswerSupport` | `HonestAnswerSupport` |
| explainability | `RecallExplanationItem` | `RecallExplanationItem` |
| explainability | `RecallExplanation` | `RecallExplanation` |
| explainability | `ProvenanceChain` | `ProvenanceChain` |
| explainability bundle | `ExplainabilityBundle.explanation` / explain_record surface | `ExplainabilityBundle.explanation` |
| explainability bundle | `ExplainabilityBundle.provenance` / provenance_chain surface | `ExplainabilityBundle.provenance` |
| explainability bundle | `record_corrections` | `record_corrections` |
| explainability bundle | `belief_corrections` | `belief_corrections` |
| explainability bundle | `causal_corrections` | `causal_corrections` |
| explainability bundle | `policy_corrections` | `policy_corrections` |
| explainability bundle | `belief_instability` | `McpBeliefInstabilitySummary` |
| explainability bundle | `reflection_digest` | `McpReflectionDigest` |
| explainability bundle | `related_reflection_findings` | `McpReflectionFinding[]` |
| explainability bundle | `maintenance_trends` | `McpMaintenanceTrendSummary` |
| analytics/governance | `CrossNamespaceConceptSummary` | `CrossNamespaceConceptSummary` |
| analytics/governance | `CrossNamespaceBeliefStateSummary` | `CrossNamespaceBeliefStateSummary` |
| analytics/governance | `CrossNamespaceNamespaceDigest` | `CrossNamespaceNamespaceDigest` |
| analytics/governance | `CrossNamespacePairDigest` | `CrossNamespacePairDigest` |
| analytics/governance | `CrossNamespaceDigestOptions` | `CrossNamespaceDigestOptions` |
| analytics/governance | `CrossNamespaceDigest` | `CrossNamespaceDigest` |
| analytics/governance | compact summary members: `compact_summary`, `included_dimensions`, empty omitted-dimension arrays | same Rust-shaped fields in options/digest DTOs |
| analytics/governance | `NamespaceGovernanceStatus` | `NamespaceGovernanceStatus` |
| analytics/governance | `MemoryHealthDigest` | `MemoryHealthDigest` |
| operator review | `OperatorReviewIssue` | `OperatorReviewIssue` |
| correction/operator review | `CorrectionLogEntry` | `CorrectionLogEntry` |
| correction/operator review | `CorrectionReviewCandidate` | `CorrectionReviewCandidate` |
| correction/operator review | `ContradictionReviewCandidate` | `ContradictionReviewCandidate` |
| correction/operator review | `SuggestedCorrection` | `SuggestedCorrection` |
| correction/operator review | `SuggestedCorrectionsReport` | `SuggestedCorrectionsReport` |
| maintenance artifacts | `MaintenanceTrendSnapshot` | `McpMaintenanceTrendSnapshot` |
| maintenance artifacts | `MaintenanceTrendSummary` | `McpMaintenanceTrendSummary` |
| maintenance artifacts | `ReflectionFinding` | `McpReflectionFinding` |
| maintenance artifacts | `ReflectionJobReport` | `McpReflectionJobReport` |
| maintenance artifacts | `ReflectionSummary` | `McpReflectionSummary` |
| maintenance artifacts | `ReflectionKindSummary` | `McpReflectionKindSummary` |
| maintenance artifacts | `ReflectionDigest` | `McpReflectionDigest` |

## Field Naming

Default convention for Phase 7 MCP DTOs is Rust/serde payload names. The only documented exception is naming the new maintenance/reflection wire types `McpMaintenanceTrendSnapshot`, `McpMaintenanceTrendSummary`, `McpReflectionSummary`, and related `Mcp*` names because `@aura/contract` already exports internal camelCase types with the Rust struct names from `Maintenance.ts` and `EpistemicInspection.ts`. The MCP-facing field serialization remains Rust-shaped.

## Task Commits

1. **Task 1: MCP contract/storage foundation** - `1c688f9` (feat)

## Files Created/Modified

- `packages/contract/src/McpDtos.ts` - Rust-shaped MCP DTOs and cross-namespace dimension helper.
- `packages/contract/src/McpDtos.test.ts` - DTO shape, dimension, and error contract tests.
- `packages/contract/src/Unsupported.ts` - Typed recoverable unsupported/parity errors.
- `packages/contract/src/index.ts` - Exports MCP DTO and error contracts.
- `packages/storage/src/MaintenanceArtifactFiles.ts` - Storage helpers for `maintenance_trends.json` and `reflection_summaries.json`.
- `packages/storage/src/MaintenanceArtifactFiles.test.ts` - Round-trip and manifest compatibility tests.
- `packages/storage/src/index.ts` - Exports maintenance artifact helpers.

## Decisions Made

- MCP DTOs are separate from internal TS inspection DTOs when existing exports use camelCase fields.
- Timestamp fields remain JSON-safe strings/numbers; no `Date` objects were introduced.
- Correction log persistence was not added; correction log remains an in-memory read model as planned.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The exact plan commands `bun run test --filter "@aura/contract"` and `bun run test --filter "@aura/storage"` are not supported by the installed Vitest CLI (`Unknown option --filter`). File/package-scope alternatives were run instead.
- Initial Vitest execution in the sandbox hit `spawn EPERM` while starting the esbuild helper. The same approved `bun run test` command succeeded outside the sandbox.

## Verification

- `bun run typecheck` - passed.
- `bun run test --filter "@aura/contract"` - not feasible; Vitest 2.1.9 rejects `--filter`.
- `bun run test --filter "@aura/storage"` - not feasible; Vitest 2.1.9 rejects `--filter`.
- `bun run test packages/contract/src/McpDtos.test.ts` - passed, 4 tests.
- `bun run test packages/storage/src/MaintenanceArtifactFiles.test.ts` - passed, 3 tests.
- `bun run test packages/contract/src packages/storage/src` - passed, 18 files / 30 tests.
- `rg "maintenance_trends|reflection_summaries" packages/storage packages/contract` - passed, expected matches in new helpers/tests and manifest.

## Known Stubs

None. Stub scan found only a real `normalized !== null` branch in `McpDtos.ts`.

## Threat Flags

None. The new file-access helpers are the planned manifest-declared maintenance artifact surfaces and use existing injected file services.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Later Phase 7 plans can import MCP DTOs/errors from `@aura/contract` and storage helpers from `@aura/storage` without redefining shapes locally.

## Self-Check: PASSED

- Found `.planning/phases/07-mcp-polish/07-01-SUMMARY.md`.
- Found `packages/contract/src/McpDtos.ts`.
- Found `packages/storage/src/MaintenanceArtifactFiles.ts`.
- Found commit `1c688f9`.

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-30*
