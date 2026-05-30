# Phase 7: MCP + Polish — Specification

**Created:** 2026-05-30
**Ambiguity score:** 0.10 (gate: ≤ 0.20)
**Requirements:** 7 locked

## Goal

Phase 7 delivers a Mastra-based MCP stdio server for the TypeScript Aura workspace, exposes the full Phase 7 MCP tool inventory with no silent omissions, closes backlog items `999.1` and `999.2` in full, and proves parity-grade end-to-end behavior against the Rust reference on the same brain fixtures/directories.

## Background

The current TypeScript workspace has no MCP package, no `@mastra/*` dependencies, and no Phase 7 directory yet. The existing workspace packages are `@aura/*` libraries only, with `@aura/core` exposing runtime methods such as `store`, `update`, `delete`, `connect`, `recall`, `recall_structured`, `recall_full`, and `runMaintenance`. Several public surfaces that matter to an MCP server are still incomplete: `Aura.ts` still contains `Effect.die(new UnimplementedError(...))` public APIs, and `MaintenanceService.ts` still contains placeholder `unknown` types and many D-07 deferred markers. The Rust reference already has a concrete MCP stdio server in `../src/mcp.rs` with a large tool surface, so Phase 7 is the first phase where the TypeScript port must become externally callable through an MCP-compatible transport and then verified against the Rust reference at the server/tool level, not only library/unit-test level.

The user locked four key decisions during the interview:

1. This phase must be the full Phase 7, not a reduced slice.
2. Tool delivery must be wave-based but end in full declared coverage.
3. Mastra is only the MCP server/test harness base; Aura domain logic remains in existing `@aura/*` packages.
4. Backlog `999.1` and `999.2` are not optional cleanup; both must be fully closed inside this phase.

## Requirements

1. **Mastra-based MCP package**: A TypeScript workspace package for the Aura MCP server exists and starts over stdio.
   - Current: No `@aura/mcp`-style package exists, no `@mastra/*` dependency is installed, and no TS MCP stdio entrypoint is present.
   - Target: A workspace package dedicated to MCP exists, uses Mastra as the server/tool harness, and can initialize a stdio MCP server for Aura against a configured brain directory.
   - Acceptance: `package.json` for the MCP package exists in `packages/`; `bun run typecheck` passes with Mastra integrated; an automated smoke test or scripted check proves the TS server initializes and reports MCP tool capability over stdio.

2. **Complete declared tool inventory**: Phase 7 defines and exposes the full MCP tool inventory with no silent omissions.
   - Current: The TS workspace exposes library methods only; there is no MCP tool registration layer.
   - Target: The TS MCP server declares an explicit tool inventory covering the Phase 7 server surface: `recall`, `recall_structured`, `store`, `store_code`, `store_decision`, `search`, `insights`, `maintain`, `cross_namespace_digest`, `explain_record`, `explain_recall`, `explainability_bundle`, `correction_log`, `correction_review_queue`, `contradiction_review_queue`, `suggested_corrections`, `namespace_governance_status`, `policy_lifecycle`, `belief_instability`, `memory_health`, and `consolidate`.
   - Acceptance: An automated inventory test verifies every required tool name is advertised by the TS MCP server; every advertised tool is invocable; any tool that cannot yet be implemented must still be advertised and must return a deterministic MCP “not supported” error response that is explicitly listed in this phase’s execution artifacts.

3. **Mastra boundary preservation**: Mastra is used only as MCP/server/test infrastructure, not as a replacement for Aura domain logic.
   - Current: The project is a Bun + effect-smol monorepo with business logic already split across `@aura/core`, `@aura/recall`, `@aura/storage`, `@aura/indexing`, and epistemic engine packages.
   - Target: Mastra code is confined to the new MCP package and related E2E/test harnesses; Aura business logic, persistence, recall, maintenance, and epistemic behavior remain implemented in the existing `@aura/*` packages.
   - Acceptance: New `@mastra/*` imports are limited to the MCP server layer and test harness code; no existing `@aura/core`, `@aura/storage`, `@aura/recall`, `@aura/indexing`, or epistemic engine package is rewritten to depend on Mastra for business logic.

