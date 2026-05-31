---
phase: 07-mcp-polish
plan: 07
subsystem: mcp
tags: [mastra, mcp, effect, aura-core, inventory, error-mapping]
requires:
  - phase: 07-mcp-polish
    provides: [Mastra stdio startup, MCP package, Wave 2 core Aura surfaces]
provides:
  - Canonical MCP tool inventory ledger derived from 07-SPEC and reconciled with Rust mcp.rs
  - Invocation coverage for every advertised Phase 7 MCP tool
  - Deterministic typed-error to MCP text payload mapping
  - Rust-shaped JSON-as-text payload adapters for store/search/recall inspection tools
affects: [07-08, mcp-parity, tool-verification]
tech-stack:
  added: []
  patterns: [canonical inventory ledger, typed MCP error text payloads, core-owned inspection report facades]
key-files:
  created: [packages/mcp/src/Invocation.test.ts]
  modified:
    - packages/mcp/src/inventory.ts
    - packages/mcp/src/runtime.ts
    - packages/mcp/src/tools.ts
    - packages/mcp/src/Inventory.test.ts
    - packages/core/src/Aura.ts
key-decisions:
  - "The canonical MCP inventory is TOOL_INVENTORY; TOOL_NAMES is derived from it so registration/tests cannot drift."
  - "Unsupported core typed failures are returned as deterministic JSON text payloads, preserving the MCP text-content transport used by the current Mastra adapter."
  - "policy_lifecycle and belief_instability aggregate Rust MCP payloads in @aura/core facades, keeping @aura/mcp as a thin transport adapter."
patterns-established:
  - "MCP handlers call core Aura surfaces and only serialize/shape transport payloads."
  - "Unsupported MCP surfaces remain advertised and test-covered through the inventory ledger."
requirements-completed: [REQ-001]
duration: 16min
completed: 2026-05-31
---

# Phase 07 Plan 07: MCP Handler Coverage Summary

**Full Phase 7 MCP inventory wired through a canonical ledger with invocation coverage and deterministic typed-error text payloads**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-31T07:03:55Z
- **Completed:** 2026-05-31T07:19:10Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments

- Reconciled the required Phase 7 MCP inventory from `07-SPEC.md` and Rust `mcp.rs` into `TOOL_INVENTORY`.
- Added invocation coverage proving every advertised MCP tool executes and returns a text payload.
- Added deterministic mapping for typed core failures, including explicit unsupported handling for `consolidate`.
- Aligned key Rust outward payload decisions: JSON bodies remain serialized text strings for store/search/structured inspection tools.
- Added core report facades for `policy_lifecycle` and `belief_instability` so MCP handlers do not compose business logic.

## Tool Inventory Ledger

| Tool | Status | Core Surface | Response |
|------|--------|--------------|----------|
| recall | implemented | Aura.recall_structured adapter | text |
| recall_structured | implemented | Aura.recall_structured | text-json |
| store | implemented | Aura.store | text-json |
| store_code | implemented | Aura.store_code | text-json |
| store_decision | implemented | Aura.store_decision | text-json |
| search | implemented | Aura.search | text-json |
| insights | implemented | Aura.insights | text-json |
| maintain | implemented | Aura.maintain | text-json |
| cross_namespace_digest | implemented | Aura.cross_namespace_digest_with_options | text-json |
| explain_record | implemented | Aura.explain_record | text-json |
| explain_recall | implemented | Aura.explain_recall | text-json |
| explainability_bundle | implemented | Aura.explainability_bundle | text-json |
| correction_log | implemented | Aura.get_correction_log | text-json |
| correction_review_queue | implemented | Aura.correction_review_queue | text-json |
| contradiction_review_queue | implemented | Aura.contradiction_review_queue | text-json |
| suggested_corrections | implemented | Aura.suggested_corrections | text-json |
| namespace_governance_status | implemented | Aura.namespace_governance_status | text-json |
| policy_lifecycle | implemented | Aura.policy_lifecycle_report | text-json |
| belief_instability | implemented | Aura.belief_instability_report | text-json |
| memory_health | implemented | Aura.memory_health | text-json |
| consolidate | unsupported | Aura.consolidate | text-json error |

