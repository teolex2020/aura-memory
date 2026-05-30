---
phase: 07-mcp-polish
plan: 05
subsystem: core
tags: [mcp, explainability, correction-log, recall-trace, governance]
requires:
  - phase: 07-mcp-polish
    provides: [07-04 governance and memory-health read-model zero baselines]
provides:
  - "@aura/recall trace-backed recall evidence bridge"
  - "@aura/core explain_record, explain_recall, and explainability_bundle facades"
  - "Aura-owned in-memory correction log with correction writer/read queues"
  - "Non-zero correction backfill for memory_health, namespace_governance_status, and cross_namespace_digest"
affects: [07-mcp-polish, mcp-transport, explainability, governance]
tech-stack:
  added: []
  patterns: [trace-capable recall helper, Aura-owned runtime correction log, EpistemicRuntime-backed explainability DTOs]
key-files:
  created:
    - packages/recall/src/Trace.ts
    - .planning/phases/07-mcp-polish/07-05-SUMMARY.md
  modified:
    - packages/recall/src/index.ts
    - packages/core/src/Recall.ts
    - packages/core/src/Aura.ts
    - packages/core/src/Aura.test.ts
key-decisions:
  - "Pass A evidence bridge uses a trace-capable @aura/recall helper that reruns collectors/walks in recall order and accumulates per-record signal buckets."
  - "Correction log state is Aura-owned and in-memory, matching Rust runtime Vec<CorrectionLogEntry>; no file-backed correction persistence was added."
  - "Existing engine mutation contracts were sufficient: deprecate_belief, invalidate_pattern, and retract_hint were wired without contract expansion."
requirements-completed: [REQ-001, REQ-012]
duration: 19min
completed: 2026-05-30T20:34:02Z
---

# Phase 07 Plan 05: Explainability and Corrections Summary

**Trace-backed recall explainability with Aura-owned correction writers and non-zero governance backfills.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-05-30T20:14:40Z
- **Completed:** 2026-05-30T20:34:02Z
- **Tasks:** 1 plan task, executed as Pass A/B/C
- **Files modified:** 6

## Pass Checkpoints

- **Pass A - Recall evidence bridge:** Audited `recallPipeline` and found collector/walk intermediate state was local-only. Implemented `recallPipelineWithTrace` as a trace-capable helper in `@aura/recall` that reruns SDR/ngram/tag/embedding collectors, RRF, graph walk, causal walk, trust/recency scoring, and optional rerank/finalize while accumulating per-record evidence.
- **Pass B - Correction write/read path:** Added Aura-owned `correctionLog`, writer facades for `deprecate_belief_with_reason`, `invalidate_causal_pattern_with_reason`, and `retract_policy_hint_with_reason`, plus correction log/filter/review queue reads. Writers call engine mutation methods and persist changed engine state through existing stores.
- **Pass C - Explainability surfaces:** Replaced typed unsupported explainability stubs with `explain_record`, `explain_recall`, `provenance_chain`, and `explainability_bundle` built from recall trace, EpistemicRuntime, engine states, corrections, reflections, and maintenance summaries.

## Evidence Bridge Mapping

- `record_id -> recall signals`: `RecallRecordEvidence.signals` records SDR/ngram/tags/embedding raw score, rank, and RRF share.
- `record_id -> graph/causal/trust/rerank`: `RecallRecordEvidence` records RRF, graph, causal, pre-trust, trust multiplier, pre-rerank, rerank delta, and final score.
- `record_id -> belief hypotheses / contradiction state`: `Aura.buildRecallExplanationItem` uses `EpistemicRuntime.getBeliefForRecord()` and belief fields for unresolved/conflict flags.
- `record_id -> concept candidates`: uses `EpistemicRuntime.getConcepts()` filtered by record or belief membership.
- `record_id -> causal patterns`: uses `EpistemicRuntime.getCausalPatterns()` filtered by record or belief membership, with correction excerpts.
- `record_id -> policy hints`: uses `EpistemicRuntime.getPolicyHints()` filtered by record-side evidence or belief key.

## Correction Writer / Read Model Behavior

