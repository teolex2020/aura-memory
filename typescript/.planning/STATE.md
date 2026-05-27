# STATE.md

## Current Phase

Phase 6: Maintenance Pipeline Completion (in progress)

## Completed

### Phase 1: M1 — Read-Only Skeleton + Workspace Setup
- Workspace setup (Bun + Effect + vitest)
- effect-smol layering (@aura/contract, @aura/utils, @aura/platform-node)
- Read-only parsing (brain.aura, temporal.bin, brain.cog+snap)
- Binary/Bincode codec aligned with Rust

### Phase 2: M2 — Write + Encryption
- Write/flush brain.aura
- Encryption/decryption roundtrip (Crypto.ts)
- CRC32, bincode, JSON serialization byte-aligned
- Cross-language read-back tests

### Phase 3: M3 — Indexing + Cognitive + Full Compatibility
- Roaring bitmap serialization
- InvertedIndex load/save/search (aligned with Rust)
- Cognitive file write (CognitiveStoreFile)
- brain.cog + brain.snap read/write
- Trust/Recency formula aligned (linear decay)
- Clock contract refactored

### Phase 4: Recall Pipeline + Core Facade
- Recall pipeline skeleton (SDR + Tags + optional Embedding)
- RRF fusion, GraphWalk, CausalWalk
- SDRInterpreter with tests
- Core recall facade (recallScored + recallRecords)
- Rust/TS parity framework (fixture + verifier)
- Recall.parity.test.ts

### Phase 5: Epistemic Skeleton + Maintenance Phase 1
- BeliefEngine/Store type-safe implementation (with tests)
- ConceptEngine/Store skeleton (with tests)
- CausalEngine/Store skeleton
- PolicyEngine/Store skeleton
- EpistemicRuntime DI wired (EpistemicTrace)
- Contract types: BeliefTypes, ConceptTypes

## In Progress

### Phase 6: Maintenance Pipeline Completion
- CausalEngine — discover/invalidate_pattern/retract_pattern are stubs (UnimplementedError)
- PolicyEngine — discover/retract_hint are stubs (UnimplementedError)
- Full maintenance pipeline (Belief → Concept → Causal → Policy) not yet wired
- Bounded reranking not yet integrated
- Finalize mutations not yet implemented

## Blocked

- Rust verifier Cargo edition2024 incompatibility (environment issue, not code)

## Next Actions

1. Implement CausalEngine.discover (highest priority — Phase 6)
2. Implement PolicyEngine.discover (Phase 6)
3. Wire full maintenance pipeline: Trace → Belief → Concept → Causal → Policy
4. Integrate bounded reranking into recall pipeline
5. Implement finalize mutations (activate/strengthen/session)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| kh0 | 重构contract包，将所有在代码中使用import("xxx").A内联的导入类型提升为import type语句 | 2026-05-26 | 58d1367 | [kh0-contract-import-xxx-a-import-type-2-1](./quick/260526-kh0-contract-import-xxx-a-import-type-2-1/) |

Last activity: 2026-05-26 - Completed quick task kh0: 重构contract包
