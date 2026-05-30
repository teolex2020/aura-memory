---
phase: 07-mcp-polish
plan: 04
subsystem: core
tags: [mcp, governance, memory-health, epistemic-runtime, cross-namespace-digest]
requires:
  - phase: 07-mcp-polish
    provides: "07-01/07-02/07-03 core Aura search/stats/maintain/consolidate foundations and persisted maintenance artifacts"
provides:
  - "@aura/core governance and operator-facing facades for belief_instability, policy_lifecycle, namespace_governance_status, memory_health, and cross_namespace_digest"
  - "Rust-shaped policy lifecycle DTO family in @aura/contract"
  - "Seeded multi-namespace test proving cross_namespace_digest is not an all-zero baseline"
affects: [07-05, 07-06, 07-07, mcp-transport, operator-read-models]
tech-stack:
  added: []
  patterns:
    - "Aura facades delegate read-model aggregation to EpistemicRuntime where available"
    - "Correction-derived fields are explicit zero baselines until 07-05 writers exist"
key-files:
  created:
    - .planning/phases/07-mcp-polish/07-04-SUMMARY.md
  modified:
    - packages/contract/src/McpDtos.ts
    - packages/core/src/Aura.ts
    - packages/core/src/Aura.test.ts
key-decisions:
  - "belief_instability and policy_lifecycle are Aura facades over EpistemicRuntime, then converted to Rust-shaped DTOs."
  - "cross_namespace_digest implements Rust option handling and include_dimensions alias behavior in core, not MCP transport."
  - "correction and salience-backed health/governance fields remain deterministic zero baselines until 07-05 supplies correction writers and salience parity."
patterns-established:
  - "Core read facades return Rust/MCP snake_case DTOs at the Aura boundary."
  - "Non-vacuous governance tests must assert at least one digest dimension is non-zero."
requirements-completed: [REQ-001, REQ-012]
duration: 14min
completed: 2026-05-30
---

# Phase 07 Plan 04: Governance Core Facades Summary

**Aura-owned governance and memory-health read models with EpistemicRuntime-backed instability/policy summaries and non-vacuous cross-namespace digest evidence.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-30T19:53:49Z
- **Completed:** 2026-05-30T20:07:40Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added `Aura` facades for `belief_instability`, `policy_lifecycle`, `cross_namespace_digest`, `namespace_governance_status`, and `memory_health`.
- Added Rust-shaped `McpPolicyLifecycleSummary`, action/domain summaries, and policy pressure DTOs in `@aura/contract`.
- Implemented cross-namespace option clamping, `include_dimensions` alias handling, pairwise similarity, concept/tag/structural/causal/belief-state dimensions, and explicit correction zero-baselines.
- Added targeted core tests proving deterministic payloads and a multi-namespace digest with non-zero tag/concept/belief-state evidence.

## Task Commits

1. **Task 1: Governance and operator-facing core facades** - `9b5c57f` (`feat`)

## Files Created/Modified

- `packages/core/src/Aura.ts` - Adds the read facades, Rust-aligned cross-namespace digest helpers, DTO conversion helpers, memory health digest, and namespace governance aggregation.
- `packages/core/src/Aura.test.ts` - Adds seeded multi-namespace digest and operator governance facade tests.
- `packages/contract/src/McpDtos.ts` - Adds Rust-shaped policy lifecycle and policy pressure DTOs.
- `.planning/phases/07-mcp-polish/07-04-SUMMARY.md` - Execution summary and readiness notes.

## Per-Surface Inputs

- `cross_namespace_digest`: namespace filters, `min_record_count`, clamped `top_concepts_limit` 1-10, clamped `pairwise_similarity_threshold` 0-1, `compact_summary`, and `include_dimensions` aliases for concepts/tags/structural/causal/beliefs/corrections.
- `namespace_governance_status`: in-memory Aura record namespaces, EpistemicRuntime beliefs, EpistemicRuntime policy pressure, latest maintenance trend snapshot, and staged zero correction/suggestion counts.
- `memory_health`: Aura record count, EpistemicRuntime instability/lifecycle/policy pressure/high-volatility beliefs/contradiction clusters, persisted reflection summaries, persisted maintenance trends, and staged zero correction/salience fields.
- `belief_instability`: EpistemicRuntime `getBeliefInstabilitySummary()`.
- `policy_lifecycle`: EpistemicRuntime `getPolicyLifecycleSummary()`.

## Primitive Audit

