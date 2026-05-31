---
phase: 07-mcp-polish
reviewed: 2026-05-31T08:52:14Z
review_type: fix_re-review
source_review: .planning/phases/07-mcp-polish/07-REVIEW.md
status: clean
fixed: 4
skipped: 0
blockers_remaining: 0
warnings_remaining: 0
files_reviewed:
  - packages/core/src/Aura.ts
  - packages/core/src/Aura.test.ts
  - packages/mcp/src/tools.ts
  - packages/mcp/src/Invocation.test.ts
  - packages/mcp/src/StdioSmoke.test.ts
  - packages/mcp/src/Parity.test.ts
  - .planning/phases/07-mcp-polish/07-08-VERIFICATION.md
  - .planning/phases/07-mcp-polish/07-08-MCP-PARITY.json
verification_note: "Orchestrator reported bun run typecheck, bun run --cwd packages\\mcp test, and bun run test passing; this re-review inspected the fixes and artifacts without rerunning tests."
---

# Phase 07 Fix Re-Review

## Summary

All four original findings from `07-REVIEW.md` are resolved. No blocker remains.

The parity artifact still reports `skipped_no_rust_or_golden` because Rust/golden comparison was unavailable due insufficient disk for the safe cargo preflight, but the TS harness now records the intended normalization behavior and the orchestrator-reported TypeScript test suite passed.

## Verified Fixes

### CR-01: Fixed

`Aura.open_with_password()` now rejects passworded opens with `UnsupportedSurfaceError` instead of delegating to unencrypted `Aura.open()`. `openAuraRuntime()` still routes any defined `AURA_PASSWORD` into this path, so stdio startup no longer silently ignores a password.

Evidence: `packages/core/src/Aura.ts:194`, `packages/core/src/Aura.test.ts:76`, `packages/mcp/src/runtime.ts:61`.

### CR-02: Fixed

Both MCP child-process env helpers now copy inherited environment values first, then force `AURA_BRAIN_PATH` to the temp brain and delete `AURA_PASSWORD`. This prevents parent brain/password settings from leaking into stdio and parity tests.

Evidence: `packages/mcp/src/StdioSmoke.test.ts:20`, `packages/mcp/src/Parity.test.ts:97`.

### CR-03: Fixed

The MCP `recall` handler now passes `context.token_budget ?? 2048` into a Rust-shaped context formatter. The formatter implements the same level grouping and budget allocation as the Rust `format_context()` path, including the identity reserve behavior. A unit test covers a small budget excluding oversized recalled content.

Evidence: `packages/mcp/src/tools.ts:76`, `packages/mcp/src/tools.ts:193`, `packages/mcp/src/Invocation.test.ts:140`, Rust reference checked at `../src/recall.rs:593`.

### WR-01: Fixed

Parity normalization now replaces generated record IDs, ISO timestamp strings, timestamp/timing numeric fields, rounds floats, sorts JSON keys, and trims trailing whitespace for non-JSON text. The generated verification note documents that media type changes and missing/extra fields are still compared.

Evidence: `packages/mcp/src/Parity.test.ts:221`, `packages/mcp/src/Parity.test.ts:243`, `packages/mcp/src/Parity.test.ts:281`, `.planning/phases/07-mcp-polish/07-08-VERIFICATION.md`, `.planning/phases/07-mcp-polish/07-08-MCP-PARITY.json`.

## Verification

Accepted orchestrator verification:

- `bun run typecheck` passed.
- `bun run --cwd packages\mcp test` passed, 5 files / 10 tests.
- `bun run test` passed, 48 files / 481 tests.

No source code was modified during this re-review.
