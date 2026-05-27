# Decisions

## D1: Runtime = Bun (not Node, not Browser)

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md
status: draft (not locked)
scope: typescript, runtime

Decision: Use Bun as the runtime for the TypeScript port. Not Node.js, not Browser/Worker.

## D2: Framework = effect-smol (not full Effect-TS)

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md
status: draft (not locked)
scope: typescript, framework, dependency-injection

Decision: Use effect-smol style (Context/Layer) for dependency injection, IO, and caching. Not full Effect-TS.

## D3: Disk Format Compatibility Over Performance

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md
status: draft (not locked)
scope: compatibility, disk-format

Decision: Prioritize byte-level disk format compatibility between Rust and TS over performance. TS must read/write files that Rust can read/write.

## D4: MCP Only (No HTTP Server)

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md
status: draft (not locked)
scope: mcp, server

Decision: Implement stdio MCP server only. No HTTP server, no dashboard.

## D5: Read-First, Then Write

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md
status: draft (not locked)
scope: persistence, testing

Decision: Deliver "read-path first" (M1), then "write-path" (M2), then full compatibility (M3), then MCP (M4).

## D6: Contract Split: FileRead vs FileWrite

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
status: draft (not locked)
scope: contract, filesystem

Decision: Split filesystem into FileRead (read-only) and FileWrite (write + random write) for testability.

## D7: No Cross-Package Relative Imports

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
status: draft (not locked)
scope: packaging, imports

Decision: All inter-package references must use `@aura/*` aliases. No `../../other-package/src/*` relative imports.

## D8: Optional Services for Recall Pipeline

source: docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md
status: draft (not locked)
scope: recall, services

Decision: EmbeddingStore, BoundedReranker, RecallFinalizer, TrustConfig are optional Context services. If missing, the pipeline skips them without error.

## D9: Recall-First Implementation Order

source: docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md
status: draft (not locked)
scope: recall, implementation-order

Decision: Prioritize recall pipeline implementation before full write-path. Write-path verifier tests are deferred until recall is stable.

## D10: Simple Implementation / Full Implementation Comments

source: docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md
status: draft (not locked)
scope: code-quality, documentation

Decision: Every module with an incremental path MUST include explicit `SIMPLE IMPLEMENTATION:` and `FULL IMPLEMENTATION:` comment markers.
