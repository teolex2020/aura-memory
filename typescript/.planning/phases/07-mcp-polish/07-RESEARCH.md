# Phase 07: MCP + Polish - Research

**Date:** 2026-05-30
**Phase:** 07-mcp-polish
**Status:** Ready for planning

## Summary

Phase 7 is no longer just "add an MCP shell". After codebase research and a user clarification on 2026-05-30, this phase now has to do four things together:

1. Close the old structural backlog folded in from `999.1` and `999.2`.
2. Finish the remaining D-07 maintenance debt that would otherwise make `maintain`, `insights`, `memory_health`, and explainability/governance tools shallow or misleading.
3. Add a Mastra-based MCP stdio package that exposes the full declared inventory.
4. Prove tool-level Rust parity with an automated MCP server-to-server harness.

This is a full-surface phase. The safe planning strategy is to build shared DTO/persistence foundations first, then complete maintenance/core facades, then add the MCP transport layer, and only then lock parity at the server boundary.

## Locked Constraints

### From Phase 7 SPEC/CONTEXT

- Full Phase 7 only; no reduced slice.
- Tool delivery may be wave-based, but final scope must reach the full declared inventory.
- Mastra is server/test infrastructure only; Aura domain logic stays in `@aura/*`.
- Startup contract matches Rust: `AURA_BRAIN_PATH`, `AURA_PASSWORD`, default fallback `./aura_brain`.
- MCP entry points must converge on `@aura/core`, not on direct `@aura/*` fan-out from the MCP package.
- Output shape follows Rust MCP externally; when Rust returns text content, TS must also return text content.
- Unsupported handling, if still needed anywhere, must be explicit, deterministic, test-covered, and visible in final verification.

### User Clarification Added During Planning

- The remaining D-07 maintenance algorithm debt is now part of Phase 7.
- The old pending todo items for `MaintenanceService` and Policy surface cleanup were folded into this phase and removed from `.planning/todos/pending/`.

## Current Codebase Reality

### What already exists and can be reused

- `packages/core/src/Aura.ts`
  - Has real `store`, `update`, `delete`, `connect`, `recall`, `recall_structured`, `recall_full`, `runMaintenance`.
- `packages/core/src/MaintenanceService.ts`
  - Has the orchestration skeleton and some real engine sequencing.
- `packages/contract/src/EpistemicRuntime.ts` and `packages/epistemic-runtime/src/EpistemicRuntime.ts`
  - Already expose `belief_instability`, `policy_lifecycle`, contradiction clusters, surfaced concepts, surfaced policy hints, and policy pressure reports.
- `packages/storage/src/PersistenceManifest.ts`
  - Already reserves manifest surface versions for `maintenance_trends` and `reflection_summaries`.
- The workspace is green on `bun run typecheck` as of 2026-05-30, which means this phase starts from a stable compile baseline.

### Structural gaps in TS today

- No `@aura/mcp` package exists.
- No `@mastra/*` or `zod` dependency exists in the workspace yet.
- `Aura.ts` still contains public `Effect.die(new UnimplementedError(...))` methods for MCP-relevant surfaces.
- `MaintenanceService.ts` still contains:
  - 5 `type ... = unknown` placeholders.
  - 15 D-07 deferred/stub markers.
- `packages/policy/src/Surface.ts` still depends on a deprecated local flat adapter shape.
- The TS contract package does not yet define the Rust-like DTO families needed for:
  - explainability bundles
  - correction logs/review queues
  - namespace governance summaries
  - memory-health digests
  - cross-namespace digest payloads

### Persistence/read-model gaps that directly affect MCP parity

- `maintenance_trends` and `reflection_summaries` are present in the manifest version map but have no concrete file helpers yet.
- No TS-side correction-log persistence/read model is exposed today.
- `Aura.runMaintenance()` still runs against a code path that was previously flagged for `BrainAuraRecord`/`AuraRecord` mismatch risk in review.

## Rust-to-TS Surface Mapping

| MCP tool | Rust backing | TS status now | Planning implication |
|----------|--------------|---------------|----------------------|
| `recall` | `Aura::recall` | partial | existing TS method exists, but Rust-shaped MCP response still missing |
| `recall_structured` | `Aura::recall_structured` | partial | existing TS method exists, but output DTO parity still missing |
| `store` | `Aura::store` | partial | existing TS method exists |
| `store_code` | `Aura::store` wrapper | missing | add core helper, then MCP handler |
| `store_decision` | `Aura::store` wrapper | missing | add core helper, then MCP handler |
| `search` | `Aura::search` | missing | add real TS core surface |
| `insights` | `Aura::stats` | missing | add core surface; may need maintenance-derived data |
| `maintain` | maintenance orchestration | partial | TS exists, but maintenance debt must be closed |
| `cross_namespace_digest` | `Aura::cross_namespace_digest_with_options` | missing | requires DTO + facade + algorithm parity |
| `explain_record` | `Aura::explain_record` | defect | currently `Effect.die` |
| `explain_recall` | `Aura::explain_recall` | defect | currently `Effect.die` |
| `explainability_bundle` | `Aura::explainability_bundle` | missing | requires explainability + maintenance history + corrections |
| `correction_log` | correction API | missing | requires persistence/read model |
| `correction_review_queue` | correction API | missing | requires review-priority logic |
| `contradiction_review_queue` | operator/correction API | missing | can reuse contradiction clusters, but queue logic is missing |
| `suggested_corrections` | operator/correction API | missing | requires read-model and prioritization logic |
| `namespace_governance_status` | governance API | missing | depends on instability + correction + maintenance summaries |
| `policy_lifecycle` | operator API | partial | runtime primitives exist; core facade still missing |
| `belief_instability` | operator API | partial | runtime primitives exist; core facade still missing |
| `memory_health` | operator API | missing | depends on maintenance summaries + corrections + instability |
| `consolidate` | `Aura::consolidate` | missing | add core surface and parity checks |

