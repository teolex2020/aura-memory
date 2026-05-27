# Constraints

## Disk Format Compatibility (Byte-Level)

source: docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md

- `brain.aura`: Magic `AURA` + FORMAT_VERSION + count/created/padding header + append records (LittleEndian)
- `temporal.bin`: `TPL1` + u8 version=1 + bincode HashMap<String,String>, atomic temp file replacement
- `brain.cog`: `COG1` + u8 version + [op u8 | payload_len u32 | crc32 u32 | payload]..., payload is Record JSON bytes
- `brain.snap`: `CSN1` + u8 version + log_position u64 + record_count u32 + repeated [payload_len u32 | payload]
- `index_manifest.json`: JSON (next_doc_id + id_map)
- `sdr.idx`: u16 bit + u64 buf_len + roaring bitmap bytes (must align with Rust roaring crate serialize_into/deserialize_from)
- `beliefs.cog` / `concepts.cog` / `causal.cog` / `policies.cog`: JSON bytes
- `persistence_manifest.json`: Pretty JSON with Rust normalization logic
- Backup container: BACKUP_MAGIC(4) + version(1) + enc_flag(1) + payload (header_len u32 + header JSON + data_len u64 + brain.aura bytes + index_len u64 + brain.idx bytes)
- `.aura.learned`: `LRN1` + bincode LearnedCanonicalMap (atomic temp file replacement)
- `.aura.syn`: bincode HashMap<String,String>

## effect-smol Layering

source: docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md

- `@aura/contract`: Context Tags only (FileRead/FileWrite/Clock/Crypto + future recall services)
- `@aura/utils`: pure functions only (no IO, no Context)
- `@aura/platform-node`: Bun/Node implementations of contracts (Live layers)
- `node:*` imports only allowed in `@aura/platform-node` and test glue code
- No cross-package relative imports (`../../other-package/src/*`) — only `@aura/*` aliases
- Each package package.json: `name: "@aura/<pkg>"`, `type: "module"`, `exports: { ".": "./src/index.ts" }`

## Recall Pipeline Architecture

source: docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md

- Signals: SDR + NGram + Tags + Embedding (optional)
- Fusion: RRF with k=60, normalize by max_possible
- Expansion: graph_walk (2 hops) + causal_walk (depth 3)
- Scoring: trust-aware recency weighting: final_score = rrf_score * strength * effective_trust(metadata, now, config, source_type)
- Optional services: EmbeddingStore, BoundedReranker, RecallFinalizer, TrustConfig (skip if missing)
- RecallView service owns building from disk; @aura/storage owns the builder

## Maintenance Pipeline

source: docs/superpowers/specs/2026-05-22-typescript-maintenance-belief-concept-causal-policy-design.md

- EpistemicTrace (Tag/Layer DI) → BeliefEngine → ConceptEngine → CausalEngine → PolicyEngine
- Four .cog files: beliefs.cog, concepts.cog, causal.cog, policies.cog (JSON snapshot)
- Bounded reranking uses belief/concept/causal/policy engines
- Finalize: activate + co-recall strengthen + session tracking
