# INTEGRATIONS.md — External Dependencies & Services

## Runtime Dependencies

### Effect Ecosystem
| Package | Version | Purpose |
|---------|---------|---------|
| `effect` | 4.0.0-beta.68 | Core functional effect system, Context/Layer DI, data types |
| `@effect/vitest` | 4.0.0-beta.68 | Effect-native test assertions and async test helpers |

### Cryptography (Pure JS / WASM)
| Package | Version | Purpose |
|---------|---------|---------|
| `@noble/ciphers` | ^0.5.3 | Encryption primitives (AES, ChaCha20, etc.) |
| `@noble/hashes` | ^1.5.0 | Hash functions (SHA2, SHA3, Blake, etc.) |
| `argon2-wasm-edge` | ^1.0.23 | Password hashing / key derivation via WASM |
| `roaring-wasm` | ^1.1.0 | Compressed bitmap operations for indexing |
| `xxhash-wasm` | ^1.1.0 | Fast non-cryptographic hashing for checksums |

## Platform Services (Injected, Not Directly Imported)

The following capabilities are abstracted through `@aura/contract` and implemented in `@aura/platform-node`:

| Capability | Contract | Node Implementation | Notes |
|------------|----------|---------------------|-------|
| File Reading | `FileRead` | `NodeFileReadLive` | `readFile`, `exists`, `stat` |
| File Writing | `FileWrite` | `NodeFileWriteLive` | `writeFile`, `appendFile`, `writeAt`, `fsync`, `rename`, `mkdirp` |
| Clock | `Clock` | `NodeClock` / `Clock.fixed()` | Time provider for deterministic tests |
| Crypto | `Crypto` | `NodeCrypto` | Platform crypto operations |

## Rust Interop
- **Cargo-based Rust reference implementation** in parent directory (`../` relative to TypeScript root)
- Parity tests invoke Rust binaries directly:
  - `aura-ts-recall-fixtures` — generates test fixtures
  - `aura-ts-verify-recall` — verifier for recall parity
- Disk format compatibility goal: TS and Rust must read/write identical file formats

## Optional Services (Context-Injected)
These may or may not be provided at runtime; pipeline skips gracefully when absent:
- `EmbeddingStore` — vector embedding storage/retrieval
- `BoundedReranker` — result reranking
- `RecallFinalizer` — post-recall side effects (activate/strengthen/session/audit)
- `TrustConfigTag` — trust scoring configuration

## No External Network Services
- No database drivers (SQLite, PostgreSQL, etc.)
- No HTTP clients or servers
- No cloud SDKs
- All storage is file-system based via injected `FileRead`/`FileWrite`
