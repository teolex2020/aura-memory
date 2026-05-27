# Requirements

## REQ-001: TypeScript 1:1 Rewrite of Rust Core

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md
scope: typescript, rust, core

- TypeScript must implement all Rust core capabilities (open/store/recall/search/update/delete/maintain/insights)
- Disk format must be byte-level compatible (Rust can read TS-written files, TS can read Rust-written files)
- Scope: core lib + MCP stdio server only (no HTTP server, no dashboard)

## REQ-002: effect-smol Layering

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md, docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: architecture, dependency-injection

- Core logic must be transparent to IO/cache/time/crypto dependencies
- Testing must be able to substitute dependencies for byte comparison and fault injection
- Platform IO only in `@aura/platform-node`

## REQ-003: @aura/contract Package

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: contract, packaging

- Contains Context Tags only (FileRead, FileWrite, Clock, Crypto, future recall services)
- No implementations, no node:* imports

## REQ-004: @aura/utils Package

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: utils, pure-functions

- Contains pure function utilities only
- No IO, no Effect Context dependency
- Examples: hexToBytes, bytesToHex, fixedBytes

## REQ-005: @aura/platform-node Package

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: platform, node

- Provides Bun/Node Live Layer implementations for all contract services
- Only package allowed to import node:* (plus test glue code)

## REQ-006: FileRead Service

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: filesystem, read

- readFile(path): Effect<Uint8Array>
- exists(path): Effect<boolean>
- stat(path): Effect<{ size: number }>

## REQ-007: FileWrite Service

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: filesystem, write

- mkdirp(path): Effect<void>
- writeFile(path, data): Effect<void>
- appendFile(path, data): Effect<void>
- writeAt(path, offset, data): Effect<void>
- fsync(path): Effect<void>

## REQ-008: Crypto Service Contract

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md
scope: crypto, contract

- deriveKeyFromPassword(password, salt16): Effect<Uint8Array>
- encryptData(plaintext, key32, nonce?): Effect<Uint8Array>
- decryptData(encrypted, key32): Effect<Uint8Array>
- computeHmac(data, key32): Effect<Uint8Array>

## REQ-009: Recall Pipeline Alignment

source: docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md
scope: recall, pipeline

- Signals: SDR + NGram + Tags + Embedding (optional)
- Fusion: RRF with k=60
- Expansion: graph_walk (2 hops) + causal_walk (depth 3)
- Scoring: trust-aware recency weighting
- Optional: bounded reranking, finalize mutations

## REQ-010: Deterministic Tests

source: docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md
scope: testing, determinism

- All recall pipeline tests must be deterministic (fixed Clock, mock RecallView)
- Phase A: pure pipeline tests (no disk)
- Phase B: fixture read-path tests (Rust fixtures)
- Phase C: write-path cross-language verifier (deferred)

## REQ-011: Epistemic Layer Skeleton

source: docs/superpowers/specs/2026-05-22-aura-typescript-epistemic-layer-skeleton-design.md
scope: epistemic, skeleton

- BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine with effect-smol Context/Layer
- Rust naming and disk filenames 1:1 aligned
- EpistemicRuntime for maintenance pipeline

## REQ-012: Maintenance Pipeline End-to-End

source: docs/superpowers/specs/2026-05-22-typescript-maintenance-belief-concept-causal-policy-design.md
scope: maintenance, pipeline

- Phase 1: Trace + Belief (schema + engine + store + Rust alignment tests)
- Phase 2+: Concept + Causal + Policy
- Bounded reranking and finalize must be triggerable from recall pipeline
