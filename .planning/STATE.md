# STATE.md

## Current Phase

Phase 3: M3 — Indexing + Cognitive + Full Compatibility (in progress)

## Completed

- Workspace setup (Bun + Effect + vitest)
- effect-smol layering (@aura/contract, @aura/utils, @aura/platform-node)
- M1 read-only parsing (brain.aura, temporal.bin, brain.cog+snap)
- M2 write/flush brain.aura + encryption
- Roaring bitmap serialization
- InvertedIndex load/save/search (aligned with Rust)
- Trust/Recency formula aligned (linear decay)
- Recall pipeline skeleton (SDR + Tags + optional Embedding)
- Core recall facade (recallScored + recallRecords)
- Rust/TS parity framework (fixture + verifier)
- Epistemic layer skeleton (Belief/Concept/Causal/Policy)
- BeliefEngine/Store type-safe implementation

## In Progress

- NGramIndex MinHash+LSH alignment
- SDR overlap weight integration
- Record schema defaults and validation

## Blocked

- Rust verifier Cargo edition2024 incompatibility (environment issue, not code)

## Next Actions

1. Implement NGramIndex MinHash+LSH (highest priority)
2. Integrate SDR overlap weight into scoring
3. Complete Record schema defaults
4. Implement graph/causal field persistence

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| kh0 | 重构contract包，将所有在代码中使用import("xxx").A内联的导入类型提升为import type语句 | 2026-05-26 | 58d1367 | [kh0-contract-import-xxx-a-import-type-2-1](./quick/260526-kh0-contract-import-xxx-a-import-type-2-1/) |

Last activity: 2026-05-26 - Completed quick task kh0: 重构contract包，将所有在代码中使用import("xxx").A内联的导入类型提升为import type语句
