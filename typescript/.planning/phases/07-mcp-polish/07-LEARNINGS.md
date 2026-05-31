---
phase: 07
phase_name: "mcp-polish"
project: "AuraSDK TypeScript"
generated: "2026-06-01"
counts:
  decisions: 14
  lessons: 9
  patterns: 9
  surprises: 6
missing_artifacts: []
---

# Phase 07 Learnings: MCP + Polish

## Decisions

### D1: Mastra over direct MCP SDK
Mastra (`@mastra/mcp`) was used as the MCP stdio server harness rather than `@modelcontextprotocol/sdk` directly. Installed package types verified `MCPServer.startStdio()` compatibility with Bun/ESM before full scaffold expansion; the direct SDK fallback was never needed.

**Rationale:** Mastra provided higher-level tool registration and capability discovery that passed Bun smoke tests on first attempt.
**Source:** 07-06-SUMMARY.md, 07-RESEARCH.md

---

### D2: Two-layer architecture — core facade + thin MCP transport
All business logic converges on `@aura/core` facades (`Aura.ts` instance methods). `@aura/mcp` handlers only serialize transport payloads and map parameters. No business composition lives in the MCP package.

**Rationale:** Keeps Mastra as pure infrastructure; Rust alignment demands that `Aura` be the single orchestration surface, not split across transport and core.
**Source:** 07-CONTEXT.md (D-08 through D-13), 07-07-SUMMARY.md

---

### D3: Rust snake_case for MCP DTOs, Mcp* prefix for clashing exports
MCP-facing DTOs use Rust/serde `snake_case` field names. When existing `@aura/contract` exports already use the Rust struct name with camelCase fields (e.g., `MaintenanceTrendSnapshot`, `ReflectionSummary`), the MCP variants use `Mcp*` prefix names while keeping Rust-shaped serialization.

**Rationale:** External payloads must be line-traceable to Rust; internal TS consumers must not break.
**Source:** 07-01-SUMMARY.md, STATE.md

---

### D4: Single-brain startup binding
MCP server binds one brain at startup via `AURA_BRAIN_PATH` / `AURA_PASSWORD`, opens one long-lived `Aura` instance, and reuses it for all tool calls. Fails fast at startup if the brain path is missing, format is corrupt, or password is provided (returns `UnsupportedSurfaceError` until encrypted storage exists).

**Rationale:** Matches Rust startup contract exactly; avoids per-tool brain switching complexity.
**Source:** 07-CONTEXT.md (D-04 through D-07), 07-06-SUMMARY.md, 07-REVIEW-FIX.md (CR-01)

---

### D5: Immutable search view with Map replacement
`Aura` owns an in-memory `Map<string, AuraRecord>` search view, populated from `loadCognitiveRecords()` at open/maintenance time and immutably replaced after `store`, `update`, `delete`, `connect`, and maintenance runs.

**Rationale:** Simpler than incremental mutation; avoids stale-index bugs from partial updates; matches Rust's cognitive-record-loaded-then-queried pattern.
**Source:** 07-03-SUMMARY.md, STATE.md

---

### D6: brain.cog/brain.snap as maintenance record source of truth
`runMaintenance()` refreshes from `brain.cog` / `brain.snap` through `loadCognitiveRecords()` before engine orchestration. `BrainAuraRecord[]` remains only for legacy `brain.aura` `listRecords()` compatibility.

**Rationale:** Closes backlog 999.2 `BrainAuraRecord`/`AuraRecord` mismatch without breaking the legacy binary fixture path.
**Source:** 07-03-SUMMARY.md, STATE.md

---

### D7: insights() intentionally aliases stats()
Rust MCP `insights` tool calls `Aura::stats()`. TS therefore exposes both `stats()` and `insights()`, with `insights()` returning the same stats map so MCP handler wiring does not rediscover this naming mismatch at transport time.

**Rationale:** Prevents MCP transport from needing to know about a Rust-vs-MCP naming divergence.
**Source:** 07-03-SUMMARY.md, STATE.md

---

### D8: consolidate is explicit unsupported, not fake success
`Aura.consolidate()` returns `UnsupportedSurfaceError` with Rust reference and missing prerequisites. The tool remains advertised in MCP inventory and test-covered. Dummy `{ merged: 0, checked: 0 }` success was explicitly forbidden.

**Rationale:** Honest unsupported is safer than misleading success; matches the SPEC requirement that unsupported tools be explicit and verifier-visible.
**Source:** 07-03-SUMMARY.md, 07-07-SUMMARY.md

---