4. **Backlog 999.1 fully closed**: The MaintenanceService/Aura TODO cleanup backlog is fully resolved.
   - Current: `packages/core/src/MaintenanceService.ts` still has placeholder `unknown` type aliases (`SDRInterpreter`, `TagTaxonomy`, `NGramIndex`, `CognitiveStore`, `BackgroundBrain`), and `packages/core/src/Aura.ts` still exposes public `Effect.die(new UnimplementedError(...))` methods. Review TODOs also call out stale/scattered D-07 deferred markers.
   - Target: All `999.1` items are closed in code, not merely documented: placeholder unknown types are replaced or eliminated, public Aura APIs no longer fail via `Effect.die` for planned MCP-facing surfaces, and stale D-07 TODO tracking is removed or consolidated to accurate locations.
   - Acceptance: `rg "type .* = unknown" packages/core/src/MaintenanceService.ts` returns no matches; `rg "Effect\\.die\\(" packages/core/src/Aura.ts` returns no matches for public API methods; review items TODO-W01, TODO-W02, and TODO-W03 from `.planning/phases/06.3-engine-algorithm-parity/06.3-REVIEW.md` are fully resolved in the codebase and phase verification artifacts.

5. **Backlog 999.2 fully closed**: Cross-engine NON-PARITY and type-consistency backlog is fully resolved.
   - Current: Backlog `999.2` tracks scattered NON-PARITY markers, the `Aura.runMaintenance()` `BrainAuraRecord`/`AuraRecord` mismatch, and Policy surface type adaptation gaps; the 06.3 review also records these as active warnings/TODOs.
   - Target: The cross-engine parity-tracking debt is closed: `Aura.runMaintenance()` no longer relies on the incompatible `BrainAuraRecord` cast path, Policy surface types are aligned or adapted explicitly to contract types, and xxhash-related NON-PARITY tracking is centralized or eliminated consistently across engines.
   - Acceptance: `Aura.runMaintenance()` loads or converts records through a contract-compatible path without `BrainAuraRecord -> AuraRecord` unsafe casting; Policy surface helpers accept contract-aligned types or a documented adapter; all remaining xxhash-related NON-PARITY markers use one shared tracking reference or are removed because the parity gap is closed.

6. **Parity-grade E2E verification**: Phase 7 adds automated E2E verification at the MCP server/tool level against the Rust reference.
   - Current: The workspace has fixture-level parity tests for lower-level recall/storage behavior, but no MCP server package and no server-to-server parity harness.
   - Target: Automated E2E coverage launches the TS MCP server and the Rust reference MCP server against the same fixture brain directories and compares normalized behavior/results at the tool level.
   - Acceptance: The Phase 7 test suite exercises the TS MCP server on shared fixture data and verifies parity at least for one write family (`store`/`update`/`delete`/`connect` or their exposed MCP equivalents), one retrieval family (`recall`/`recall_structured`/`search`), and one maintenance/inspection family (`maintain`, `insights`, or equivalent bounded governance/health tools); the comparison rules are explicit and automated in test code or verifier artifacts.

7. **Wave-complete delivery with explicit unsupported handling**: Phase 7 only counts as done when all planned waves are complete and any residual unsupported tools are explicit, bounded, and verifier-visible.
   - Current: There is no Phase 7 plan, no wave structure, and no standard TS MCP error contract for unsupported tools.
   - Target: Execution is broken into waves that cumulatively reach full declared inventory coverage; if any tool remains unsupported at the end of a wave, that unsupported status is intentional, documented, and validated by tests rather than hidden by omission or hard crashes.
   - Acceptance: Phase 7 planning artifacts define wave ownership of the full tool inventory; final verification shows every required tool is either implemented successfully or returns the standardized unsupported MCP response covered by automated tests; no required tool is missing from the server because it was silently skipped.

## Boundaries

**In scope:**
- A new Phase 7 directory under `.planning/phases/07-mcp-polish/` with discuss/plan/execute artifacts derived from this SPEC.
- A new TypeScript MCP server package using Mastra as the MCP server/tool harness.
- MCP stdio startup and initialization for the TypeScript Aura implementation.
- Full declared MCP tool inventory for Phase 7, including explicit handling of temporarily unsupported tools.
- Automated E2E verification that compares TS MCP behavior with the Rust reference on the same brain fixtures/directories.
- Full closure of backlog `999.1` and `999.2` in code and verification artifacts.
- Tool-surface stabilization needed to make MCP/E2E possible, including Aura/MaintenanceService fixes that are directly part of `999.1` and `999.2`.

