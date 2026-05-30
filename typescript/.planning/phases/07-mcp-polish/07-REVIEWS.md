---
phase: 7
reviewers: [claude]
reviewed_at: 2026-05-30T21:51:57.1362855+08:00
plans_reviewed:
  - 07-01-PLAN.md
  - 07-02-PLAN.md
  - 07-03-PLAN.md
  - 07-04-PLAN.md
  - 07-05-PLAN.md
  - 07-06-PLAN.md
  - 07-07-PLAN.md
  - 07-08-PLAN.md
---

# Cross-AI Plan Review - Phase 7

## Claude Review

### Summary

The 8 plans form a coherent wave structure (foundations -> facades -> MCP transport -> parity harness) that matches the research recommendations. However, multiple plans have scope-versus-reality gaps: they promise to "implement" maintenance stubs and explainability surfaces whose Rust counterparts depend on entire subsystems (`SDRInterpreter`, `TagTaxonomy`, `NGramIndex`, `CognitiveStore`, `BackgroundBrain`) that do not exist in TypeScript and were explicitly deferred from prior phases. The plans currently conflate "replace unknown placeholders" with "build the missing subsystems," which sets execution up to either stall or silently degrade into broad unsupported markings. The dependency chain from `07-02` -> `07-04` -> `07-05` is the main single point of failure; if maintenance debt cannot be fully closed, governance, explainability, and correction tools all lose their data foundation.

### Strengths

- Wave ordering is correct: shared DTOs and storage before core facades, core before MCP transport, and MCP before parity harness.
- Backlog closure is operationalized with grep-verifiable checks for `unknown` placeholders and `Effect.die(...)` defects.
- Mastra boundary discipline is preserved: `@aura/mcp` stays transport-only and `@aura/core` remains the sole orchestration entry.
- The unsupported contract is correctly scoped to `@aura/contract` as a reusable typed error, not an ad hoc MCP-layer string.
- `07-06` correctly requires re-verifying Mastra bootstrap APIs during execution rather than assuming recalled method names.
- `07-08` correctly treats sequential state accumulation as a way to expose parity drift, not noise to be eliminated.

### Concerns

- HIGH: `07-02` is currently unbounded relative to the actual TS implementation baseline. It asks for broad maintenance algorithm completion across `runInitialPhases`, `buildSdrLookup`, feedback handling, `runPostDiscoveryPhases`, and `buildReflectionSummary`, but the Rust counterparts rely on large subsystems that do not exist in TS yet.
- HIGH: `07-02` says to replace five `unknown` placeholders with "real imports" even though those placeholders stand for entire missing subsystems (`SDRInterpreter`, `TagTaxonomy`, `NGramIndex`, `CognitiveStore`, `BackgroundBrain`). The plan needs an explicit typed-shim vs. real-implementation distinction.
- HIGH: `07-05` assumes explainability tools can be implemented on top of the current recall surface, but TS recall currently exposes shallow scored records rather than Rust-style provenance-rich explanation structures. Without a recall explainability bridge, this risks violating the no-shrunken-success rule.
- HIGH: `07-08` assumes the Rust MCP binary can be launched in the Phase 7 test environment, but the plan does not define how that binary is built, discovered, or skipped on Windows/Bun environments if unavailable.
- HIGH: `07-05` plans correction read surfaces without also planning the correction write operations that would populate the log/queue data. Always-empty correction artifacts would not meet meaningful parity.
- MEDIUM: `07-03` identifies the `runMaintenance()` record-type mismatch but does not specify which data model boundary is the correct fix (`BrainAuraRecord[]`, `AuraRecord[]`, or dual-path handling).
- MEDIUM: `07-04` under-specifies the actual data sources and dimension inputs required for `cross_namespace_digest`.
- MEDIUM: `07-04` and `07-05` have a hidden circular data dependency: `memory_health` wants correction data from `07-05`, while `explainability_bundle` wants maintenance outputs surfaced earlier by `07-04`.
- MEDIUM: `07-03` scopes Policy surface cleanup, but the same zombie adapter path may still survive inside `EpistemicRuntime`.
- MEDIUM: `07-06` and `07-07` do not currently include an explicit Mastra-on-Bun compatibility spike or fallback strategy.
- LOW: `07-01` should enumerate the DTO families more explicitly so the executor does not have to rediscover them from Rust sources.
- LOW: centralizing xxhash `NON-PARITY IMPLEMENTATION:` tracking may add indirection if the scatter is already small.
- LOW: `07-08` is ambiguous about whether `recall_parity/` fixtures are sufficient for the broader MCP tool inventory.
- LOW: verification sections across plans are still broad "targeted tests" placeholders rather than concrete test categories and fixtures.

### Suggestions

1. Split `07-02` into a typed-shim pass and an algorithm-completion pass, with an explicit gate after the first pass that decides which missing subsystems remain unsupported versus implemented.
2. Add a recall explainability bridging task before or inside `07-05` so `explain_recall` / `explain_record` can be built on real intermediate recall evidence.
3. Expand `07-05` to include correction write operations such as belief deprecation / causal invalidation / policy retraction, or explicitly mark those tool families unsupported pending a later phase.
4. Add a Mastra compatibility spike at the top of `07-06` to verify Bun + ESM startup before building the full server scaffold.
5. Define the Rust MCP binary contract in `07-08`: how it is built, how it is located, and what explicit skip/fallback behavior is allowed if the toolchain is unavailable.
6. Add an incremental implemented-vs-unsupported decision table to each plan output instead of deferring the full accounting to `07-08`.

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `07-02` stalls on non-existent subsystems | High | High | Split into typed shims plus algorithm-only pass; bound unsupported paths early |
| Explainability rides on shallow recall data | High | Medium | Add recall evidence bridge before implementing explainability tools |
| Correction surfaces have no write path | Medium | Medium | Add correction writes or explicitly unsupported the read surfaces |
| Rust MCP binary unavailable in parity harness | Medium | High | Define build/discovery/skip contract in `07-08` |
| Mastra incompatible with Bun/ESM runtime | Medium | High | Add a compatibility spike and fallback strategy in `07-06` |
| `07-04` / `07-05` data dependency gaps cause rework | Medium | Medium | Define the minimal cross-plan interfaces explicitly |
| Policy surface cleanup misses the runtime adapter path | Low | Low | Expand `07-03` scope to include `EpistemicRuntime` adapter cleanup |

## Consensus Summary

Single-reviewer cycle with `claude`. No cross-reviewer disagreements are available yet, so the consensus summary records the highest-signal findings from this cycle.

### Agreed Strengths

- The overall wave ordering is sound and matches the real dependency graph of the workspace.
- The plan correctly keeps `@aura/mcp` thin and routes business logic through `@aura/core`.
- Backlog `999.1` / `999.2` closure is attached to concrete verification hooks rather than vague documentation updates.

### Agreed Concerns

- `07-02` currently mixes "replace placeholder types" with "build entire missing subsystems," which makes the phase vulnerable to an early stall.
- `07-05` over-promises explainability and correction coverage without first adding the richer recall evidence and correction write paths those tools depend on.
- `07-08` lacks an explicit Rust MCP binary contract, so the final parity harness could be blocked by environment setup rather than code quality.

### Divergent Views

None in this cycle. Only the `claude` reviewer was invoked.