### D9: Evidence bridge as separate helper, not pipeline return type change
`recallPipelineWithTrace` was built as a separate `@aura/recall` helper that reruns collectors/walks and accumulates per-record evidence buckets, rather than modifying `recallPipeline`'s existing return type.

**Rationale:** Existing `recallPipeline` contract is stable and called by non-MCP paths; changing its return type would create unnecessary churn.
**Source:** 07-05-SUMMARY.md

---

### D10: Correction log is in-memory, matching Rust runtime ownership
Aura-owned `correctionLog: CorrectionLogEntry[]` is in-memory only, matching Rust's `Vec<CorrectionLogEntry>`. No file-backed correction persistence was added in Phase 7.

**Rationale:** Rust also keeps correction log as runtime state; no new persistence surface needed for MCP correction tools to work.
**Source:** 07-05-SUMMARY.md, STATE.md

---

### D11: Per-field Zod factories to avoid JSON Schema refs
Zod schemas for MCP tool parameters use per-field factory functions instead of reused `z.object({...})` constants because Mastra's MCP client failed to convert ref-backed JSON Schema during `tools/list` discovery.

**Rationale:** Three tools were silently dropped from inventory when refs were present; inline schemas are the only way to guarantee complete tool visibility.
**Source:** 07-06-SUMMARY.md

---

### D12: Canonical TOOL_INVENTORY ledger
A single `TOOL_INVENTORY` array is the source of truth for MCP tool name, status (implemented/unsupported), Rust reference, response media type, and core surface. `TOOL_NAMES` is derived from it so registration, invocation tests, and parity harness cannot drift.

**Rationale:** Prevents tool registration from diverging from test coverage and parity verification.
**Source:** 07-07-SUMMARY.md, STATE.md

---

### D13: Deterministic JSON text error payloads for MCP
Typed core failures (`UnsupportedSurfaceError`, `FileReadError`, etc.) map to deterministic JSON text payloads with `code`, `tag`, `message`, and context-specific fields. This preserves MCP text-content transport while making errors machine-readable.

**Rationale:** Mastra adapter uses text content; JSON-in-text preserves both transport compatibility and structured error information.
**Source:** 07-07-SUMMARY.md

---

### D14: Explicit Rust parity status with golden fallback
Parity status is always explicit: `passed_live_rust` when Rust binary is available, `skipped_no_rust_or_golden` otherwise. The harness never silently claims parity. A prebuilt `aura-mcp.exe` changed status mid-execution from skipped to passed.

**Rationale:** Prevents misleading "parity passed" claims when Rust comparison is unavailable.
**Source:** 07-08-SUMMARY.md, 07-08-VERIFICATION.md

---

## Lessons

### L1: Vitest 2.1.9 does not support --filter
Every plan that specified `bun run test --filter "@aura/<package>"` failed with `Unknown option --filter`. File-scoped paths (`bun run test packages/<pkg>/src/<file>.test.ts`) were the reliable substitute across all Phase 7 plans.

**Context:** This was discovered in 07-01 and repeated across 07-02 through 07-05. Plans should specify file-scoped test commands.
**Source:** 07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md

---

### L2: Mastra peer dependency ranges need explicit pinning
`@mastra/core` default resolution gave `0.16.3`, but `@mastra/mcp@0.13.5` requires `>=0.20.1-0 <0.22.0-0`. Needed explicit `^0.21.0` pin in `package.json`.

**Context:** First-time Mastra integration; the peer dep incompatibility was only caught by typecheck, not by `bun install`.
**Source:** 07-06-SUMMARY.md

---

### L3: Zod ref schemas silently drop MCP tools from inventory
Reused Zod fragments generated JSON Schema `$ref` pointers that Mastra's MCP client could not resolve during `tools/list`. Three tools disappeared from capability discovery with no error — the only symptom was `tools/list` returning fewer tools than registered.

**Context:** Fix required per-field factory functions producing inline JSON Schema. This is a Mastra-specific behavior that would not be obvious from Zod or MCP spec docs alone.
**Source:** 07-06-SUMMARY.md

---

### L4: Layer composition order is load-bearing in Effect
Merging `DefaultLayer` beside platform layers (instead of providing platform layers into `DefaultLayer`) caused silent `FileRead` service missing errors at MCP startup. The failure surfaced as an opaque Effect die, not a clear "missing service" message.

**Context:** Effect's Layer system requires parent layers to provide dependencies that child layers consume; side-by-side merge does not establish the provider relationship.
**Source:** 07-06-SUMMARY.md

---

