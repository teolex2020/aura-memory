---
phase: 07-mcp-polish
plan: 06
subsystem: mcp
tags: [mcp, mastra, stdio, bun, zod]
requires:
  - phase: 07-mcp-polish
    provides: [operational core surfaces through 07-03 and governance/explainability/correction surfaces through 07-05]
provides:
  - "@aura/mcp workspace package"
  - "Mastra stdio MCP entrypoint bound to one Aura brain at startup"
  - "Full locked Phase 7 tool inventory registration"
  - "Bun/ESM compatibility and stdio inventory smoke tests"
affects: [07-07, 07-08, mcp-parity, tool-handlers]
tech-stack:
  added: [@mastra/core, @mastra/mcp, zod]
  patterns: [thin MCP handlers over @aura/core, env-bound long-lived Aura runtime, schema inventory centralization]
key-files:
  created:
    - packages/mcp/package.json
    - packages/mcp/src/bin.ts
    - packages/mcp/src/server.ts
    - packages/mcp/src/runtime.ts
    - packages/mcp/src/tools.ts
    - packages/mcp/src/inventory.ts
    - packages/mcp/src/*test.ts
  modified:
    - bun.lock
    - tsconfig.json
key-decisions:
  - "Mastra was retained because installed docs/types verified MCPServer.startStdio() under Bun/ESM."
  - "The direct @modelcontextprotocol/sdk fallback was not used; Mastra stdio startup and capability discovery passed."
  - "Tool schemas avoid reused Zod fragments because Mastra MCP client conversion dropped ref-backed schemas during stdio inventory discovery."
patterns-established:
  - "MCP startup: resolve AURA_BRAIN_PATH or ./aura_brain, pass AURA_PASSWORD to Aura.open_with_password, open once, reuse runtime."
  - "MCP tools: schemas and inventory live in inventory.ts; handlers in tools.ts stay thin and delegate to @aura/core."
requirements-completed: [REQ-001]
duration: 62min
completed: 2026-05-31
---

# Phase 07 Plan 06: MCP Stdio Scaffold Summary

**Mastra-backed `@aura/mcp` stdio package with env-bound Aura startup and full Phase 7 inventory smoke-tested over MCP stdio**

## Performance

- **Duration:** 62 min
- **Started:** 2026-05-31T04:40:42Z
- **Completed:** 2026-05-31T05:42:47Z
- **Tasks:** 1
- **Files modified:** 12

## Accomplishments

- Created `@aura/mcp` as a workspace package with explicit `aura-mcp` bin entrypoint.
- Added Mastra MCP dependencies and verified Bun/ESM compatibility before full scaffold expansion.
- Registered the full locked Phase 7 tool inventory up front and added tests for direct inventory plus real stdio capability discovery.
- Implemented Rust-aligned startup binding: `AURA_BRAIN_PATH`, `AURA_PASSWORD`, `./aura_brain` fallback, one long-lived `Aura` instance.

## Task Commits

1. **Task 1: MCP stdio package scaffold** - `1813394` (feat)

## Files Created/Modified

- `packages/mcp/package.json` - Declares `@aura/mcp`, Mastra/Zod dependencies, scripts, and explicit bin/export paths.
- `packages/mcp/src/bin.ts` - Stdio process entrypoint with fail-fast startup error reporting.
- `packages/mcp/src/server.ts` - Constructs `MCPServer` and starts stdio.
- `packages/mcp/src/runtime.ts` - Resolves env startup contract and opens one Aura runtime.
- `packages/mcp/src/inventory.ts` - Central locked Phase 7 tool names and Zod schemas.
- `packages/mcp/src/tools.ts` - Thin request-to-core handler registration.
- `packages/mcp/src/*test.ts` - Mastra compatibility, full inventory, and stdio smoke tests.
- `tsconfig.json` - Adds `@aura/mcp` path aliases.
- `bun.lock` - Locks Mastra MCP dependency graph.

## Decisions Made

- Mastra was used, not the fallback. Installed package types verified `MCPServer.startStdio()` and the targeted tests verified stdio tool discovery under Bun.
- `@mastra/core` was pinned to the peer-compatible `^0.21.0` range required by installed `@mastra/mcp@0.13.5`.
- Zod schema fragments are created per field instead of reused constants because reused fragments generated JSON Schema refs that Mastra's MCP client failed to convert during `tools/list`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected Mastra peer dependency**
- **Found during:** Task 1 dependency compatibility spike
- **Issue:** Initial `@mastra/core` range resolved to `0.16.3`, while installed `@mastra/mcp@0.13.5` requires `>=0.20.1-0 <0.22.0-0`.
- **Fix:** Updated `packages/mcp/package.json` to `@mastra/core: ^0.21.0` and regenerated `bun.lock`.
- **Verification:** `bun run typecheck`
- **Committed in:** `1813394`

**2. [Rule 1 - Bug] Fixed runtime layer composition**
- **Found during:** stdio smoke test
- **Issue:** `DefaultLayer` was merged beside platform layers instead of being provided by them, so the server failed fast with missing `FileRead`.
- **Fix:** Provided the node platform layer into `DefaultLayer` and still merged platform services for direct core effects.
- **Verification:** `bun run --cwd packages\mcp test`
- **Committed in:** `1813394`

**3. [Rule 1 - Bug] Removed schema refs that hid inventory tools**
- **Found during:** stdio smoke test
- **Issue:** Mastra client conversion dropped three tools whose JSON Schemas contained internal refs from reused Zod fragments.
- **Fix:** Changed schema helpers to factories so each property emits inline JSON Schema.
- **Verification:** `bun run --cwd packages\mcp test`
- **Committed in:** `1813394`

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** All fixes were required for Bun/ESM compatibility and complete inventory discovery; no scope beyond MCP package scaffolding.

## Issues Encountered

- Vitest/esbuild required sandbox escalation to spawn worker processes on Windows.
- `bun install` required sandbox escalation because Bun could not write its temp directory inside the default sandbox.

## Known Unsupported Surfaces

- `consolidate` is registered and delegates to `Aura.consolidate()`, which currently returns the core typed `UnsupportedSurfaceError` until a Rust-parity merge/update path exists. The tool is intentionally visible rather than omitted.

## Verification

- `bun run typecheck` - passed
- `bun run --cwd packages\mcp test` - passed, 3 files / 3 tests
- Stdio smoke - passed via `MCPClient.getTools()` against `packages/mcp/src/bin.ts`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The MCP package can be launched deterministically through `packages/mcp/src/bin.ts`. Plan 07-07 can expand or refine handler payload parity without rediscovering startup, dependency, or inventory semantics.

## Self-Check: PASSED

- Found `.planning/phases/07-mcp-polish/07-06-SUMMARY.md`
- Found `packages/mcp/src/bin.ts`, `packages/mcp/src/server.ts`, and `packages/mcp/src/inventory.ts`
- Found implementation commit `1813394`

---
*Phase: 07-mcp-polish*
*Completed: 2026-05-31*