## MCP Error Mapping

| Core error tag | MCP code | Payload fields |
|----------------|----------|----------------|
| UnsupportedSurfaceError | unsupported_surface | message, surface, rust_reference, missing_prerequisites |
| FileReadError | file_read_error | message, path |
| FileWriteError | file_write_error | message, path |
| FileFormatError | file_format_error | message, path |
| JsonParseError | json_parse_error | message |
| IndexFormatError | index_format_error | message |
| SdrInterpreterError | sdr_interpreter_error | message |
| EmbeddingQueryError | embedding_query_error | message |
| RerankError | rerank_error | message |
| FinalizeError | finalize_error | message |
| other/unknown | unknown_error | message |

Unsupported response contract:

```json
{"ok":false,"error":{"code":"unsupported_surface","tag":"UnsupportedSurfaceError","message":"...","surface":"Aura.consolidate","rust_reference":"Aura::consolidate (aura.rs)","missing_prerequisites":["..."]}}
```

TS-only `maintain` response contract: JSON serialized as MCP text content, containing the core `MaintenanceReport` returned by `Aura.maintain()`.

## Task Commits

1. **Task 1: Complete MCP handler coverage** - `4df57c7` (feat)

## Files Created/Modified

- `packages/mcp/src/Invocation.test.ts` - Covers every advertised tool invocation and unsupported error payload.
- `packages/mcp/src/inventory.ts` - Adds canonical inventory ledger and derives tool names from it.
- `packages/mcp/src/runtime.ts` - Adds deterministic typed-error mapping to JSON text payloads.
- `packages/mcp/src/tools.ts` - Maps Rust-shaped text/JSON-text outputs and delegates to core surfaces.
- `packages/mcp/src/Inventory.test.ts` - Verifies inventory uniqueness and explicit unsupported status.
- `packages/core/src/Aura.ts` - Adds report facades and fixes search tag filtering to require all requested tags.

## Decisions Made

- `TOOL_INVENTORY` is the single ledger for MCP tool name, status, Rust reference, response media, and core surface.
- `consolidate` remains advertised but explicitly unsupported because core correctly fails with `UnsupportedSurfaceError`.
- `policy_lifecycle` and `belief_instability` use new core report facades so `@aura/mcp` only serializes the core response.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Rust search tag parity**
- **Found during:** Task 1
- **Issue:** TS search matched any requested tag while Rust requires all requested tags.
- **Fix:** Changed `Aura.search` tag filtering to `every(...)` and corrected the MCP schema description.
- **Files modified:** `packages/core/src/Aura.ts`, `packages/mcp/src/inventory.ts`
- **Verification:** `bun run typecheck`, `bun run --cwd packages/mcp test`, and targeted core Vitest run passed.
- **Committed in:** `4df57c7`

---

**Total deviations:** 1 auto-fixed bug
**Impact on plan:** Required for Rust MCP parity; no additional product scope added.

## Known Stubs

- `packages/core/src/Aura.ts` still intentionally exposes `Aura.consolidate` as `UnsupportedSurfaceError`; this is the explicit unsupported MCP path covered by `TOOL_INVENTORY` and `Invocation.test.ts`.
- Existing `NON-PARITY IMPLEMENTATION` comments in `Aura.recall*` and maintenance persistence remain pre-existing tracked parity gaps; this plan kept MCP outward media decisions explicit and verifier-visible.

## Issues Encountered

- `bun test packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts` hit an existing runner mismatch with `@effect/vitest`; rerunning the same files through the configured Vitest script passed.

## Verification

- `bun run typecheck` — passed
- `bun run --cwd packages/mcp test` — passed, 4 files / 7 tests
- `bun run test packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts` — passed, 2 files / 35 tests

## User Setup Required

None.

## Next Phase Readiness

Plan 07-08 can consume `TOOL_INVENTORY` directly for final parity verification and does not need to rediscover advertised, implemented, or unsupported MCP surfaces.

## Self-Check: PASSED

- Found `.planning/phases/07-mcp-polish/07-07-SUMMARY.md`
- Found `packages/mcp/src/Invocation.test.ts`
- Found task commit `4df57c7`

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-31*