| Primitive | TS status | 07-04 disposition |
| --- | --- | --- |
| concept overlap | ConceptEngine state exists | Built now via canonical concept signatures and Jaccard pair scoring |
| shared tags | Record tags exist | Built now via lowercased namespace tag sets and Jaccard pair scoring |
| structural overlap | `connection_types` exists on contract Record | Built now for `family.*` and `belongs_to_project` relation kinds |
| causal-signature overlap | CausalEngine state exists | Built now via cause/effect record signature terms |
| belief-state summaries | BeliefEngine/EpistemicRuntime state exists | Built now per namespace from belief key prefixes |
| correction counts | Correction writers/log are 07-05 scope | Explicit zero/empty baseline with `correction_count: 0` and `correction_density: 0` when included |

## MemoryHealthDigest Field Checklist

| Rust field | TS source in 07-04 |
| --- | --- |
| `total_records` | `Aura.searchRecords.size` |
| `startup_has_recovery_warnings` | Zero baseline `false`; TS startup validation report is not modeled yet |
| `high_salience_record_count` | Zero baseline `0`; contract Record has no Rust salience field yet |
| `avg_salience` | Zero baseline `0`; contract Record has no Rust salience field yet |
| `max_salience` | Zero baseline `0`; contract Record has no Rust salience field yet |
| `reflection_summary_count` | `summarizeReflections(this.reflectionSummaries).summaryCount` |
| `reflection_high_severity_findings` | `summarizeReflections(...).highSeverityFindings` |
| `contradiction_cluster_count` | EpistemicRuntime `getContradictionClusters(...).length` |
| `high_volatility_belief_count` | EpistemicRuntime instability summary |
| `low_stability_belief_count` | EpistemicRuntime instability summary |
| `recent_correction_count` | Zero baseline `0`; 07-05 correction log writer/read model backfills |
| `suppressed_policy_hint_count` | EpistemicRuntime policy lifecycle summary |
| `rejected_policy_hint_count` | EpistemicRuntime policy lifecycle summary |
| `policy_pressure_area_count` | EpistemicRuntime `getPolicyPressureReport(...).length` |
| `maintenance_trend_direction` | Rust-equivalent trend pressure delta over persisted maintenance trends |
| `latest_dominant_phase` | `summarizeTrends(this.maintenanceTrendHistory).latestDominantPhase` |
| `top_issues` | High-volatility beliefs, contradiction clusters, reflection findings, and policy pressure areas |

## Non-Vacuous Fixture Evidence

The new `Aura.test.ts` seeded fixture creates `alpha` and `beta` namespaces with shared `deploy`/`ops` tags, stable concepts with matching canonical signatures, and an `alpha` high-volatility belief. Assertions verify:

- `digest.namespace_count === 2`
- `included_dimensions === ["concepts", "tags", "belief_states", "corrections"]`
- at least one pair has `tag_jaccard > 0` or `concept_signature_similarity > 0`
- at least one namespace has `belief_state_summary.high_volatility_count === 1`
- correction fields are present and explicitly zero

This prevents an all-zero cross-namespace baseline from passing.

## Deviations from Plan

None - plan executed within the declared files and surfaces.

## Known Stubs

- `memory_health` salience fields are deterministic zero baselines because TS `Record` does not yet expose Rust `salience`.
- `memory_health`, `namespace_governance_status`, and `cross_namespace_digest` correction-derived fields are deterministic zero baselines until 07-05 adds correction writers/read models.
- Existing unsupported explainability/relation/consolidation comments remain in `Aura.ts`; they are pre-existing or prior-plan typed unsupported surfaces, not new 07-04 stubs.

## Threat Flags

None - this plan adds read-only in-process facades and no new network endpoints, auth paths, file access patterns, or schema changes.

## Verification

- `bun run typecheck` - passed.
- `bun run test --filter "@aura/core"` - unsupported by Vitest 2.1.9 (`Unknown option --filter`).
- Substitution: `bun run test packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts` - passed, 33 tests.
- `bun run test --filter "@aura/epistemic-runtime"` - unsupported by Vitest 2.1.9.
- Substitution: `bun run test packages/epistemic-runtime/src/EpistemicRuntime.test.ts` - passed, 45 tests.
- Additional DTO gate: `bun run test packages/contract/src/McpDtos.test.ts` - passed, 4 tests.

## Issues Encountered

- Vitest in this workspace does not support the requested `--filter` flag, so package-scoped verification was replaced with file-scoped test runs.
- Unrelated untracked files existed after SDK/test activity: `../.codex/`, `.planning/ROADMAP.md.lock`, `.planning/STATE.md.lock`, and `.planning/debug/`. They were left untouched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

07-05 can replace the correction zero-baseline fields with real correction log/review/suggestion data without changing the 07-04 DTO shapes. The MCP transport can call `Aura` directly for these read-model families instead of composing governance payloads in the MCP package.

## Self-Check: PASSED

- Found `.planning/phases/07-mcp-polish/07-04-SUMMARY.md`.
- Found implementation commit `9b5c57f`.
- No tracked files were deleted by the implementation commit.

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-30*