### L5: Removing a deprecated adapter can break distant consumers
Removing the flat policy adapter from `packages/policy/src/Surface.ts` broke `packages/epistemic-runtime/src/EpistemicRuntime.ts`, which directly consumed the same zombie adapter shape. This was a cross-package dependency not captured by typecheck alone until the removal landed.

**Context:** The adapter existed in policy but was consumed by epistemic-runtime. Cross-package grep before removal would have caught this.
**Source:** 07-03-SUMMARY.md

---

### L6: Rust search tag matching is AND, not OR
TS `Aura.search` originally matched records if they had *any* requested tag (OR semantics). Rust requires *all* requested tags (AND semantics). This was discovered during MCP handler wiring when comparing search behavior against Rust reference.

**Context:** The fix changed filtering to `every(...)` and updated the MCP schema description. This is a semantic parity gap that unit tests would not catch without a Rust oracle.
**Source:** 07-07-SUMMARY.md

---

### L7: MCP test env isolation must explicitly overwrite parent env
MCP child-process env helpers that copy `process.env` then set `AURA_BRAIN_PATH` can still leak the parent's brain path or password if the copy order is wrong. The fix: copy all env first, then force-overwrite `AURA_BRAIN_PATH` and delete `AURA_PASSWORD`.

**Context:** Without this ordering, a developer with `AURA_BRAIN_PATH` already set would have their real brain mutated by write-family parity tests.
**Source:** 07-REVIEW.md (CR-02), 07-REVIEW-FIX.md

---

### L8: Mastra MCPClient requires { context: args } wrapping
Converted Mastra tools expect arguments wrapped in `{ context: args }`, not raw args. Passing raw args produced transport-level validation errors that were not obviously a calling-convention issue.

**Context:** Discovered during parity harness development when write-family tools failed with validation errors despite correct argument shapes.
**Source:** 07-08-SUMMARY.md

---

### L9: Cargo debug build can fill a drive
`cargo build --bin aura-mcp --features mcp` produced enough intermediate artifacts on Windows to fill the D: drive with ENOSPC. The parity harness now checks free disk space before attempting a cargo build.

**Context:** Not a TS issue, but affected the ability to run live Rust parity comparison. The harness still works with a prebuilt binary.
**Source:** 07-08-SUMMARY.md

---

## Patterns

### P1: Rust-shaped DTO with Mcp* prefix for clashing exports
When an `@aura/contract` export already uses the Rust struct name with camelCase fields (e.g., `MaintenanceTrendSnapshot`), define the MCP variant as `McpMaintenanceTrendSnapshot` with Rust snake_case fields. Both types coexist; MCP serialization uses the `Mcp*` variant.

**When to use:** Any time an MCP-facing DTO needs Rust field naming but the Rust struct name is already taken by an internal TS type.
**Source:** 07-01-SUMMARY.md

---

### P2: Thin MCP handler — call core, serialize response
MCP tool handlers follow a strict pattern: extract params from `context`, call one `Aura` method, serialize the result as text or JSON-text. No branching on business state, no direct engine access, no data massaging in the handler.

**When to use:** Every MCP tool handler. Keeps transport swappable and business logic testable without MCP infrastructure.
**Source:** 07-07-SUMMARY.md, 07-CONTEXT.md

---

### P3: Typed unsupported error with Rust reference
When a surface cannot yet be implemented, define a `Data.TaggedError` with `message`, `surface` (e.g., `"Aura.consolidate"`), `rust_reference` (e.g., `"Aura::consolidate (aura.rs)"`), and `missing_prerequisites`. Map it to a deterministic JSON text payload at the MCP boundary.

**When to use:** Any Rust-facing surface that TS cannot yet implement. Never return dummy success; never `Effect.die`.
**Source:** 07-01-SUMMARY.md, 07-07-SUMMARY.md

---

### P4: Aura-owned runtime state with JSON mirror persistence
Maintenance trend history, reflection summaries, and correction log are Aura instance properties (matching Rust runtime ownership). Trends and reflections are persisted to JSON files via `@aura/storage` helpers so they survive reopen; correction log is in-memory only.

**When to use:** For read-model state that MCP governance/health/explainability tools need to query. Write once in core, read from MCP transport.
**Source:** 07-02-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md

---

### P5: Immutable state replacement on mutation
Instead of mutating in-place, write-affecting methods construct a new `Map`/array and replace the instance property. This avoids stale-index bugs and makes the refresh boundary explicit.

**When to use:** For in-memory caches/views that must stay consistent with persisted state after writes.
**Source:** 07-03-SUMMARY.md