**Out of scope:**
- Replacing Aura business logic with Mastra primitives — excluded because Mastra is only the server/test base in this phase.
- New browser UI, dashboard, or HTTP server work — excluded because project non-goals still rule those out.
- Backlog `999.3` (`@aura/utils` dedup/refactor) — excluded because the user only pulled `999.1` and `999.2` into Phase 7.
- Broad algorithm redesign beyond what is necessary to close `999.1`/`999.2` and satisfy MCP parity — excluded because Phase 06.3 already locked engine parity scope.
- Non-MCP feature expansion unrelated to parity/server readiness — excluded to prevent polish work from swallowing unrelated product work.

## Constraints

- Runtime remains Bun + ESM; Mastra integration must be compatible with the project’s existing `type: module` workspace setup.
- Mastra API usage must be based on current official documentation, not recalled from memory.
- Mastra is restricted to the MCP package and test harnesses; Aura core logic remains in `@aura/*`.
- The server transport for this phase is stdio, matching the project goal and the Rust reference server shape.
- Tool parity is defined against the Rust reference MCP surface and/or normalized Rust backend behavior on the same brain directory.
- Public MCP-facing failures must be recoverable and verifier-visible; hard crashes through `Effect.die` are not acceptable for planned MCP surfaces.
- Backlog `999.1` and `999.2` are mandatory closure criteria, not stretch goals.

## Acceptance Criteria

- [ ] A new TypeScript MCP package exists in the workspace and initializes over stdio.
- [ ] Mastra is installed and used only in the MCP package and related test harness code.
- [ ] The TS MCP server advertises the full declared Phase 7 tool inventory with no silent omissions.
- [ ] Every required tool is covered by an automated invocation test that proves either success or the standardized explicit unsupported response.
- [ ] Backlog `999.1` is fully closed, including removal/replacement of `unknown` placeholder types and elimination of public `Effect.die` API defects in `Aura.ts`.
- [ ] Backlog `999.2` is fully closed, including the `runMaintenance()` record-type mismatch and Policy surface/type-consistency issues.
- [ ] An automated E2E suite runs the TS MCP server against shared fixture brain directories and compares normalized results with the Rust reference at the tool level.
- [ ] The final Phase 7 verification artifacts explicitly show which tools are implemented and, if any remain unsupported, which tools return the standardized unsupported MCP response.

## Ambiguity Report

| Dimension           | Score | Min   | Status | Notes |
|---------------------|-------|-------|--------|-------|
| Goal Clarity        | 0.95  | 0.75  | ✓      | Full Phase 7 outcome explicitly locked |
| Boundary Clarity    | 0.86  | 0.70  | ✓      | Mastra-only-as-base and backlog pull-in are explicit |
| Constraint Clarity  | 0.84  | 0.65  | ✓      | Bun/ESM, stdio, parity, backlog closure all explicit |
| Acceptance Criteria | 0.90  | 0.70  | ✓      | Pass/fail checkboxes and tool-level parity defined |
| **Ambiguity**       | 0.10  | ≤0.20 | ✓      | Ready for discuss-phase |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective | Question summary | Decision locked |
|-------|-------------|------------------|-----------------|
| 1 | Researcher | Is Phase 7 a reduced slice or the full MCP/polish phase? | Full Phase 7 only; no reduced slice |
| 1 | Simplifier | Should backlog cleanup stay separate? | `999.1` and `999.2` are pulled into Phase 7 and must be solved |
| 1 | Boundary Keeper | Is wave-based delivery allowed to stop early? | No; delivery may be wave-based but must end in full declared coverage |
| 2 | Boundary Keeper | What counts as “full coverage” for MCP tools? | Full external tool inventory; any unsupported tool must be explicit, not silently omitted |
| 2 | Researcher | What is Mastra allowed to own? | Mastra is only the MCP server/test harness base; Aura logic stays in `@aura/*` |
| 2 | Failure Analyst | What is the minimum acceptable E2E bar? | Parity-grade E2E against the Rust reference on the same brain fixtures/directories |
| 2 | Seed Closer | Are `999.1` and `999.2` partial or total closures? | Both backlog items must be fully closed in this phase |

---

*Phase: 07-mcp-polish*
*Spec created: 2026-05-30*
*Next step: $gsd-discuss-phase 7 — implementation decisions (how to build what's specified above)*
