# PROJECT.md

## Project

**Name:** Aura TypeScript Port

**Goal:** 1:1 TypeScript rewrite of Rust Aura core with full disk-format compatibility, using Bun runtime and effect-smol layering.

**Scope:**
- Core library (open/store/recall/search/update/delete/maintain/insights)
- MCP stdio server
- Effect-smol dependency injection and platform abstraction
- Byte-level disk format compatibility with Rust

**Non-Goals:**
- HTTP server / dashboard
- Browser/Worker runtime
- Performance exceeding Rust
- Python or UI components

**Success Metric:** TS and Rust can read/write the same brain directory; recall pipeline outputs match deterministically; all M1-M4 milestones pass cross-language fixture tests.

**Target Runtime:** Bun (TypeScript, effect-smol style)

## Decisions

- **D1:** Runtime = Bun (not Node, not Browser)
- **D2:** Framework = effect-smol (Context/Layer DI)
- **D3:** Disk format compatibility over performance
- **D4:** MCP stdio only (no HTTP server)
- **D5:** Read-first, then write (M1→M2→M3→M4)
- **D6:** FileRead vs FileWrite split for testability
- **D7:** No cross-package relative imports (only @aura/*)
- **D8:** Optional services for recall pipeline
- **D9:** Recall-first implementation order
- **D10:** SIMPLE/FULL IMPLEMENTATION comment markers mandatory

## Constraints

- Disk format byte-level compatible (Rust ↔ TS)
- effect-smol layering: core/storage/codec/indexing/mcp only via @aura/*
- node:* only in @aura/platform-node and test glue
- All packages must have package.json with name: @aura/<pkg>, type: module, exports

## Current State

**Phase 06.3 (Engine Algorithm Parity) complete** — 11/11 plans executed. All four engines (BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine) aligned with Rust algorithm implementations. 14/14 AUDIT-DIFF deviations resolved. 449/450 tests pass. Rust fixture E2E verified. Next: Phase 7 (MCP + Polish).

## Requirements

### Validated in Phase 06.3

- REQ-011: Per-engine type-level parity — 19 constants/thresholds/formulas verified against Rust source
- REQ-012: Rust fixture E2E verification — 3 fixture sets cross-referenced, recall parity confirmed

Last updated: 2026-05-30
