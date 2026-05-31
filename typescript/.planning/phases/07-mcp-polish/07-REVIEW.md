---
phase: 07-mcp-polish
reviewed: 2026-05-31T08:36:14Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - packages/contract/src/McpDtos.ts
  - packages/contract/src/McpDtos.test.ts
  - packages/contract/src/Unsupported.ts
  - packages/contract/src/index.ts
  - packages/storage/src/MaintenanceArtifactFiles.ts
  - packages/storage/src/MaintenanceArtifactFiles.test.ts
  - packages/storage/src/index.ts
  - packages/core/src/MaintenanceService.ts
  - packages/core/src/MaintenanceService.test.ts
  - packages/core/src/Aura.ts
  - packages/core/src/Aura.test.ts
  - packages/core/src/Recall.ts
  - packages/policy/src/Surface.ts
  - packages/policy/src/Surface.test.ts
  - packages/epistemic-runtime/src/EpistemicRuntime.ts
  - packages/recall/src/Trace.ts
  - packages/recall/src/index.ts
  - packages/mcp/package.json
  - packages/mcp/src/bin.ts
  - packages/mcp/src/server.ts
  - packages/mcp/src/runtime.ts
  - packages/mcp/src/tools.ts
  - packages/mcp/src/inventory.ts
  - packages/mcp/src/index.ts
  - packages/mcp/src/Inventory.test.ts
  - packages/mcp/src/MastraCompat.test.ts
  - packages/mcp/src/StdioSmoke.test.ts
  - packages/mcp/src/Invocation.test.ts
  - packages/mcp/src/Parity.test.ts
  - tsconfig.json
findings:
  critical: 3
  warning: 1
  info: 0
  total: 4
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-05-31T08:36:14Z  
**Depth:** standard  
**Files Reviewed:** 30  
**Status:** issues_found

## Summary

Reviewed the Phase 07 MCP polish implementation from the 07-01 through 07-08 summaries plus the dirty `StdioSmoke.test.ts` path fix. The MCP package is broadly wired through the inventory, but there are three blocker-level correctness/security issues in stdio/runtime behavior and the recall handler, plus one brittle parity-harness defect that will fail once Rust or golden comparison is available.

## Critical Issues

### CR-01: AURA_PASSWORD Is Accepted But Ignored

**Classification:** BLOCKER  
**File:** `packages/mcp/src/runtime.ts:61`, `packages/core/src/Aura.ts:194`  
**Issue:** The MCP runtime treats `AURA_PASSWORD` as supported by dispatching to `Aura.open_with_password()`, but `Aura.open_with_password()` discards `_password` and delegates to `Aura.open()`. This silently opens the brain without password/encryption behavior, so users who launch stdio with `AURA_PASSWORD` get neither Rust parity nor the security property implied by the environment contract.

**Fix:**
```ts
// Short-term safe behavior until encrypted AuraStorage parity exists:
if (env.AURA_PASSWORD !== undefined) {
  throw new Error("AURA_PASSWORD is not supported by the TypeScript MCP runtime yet.")
}
const open = Aura.open(brainPath)
```

Or implement `Aura.open_with_password()` against the Rust-compatible encrypted storage path and add a stdio startup test that proves passworded and unpassworded brains do not interchange.

### CR-02: Stdio/Parity Tests Can Write To The Caller Brain Instead Of The Temp Brain

**Classification:** BLOCKER  
**File:** `packages/mcp/src/Parity.test.ts:98`, `packages/mcp/src/StdioSmoke.test.ts:20`  
**Issue:** Both `envWithBrain()` helpers initialize `AURA_BRAIN_PATH` to a fresh temp directory, then copy `process.env` over it. If the developer or CI environment already has `AURA_BRAIN_PATH` set, the child MCP server ignores the temp brain. `Parity.test.ts` then runs write-family tools and can mutate a real configured brain, while also invalidating the isolation of the parity run.

**Fix:**
```ts
function envWithBrain(brainPath: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.AURA_BRAIN_PATH = brainPath
  delete env.AURA_PASSWORD
  return env
}
```

Apply the same ordering in both tests; keep password-specific behavior in an explicit password test instead of inheriting it from the parent process.

### CR-03: MCP `recall` Ignores `token_budget`

**Classification:** BLOCKER  
**File:** `packages/mcp/src/tools.ts:78`  
**Issue:** `recallSchema` advertises `token_budget` as accepted for Rust MCP parity, and Rust passes it to `brain.recall(...)`. The TS handler ignores `context.token_budget` and calls `recall_structured()`, then joins every returned record content. This breaks the main context-injection contract and can return materially larger context than the caller requested.

**Fix:**
```ts
execute: async ({ context }) =>
  runText(
    runtime,
    runtime.aura.recall_text(context.query, {
      tokenBudget: context.token_budget,
      namespaces: namespaces(context.namespace),
    }),
  )
```

If the core text recall surface is not available yet, add one rather than handling this as transport-only formatting; it should be tested against a small token budget with multiple matching records.

## Warnings

### WR-01: Parity Harness Compares Dynamic IDs And Timestamps Verbatim

**Classification:** WARNING  
**File:** `packages/mcp/src/Parity.test.ts:62`  
**Issue:** The live/golden parity comparison includes `store`, `store_code`, `store_decision`, search, recall, and governance outputs, but normalization only sorts keys and rounds floats. Core store still generates random IDs and real timestamps, so live TS-vs-Rust or TS-vs-golden comparison will fail on otherwise equivalent payloads as soon as Rust or a golden file is available.

**Fix:** Either make the fixture deterministic through an injected ID/clock source, or normalize dynamic fields with stable placeholders before comparison, for example mapping record IDs by creation order/content and normalizing timestamp/time fields while still preserving field presence and media shape.

---

_Reviewed: 2026-05-31T08:36:14Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