## Backlog Items Now Folded Into This Phase

### Former `999.1`

- Remove `unknown` placeholder types from `MaintenanceService.ts`.
- Replace public `Effect.die(...)` defects in `Aura.ts` with recoverable, typed failures for MCP-facing surfaces.
- Remove or consolidate stale D-07 markers so the remaining TODOs are accurate and searchable.

### Former `999.2`

- Fix `Aura.runMaintenance()` so it operates on contract-compatible record data without unsafe `BrainAuraRecord` casting assumptions.
- Clean up Policy surface type adaptation and remove the zombie adapter path.
- Centralize or eliminate cross-engine xxhash NON-PARITY tracking.

### Newly folded D-07 maintenance debt

The following are not optional anymore because they feed tool-level parity:

- `runInitialPhases` stubs
- `buildSdrLookup` stub
- `runDiscoveryPhases` feedback stub
- `runPostDiscoveryPhases` stubs
- `buildReflectionSummary` stubs
- persisted maintenance trend/reflection outputs

## Mastra Research Notes

### Official docs checked

- Mastra MCP server reference: `https://mastra.ai/en/reference/tools/mcp-server`
- Mastra `createTool` reference: `https://mastra.ai/reference/agents/createTool`

### What is planning-safe to assume from those docs

- Mastra has an official MCP server abstraction and a dedicated tool-definition flow.
- Tool definitions are schema-driven rather than ad hoc string parsing.
- The MCP package should stay thin and primarily do:
  - tool schema declaration
  - env/bootstrap/startup wiring
  - request-to-core mapping
  - core-error to MCP-error mapping

### What still must be re-verified during execution

The exact Mastra bootstrap call names, constructor options, and stdio start API should be re-opened from the official docs immediately before implementation. Phase 7 planning should not hard-code speculative method names if they have not been verified in the live docs on execution day.

## Recommended Architecture Split

### `@aura/contract`

- Add MCP-facing DTOs, enums, and typed error contracts.
- Keep unsupported/error shapes centralized here where cross-package consumers can share them.

### `@aura/storage`

- Add verified file helpers for persisted maintenance artifacts already listed in the manifest.
- Reuse shared JSON snapshot helpers where possible; do not create one-off JSON code paths.

### `@aura/core`

- Be the only layer that the MCP package talks to.
- Own MCP-facing facades and wrappers around `Aura`.
- Reuse `EpistemicRuntime` for read-only inspections.
- Reuse/complete `MaintenanceService` for write-side maintenance and derived artifacts.

### `@aura/mcp`

- New workspace package.
- Mastra-only boundary.
- Owns tool registration, startup binding, and Rust-shaped response serialization.

### Parity harness

- Launch TS MCP and Rust MCP against the same brain fixtures/directories.
- Compare per-call MCP payloads and per-family end-state outputs.

## Wave Recommendation

### Wave 1: Shared foundations and maintenance debt

- Add contract DTOs/errors and storage helpers.
- Finish maintenance parity and persisted maintenance outputs.
- Close `999.1` / `999.2` structural issues in `@aura/core`.

### Wave 2: Missing core facades

- Add governance/inspection surfaces.
- Add explainability/correction surfaces.

### Wave 3: MCP transport layer

- Add `@aura/mcp`.
- Register the full inventory and wire all tool handlers.

### Wave 4: Tool-level parity proof

- Run the MCP server-to-server verifier and close verification gaps.

## Validation Architecture

### Automated gates required for every plan

- `bun run typecheck`
- Targeted vitest package tests
- Tool inventory coverage tests once `@aura/mcp` exists
- MCP stdio smoke tests once the server package exists

### Final Phase 7 parity bar

- Inventory coverage: every declared tool is advertised and invocable.
- Write family parity: at least one `store`-family flow compared against Rust.
- Retrieval family parity: `recall` / `recall_structured` / `search`.
- Maintenance/inspection parity: `maintain` plus at least one governance/health family.
- Explainability/correction parity: explicit comparison rules with normalized noise only.

## Planning Pitfalls

1. Do not let `@aura/mcp` become a second orchestration layer.
2. Do not ship governance/health tools on top of the current maintenance skeleton and call that parity.
3. Do not add DTOs locally in `@aura/core` if they are shared structs/enums; they belong in `@aura/contract`.
4. Do not silently omit tools that lack implementation; omission fails the phase harder than explicit unsupported.
5. Do not hard-code Mastra APIs from memory when the docs can be re-opened during execution.

## Sources

### Primary

- `.planning/phases/07-mcp-polish/07-SPEC.md`
- `.planning/phases/07-mcp-polish/07-CONTEXT.md`
- `.planning/phases/06.2-epistemicruntime-maintain-maintenanceservice-rust/06.2-CONTEXT.md`
- `.planning/phases/06.3-engine-algorithm-parity/06.3-REVIEW.md`
- `packages/core/src/Aura.ts`
- `packages/core/src/MaintenanceService.ts`
- `packages/epistemic-runtime/src/EpistemicRuntime.ts`
- `packages/policy/src/Surface.ts`
- `packages/storage/src/PersistenceManifest.ts`
- `../src/mcp.rs`
- `../src/aura.rs`
- `../src/api_groups.rs`

### Official external docs

- `https://mastra.ai/en/reference/tools/mcp-server`
- `https://mastra.ai/reference/agents/createTool`

## Metadata

- Research mode: inline, code-first, no subagents spawned
- Phase impact: high
- Recommended plan count: 8
- Recommended waves: 4
