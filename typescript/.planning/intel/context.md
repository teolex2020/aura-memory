# Context

## Implementation Plans (13 DOCs)

source: docs/superpowers/plans/

### M1-M4 Milestone Plans
- **M1** (`2026-05-20-aura-typescript-port-m1.md`): Workspace setup + effect-smol skeleton + read-only parsing (brain.aura, temporal.bin, brain.cog+snap)
- **M2** (`2026-05-20-aura-typescript-port-m2.md`): Write/flush brain.aura + optional encryption + cross-language read-back tests
- **M3-1** (`2026-05-20-aura-typescript-port-m3-1.md`): Indexing (Roaring bitmap) + cognitive file write + bidirectional fixture tests
- **Codec Crypto** (`2026-05-20-typescript-codec-crypto.md`): Argon2id + ChaCha20-Poly1305 + HMAC-SHA256 with Rust oracle tests

### Layering & Platform
- **Effect Layering** (`2026-05-20-aura-typescript-effect-layering-plan.md`): Refactor to effect-smol with contract/utils/platform-node packages
- **Platform Node Task 3** (`2026-05-20-platform-node-task3.md`): Node platform implementation for FileRead/FileWrite/Clock/Crypto

### Recall
- **Recall-First** (`2026-05-20-aura-typescript-recall-first.md`): Implement recall pipeline with SDR/NGram/Tags/Embedding signals
- **Core Recall Facade** (`2026-05-20-core-recall-facade.md`): Core facade with recallScored + recallRecords APIs
- **Rust/TS Parity** (`2026-05-20-rust-ts-recall-parity.md`): Deterministic fixture generator + verifier + TS parity tests

### Epistemic & Maintenance
- **Epistemic Skeleton** (`2026-05-22-aura-typescript-epistemic-layer-skeleton.md`): Belief/Concept/Causal/Policy skeleton
- **Maintenance Pipeline** (`2026-05-22-typescript-maintenance-epistemic-pipeline.md`): Phase 1 Trace + Belief implementation
- **Cog Snapshot Helper** (`2026-05-22-cog-json-snapshot-helper.md`): Reusable JSON snapshot helper for 4 engine state files
- **Core Parity Skeleton** (`2026-05-22-core-aura-parity-skeleton.md`): Core Aura API skeleton with open→store→recall flow

## Current Status (from AGENTS.md)

- Trust/Recency formula: ✅ aligned (linear decay)
- InvertedIndex.search: ✅ aligned (rarity sort, max_bits, limit)
- NGramIndex: ❌ still simplified trigram Jaccard (needs MinHash+LSH)
- SDR overlap weight: ❌ not yet used in scoring
- Record schema defaults: ❌ minimal normalization only
- graph/causal fields: ❌ connections/caused_by_id from raw JSON
- Recall cache/trace: ❌ not implemented