---

### P6: Two-layer facade convergence (core facade → EpistemicRuntime)
`Aura` methods for governance/inspection/explainability delegate to `EpistemicRuntime` for raw data, then convert to Rust-shaped DTOs in the core facade. MCP transport receives ready-to-serialize DTOs.

**When to use:** When MCP tools need data that spans multiple engine states. Core composes; MCP serializes.
**Source:** 07-04-SUMMARY.md, 07-05-SUMMARY.md

---

### P7: Canonical inventory ledger with derived name list
Define `TOOL_INVENTORY` as the single array of tool descriptors (name, status, rustRef, responseMedia, coreSurface). Derive `TOOL_NAMES` from it. Tool registration, invocation tests, and parity harness all consume the same ledger.

**When to use:** Any MCP server with 10+ tools where registration/test/parity drift is a risk.
**Source:** 07-07-SUMMARY.md

---

### P8: MCP family-based parity testing
Black-box parity tests are organized into families (write, retrieval, governance). Each family runs a sequence of MCP tool calls through both TS and Rust servers against identical brain fixtures, then compares normalized outputs.

**When to use:** Server-to-server parity verification where identical fixture setup and call sequences can be replayed against both implementations.
**Source:** 07-08-SUMMARY.md

---

### P9: Disk-space guard for optional external builds
Before attempting an optional external build (like `cargo build`), check available disk space against a safe threshold. If below threshold, skip the build and report the reason explicitly rather than failing mid-build.

**When to use:** Any test harness that optionally invokes an external build tool as part of its fixture setup.
**Source:** 07-08-SUMMARY.md

---

## Surprises

### S1: Mastra + Bun + ESM worked on first attempt
Expected significant compatibility issues with Mastra under Bun/ESM given the project's existing `type: module` setup. After resolving the peer dependency version range, `MCPServer.startStdio()` and capability discovery both passed without Bun-specific workarounds.

**Impact:** Avoided the planned `@modelcontextprotocol/sdk` fallback path entirely; reduced 07-06 scope.
**Source:** 07-06-SUMMARY.md

---

### S2: Zod ref schemas silently drop tools with no error
Three MCP tools disappeared from `tools/list` because reused Zod fragments produced JSON Schema `$ref` pointers that Mastra couldn't follow. No error was thrown — the only symptom was missing tools in capability discovery. This was caught by the inventory smoke test that asserted exact tool count.

**Impact:** Required rewriting all tool schemas to use per-field factory functions; the inventory count assertion was the only safety net.
**Source:** 07-06-SUMMARY.md

---

### S3: Layer merge vs provide caused opaque Effect die
Merging `DefaultLayer` beside platform layers (instead of providing platform layers into it) caused a silent `FileRead` service missing error. The error surfaced as an opaque Effect die at MCP startup, not a clear "missing service" diagnostic.

**Impact:** Required understanding Effect's Layer provider semantics to debug; the fix was a one-line change from `Layer.mergeAll` to providing into `DefaultLayer`.
**Source:** 07-06-SUMMARY.md

---

### S4: Rust MCP binary appeared mid-execution
Initially the parity harness reported `skipped_no_rust_or_golden` because the local cargo build failed with ENOSPC. Later, a prebuilt `aura-mcp.exe` became available at `target/debug/aura-mcp.exe`, and the harness advanced to `passed_live_rust` with a generated Rust golden payload.

**Impact:** The parity artifact changed from "no comparison possible" to "live Rust comparison passed" without code changes — only the binary's presence changed.
**Source:** 07-08-SUMMARY.md, 07-08-VERIFICATION.md

---

### S5: @effect/vitest runner mismatch between bun test and bun run test
Running `bun test packages/core/src/Aura.test.ts` directly hit a runner mismatch with `@effect/vitest` that did not occur with `bun run test` (which uses the project's configured Vitest script). The two commands are not equivalent in this workspace.

**Impact:** Test verification commands in plans must use `bun run test` (project Vitest script), not raw `bun test`.
**Source:** 07-07-SUMMARY.md

---

### S6: UAT tests were defined but never executed
The Phase 7 UAT document defined 7 test cases covering MCP startup, write/retrieval flow, maintenance/governance, explainability/correction, unsupported consolidate, parity artifact honesty, and passworded startup. All 7 remain `[pending]` — UAT was deferred in favor of automated verification via the parity harness and test suite.

**Impact:** Automated verification (typecheck + Vitest + MCP parity harness) covers the same surface, but the manual UAT gates were never exercised by a human operator.
**Source:** 07-UAT.md