- Correction entries are in-memory on the `Aura` instance and include Rust-shaped `timestamp`, `time_iso`, `target_kind`, `target_id`, `operation`, `reason`, and `session_id`.
- `deprecate_belief_with_reason` calls `BeliefEngine.deprecate_belief`, saves `BeliefStore`, and logs `belief/deprecate`.
- `invalidate_causal_pattern_with_reason` calls `CausalEngine.invalidate_pattern`, saves `CausalStore`, and logs `causal_pattern/invalidate`.
- `retract_policy_hint_with_reason` calls `PolicyEngine.retract_hint`, saves `PolicyStore`, and logs `policy_hint/retract`.
- `correction_review_queue`, `contradiction_review_queue`, and `suggested_corrections` are deterministic, bounded, and tested.

## 07-04 Backfill Evidence

The prior 07-04 zero baselines now populate from correction writes:

- `memory_health.recent_correction_count` changes from `0` to `3` in the seeded correction test.
- `namespace_governance_status(["alpha"])[0].correction_count` changes from `0` to `3`.
- `cross_namespace_digest_with_options(["alpha"], { include_dimensions: ["corrections", "beliefs"] }).namespaces[0].correction_count` changes from `0` to `3`.
- Existing zero behavior remains valid when no correction events have occurred.

## Implemented vs Unsupported

Implemented:

- `explain_record`
- `explain_recall`
- `explainability_bundle`
- `provenance_chain`
- `correction_log`
- `get_correction_log_for_target`
- `correction_review_queue`
- `contradiction_review_queue`
- `suggested_corrections`
- Correction-derived governance/health/digest counts

Unsupported residuals:

- None for this plan's explainability/correction surface family.
- Pre-existing unrelated typed unsupported surfaces remain in `Aura.ts`: `consolidate`, relation/entity graph APIs, project graph APIs, and family graph APIs.

## Task Commits

1. **Pass A/B/C implementation** - `5d34ace` (`feat(07-05): implement explainability correction surfaces`)

## Files Created/Modified

- `packages/recall/src/Trace.ts` - Trace-capable recall helper and per-record evidence model.
- `packages/recall/src/index.ts` - Exports trace helper.
- `packages/core/src/Recall.ts` - Provides trace helper through `RecallViewLive`.
- `packages/core/src/Aura.ts` - Adds correction writers/read queues, explainability DTO assembly, and governance backfills.
- `packages/core/src/Aura.test.ts` - Adds non-zero correction writer/read model tests and trace-backed explainability tests.

## Decisions Made

- Built the evidence bridge as a helper rather than modifying `recallPipeline` return type, keeping the existing pipeline contract stable for callers.
- Kept correction log state in-memory on `Aura`, matching Rust runtime ownership and avoiding new persistence surface.
- Did not extend contracts because the required mutation methods already exist in TS contracts and implementations.

## Deviations from Plan

None - plan executed in the requested Pass A, Pass B, Pass C order.

## Issues Encountered

- `bun run test --filter "@aura/core"` is unsupported by the installed Vitest CLI. Used file-scoped tests as the equivalent package-scoped substitute.

## Verification

- `bun run typecheck` - passed.
- `bun run test --filter "@aura/core"` - failed as expected with `Unknown option --filter`.
- `bun run test packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts` - passed, 35 tests.
- `bun run test` - passed, 43 files / 470 tests.
- `rg "explain_recall|explain_record|explainability_bundle|correction_" packages/core/src` - confirmed surfaces and tests are present.

## Known Stubs

- Pre-existing `UNIMPLEMENTED` markers remain for unrelated typed unsupported surfaces in `packages/core/src/Aura.ts`: `consolidate`, relation/entity graph APIs, project graph APIs, and family graph APIs.
- No new plan-blocking stubs were introduced for explainability or correction surfaces.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes were introduced. Correction writers reuse existing engine store persistence paths.

## Self-Check: PASSED

- Found `packages/recall/src/Trace.ts`.
- Found `.planning/phases/07-mcp-polish/07-05-SUMMARY.md`.
- Found implementation commit `5d34ace`.

## Next Phase Readiness

MCP transport can now call `@aura/core` explainability and correction/governance surfaces directly without inventing local business logic. Remaining unrelated unsupported surfaces should stay explicit unless a later plan implements their Rust backing stores.

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-30*
