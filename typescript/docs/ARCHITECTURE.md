<!-- generated-by: gsd-doc-writer -->

# Architecture

## System Overview

AuraSDK is a cognitive architecture library that models memory, belief formation, and recall as a layered pipeline. It ingests raw text records into a file-backed event log (`brain.cog`), derives SDR (Sparse Distributed Representation) neural signatures in `brain.aura`, builds an inverted index for fast retrieval, and runs multi-tier epistemic reasoning -- from belief clustering through concept discovery up to causal analysis and policy formation. The TypeScript implementation targets the Effect-TS ecosystem, using Tag/Layer dependency injection for all I/O boundaries, making it testable, composable, and portable across runtimes.

The primary architectural style is a **layered cognitive hierarchy** with **effect-managed dependency injection**. Every operation that touches the filesystem, clock, or cryptography goes through a service interface (Tag) defined in `@aura/contract`, with concrete implementations provided via `@aura/platform-node` (Node.js) and wired together through `@aura/core`.

## Cognitive Hierarchy

Records flow through five ascending tiers of abstraction:

```
Raw Text  --->  Record  --->  Belief  --->  Concept  --->  Causal Pattern  --->  Policy
                 |               |              |                |                   |
           brain.cog       belief engine    concept engine    causal engine     policy engine
          (append log)    (claim grouping,  (SDR clustering,  (stub --          (stub --
                           hypothesis        abstraction       Unimplemented)     Unimplemented)
                           resolution)       scoring)
```

| Tier | Package | Data Model | Maturity |
|------|---------|-----------|----------|
| 1. Record | `@aura/contract` | `Record` (id, content, tags, connections, SDR bits) | Full |
| 2. Belief | `@aura/belief` | `Belief` / `Hypothesis` (claim grouping, winner resolution) | Full |
| 3. Concept | `@aura/concept` | `ConceptCandidate` (stable abstractions over beliefs) | Full |
| 4. Causal | `@aura/causal` | Causal pattern discovery | Stub (Unimplemented) |
| 5. Policy | `@aura/policy` | Policy hints and lifecycle management | Stub (Unimplemented) |

## Package Dependency Graph

```
                    +------------------+
                    |  @aura/contract  |  <-- types, service tags, errors
                    +--------+---------+
                             |
          +------------------+-------------------+
          |                  |                   |
  +-------v--------+  +-----v------+  +---------v----------+
  |  @aura/utils   |  | @aura/codec|  | @aura/epistemic-   |
  |  id12, crc32,  |  | Binary     |  | runtime (trace +    |
  |  hex, time     |  | Reader/    |  | runtime stub)       |
  +----------------+  | Writer,    |  +--------------------+
                      | crypto     |
                      +-----+------+
                            |
          +-----------------+-----------------+
          |                                   |
  +-------v--------+                 +--------v--------+
  | @aura/indexing |                 | @aura/storage   |
  | InvertedIndex  |                 | brain.cog,      |
  | RoaringBitmap  |                 | brain.aura,     |
  +-------+--------+                 | brain.snap,     |
          |                          | engine manifests|
          |                          +--------+--------+
          |                                   |
          +-----------------+-----------------+
                            |
             +--------------+--------------+
             |              |              |
     +-------v------+ +----v-----+ +-----v------+
     | @aura/belief  | |@aura/    | |@aura/causal|
     | BeliefEngine  | |concept   | |CausalEngine|
     | BeliefStore   | |Concept   | |CausalStore |
     +-------+-------+ |Engine    | +-----+------+
             |         |Concept   |       |
             |         |Store     |       |
     +-------v------+ +----+-----+ +-----v------+
     | @aura/recall  |           | @aura/policy |
     | Pipeline,     |           | PolicyEngine |
     | Signals, RRF, |           | PolicyStore  |
     | GraphWalk     |           +-------------+
     +-------+------+
             |
     +-------v------+
     | @aura/core   |
     | Aura facade, |
     | DefaultLayer |
     +-------+------+
             |
     +-------v----------+
     | @aura/platform-  |
     | node             |
     | NodeFileRead,    |
     | NodeFileWrite,   |
     | NodeClock,       |
     | NodeCrypto       |
     +------------------+
```

Dependency direction: arrows point from dependent to dependency. `@aura/contract` is the foundation that every other package depends on. `@aura/core` is the top-level facade that wires everything together via `DefaultLayer`. `@aura/platform-node` provides concrete I/O implementations and is only depended on at the application entry point.

## Key Abstractions

### Effect-TS Tag / Layer Pattern

All I/O boundaries and engine services are defined as Effect-TS `Tag` instances in `@aura/contract`. Tags declare the service interface as a typed shape; concrete implementations are provided via `Layer` at the application boundary.

```typescript
// Contract: define the service shape (packages/contract/src/FileRead.ts)
export class FileRead extends Tag("aura.contract.FileRead")<
  FileRead,
  {
    readFile: (path: string) => Effect.Effect<Uint8Array, FileReadError>
    exists: (path: string) => Effect.Effect<boolean, FileReadError>
    stat: (path: string) => Effect.Effect<FileStat, FileReadError>
  }
>() {}

// Platform: provide the implementation (packages/platform-node/src/NodeFileRead.ts)
export const NodeFileReadLive = Layer.succeed(FileRead, {
  readFile: (p) => Effect.tryPromise(() => fs.readFile(p).then(b => new Uint8Array(b))),
  exists: (p) => Effect.tryPromise(() => fs.stat(p).then(() => true).catch(() => false)),
  stat: (p) => Effect.tryPromise(() => fs.stat(p).then(s => ({ size: s.size })))
})
```

This pattern is used for: `FileRead`, `FileWrite`, `Clock`, `Crypto`, `BeliefEngine`, `BeliefStore`, `ConceptEngine`, `ConceptStore`, `CausalEngine`, `CausalStore`, `PolicyEngine`, `PolicyStore`, `RecallViewTag`, `EmbeddingStore`, `BoundedReranker`, `RecallFinalizer`, `TrustConfigTag`, `EpistemicRuntime`, `EpistemicTrace`.

The `serviceOption` utility (`packages/contract/src/Optional.ts`) allows optional service resolution -- downstream code can check `Option.isSome(service)` to branch on whether a service is available, which is used by the recall pipeline for optional embedding, reranker, and trust config services.

### Aura Facade (`packages/core/src/Aura.ts`)

The primary public API. Provides `Aura.open(path)` and `Aura.open_with_password(path, password?)` to instantiate the system from a brain directory. All operations return `Effect` values, making them lazy, composable, and testable:

- `store(content, options?)` -- append a new record to the cognitive log
- `update(recordId, patch)` -- apply a partial update as an append-only event
- `delete(recordId)` -- append a delete tombstone
- `connect(fromId, toId, weight?)` -- link two records with a weighted connection
- `recall(query, options?)` -- run the multi-signal recall pipeline
- `explain_recall(...)` / `explain_record(...)` -- explainability stubs
- `get_entity_digest(...)` / `link_entities(...)` -- entity/relation graph stubs

### Engine / Store Pairs

Each cognitive tier follows a consistent Engine + Store pattern:

| Tier | Engine (Tag) | Store (Tag) | Implementation | Storage File |
|------|-------------|------------|----------------|-------------|
| Belief | `BeliefEngine` | `BeliefStore` | `packages/belief/src/BeliefEngine.ts` | `beliefs.cog` |
| Concept | `ConceptEngine` | `ConceptStore` | `packages/concept/src/ConceptEngine.ts` | `concepts.cog` |
| Causal | `CausalEngine` | `CausalStore` | `packages/causal/src/CausalEngine.ts` | `causal.cog` |
| Policy | `PolicyEngine` | `PolicyStore` | `packages/policy/src/PolicyEngine.ts` | `policy.cog` |

Engines contain the business logic (clustering, discovery, resolution). Stores handle serialization/deserialization using the `CogJsonSnapshotFile` utility from `@aura/storage`, which atomically writes JSON via a temp-file + rename pattern.

### DefaultLayer (`packages/core/src/DefaultLayer.ts`)

Wires all engines and stores together into a single merged Layer. Takes a `brainDir` string and instantiates:

```
RecallViewLive(brainDir)    -- builds the RecallView (records + indexes + aura headers)
BeliefStoreLive(brainDir)   -- belief persistence
BeliefEngineLive             -- belief engine (in-memory)
ConceptStoreLive(brainDir)  -- concept persistence
ConceptEngineLive            -- concept engine (in-memory)
CausalStoreLive(brainDir)   -- causal persistence (stub)
CausalEngineLive             -- causal engine (stub)
PolicyStoreLive(brainDir)   -- policy persistence (stub)
PolicyEngineLive             -- policy engine (stub)
EpistemicRuntimeLive         -- epistemic runtime (stub)
EpistemicTraceLive           -- trace/logging via Effect.log
```

### InvertedIndex (`packages/indexing/src/InvertedIndex.ts`)

The core search data structure. Maps SDR bit indices (u16) to Roaring Bitmap document sets. Implements a rarity-sorted search algorithm aligned with the Rust reference:

1. For each query SDR bit, look up its document bitmap
2. Sort bitmaps by size ascending (rarest bits first, most selective)
3. Process up to `maxBits` bitmaps (128/256/512 based on `topK`)
4. Count per-document overlap across processed bitmaps
5. Filter by `minOverlap`, sort by count descending, truncate to `topK * 10`

Persisted as two files: `index_manifest.json` (ID mapping) and `sdr.idx` (binary bit-to-bitmap index).

### Recall Pipeline (`packages/recall/src/Pipeline.ts`)

A multi-signal recall system that fuses results from independent retrieval signals:

1. **SDR signal** (`Signals.collectSdr`): Text-to-SDR via `SDRInterpreter`, then inverted index search with Tanimoto similarity scoring
2. **NGram signal** (`Signals.collectNgram`): Trigram Jaccard fuzzy matching over record content
3. **Tag signal** (`Signals.collectTags`): Jaccard similarity over tag sets
4. **Embedding signal** (`Signals.collectEmbedding`): Optional external embedding service
5. **RRF Fusion** (`RRF.rrfFuse`): Reciprocal Rank Fusion (K=60) merges ranked lists with normalization
6. **Graph Walk** (`GraphWalk.graphWalk`): 2-hop connection graph expansion with damping (0.6) and min score (0.05)
7. **Causal Walk** (`CausalWalk.causalWalk`): Traces `caused_by_id` chains up to depth 3 with decaying weights
8. **Trust scoring**: Applies source trust, recency boost, and half-life decay from `TrustConfig`
9. **Optional reranker** (`BoundedReranker`): Pluggable reranking service
10. **Optional finalizer** (`RecallFinalizer`): Post-recall hook (e.g., logging, session tracking)

### Binary Codec (`packages/codec`)

Provides `BinaryReader` and `BinaryWriter` for reading/writing the binary file formats (`brain.cog`, `brain.snap`, `brain.aura`, `sdr.idx`). Also contains cryptographic primitives: `encryptData`, `decryptData`, `deriveKeyFromPassword`, `computeHmac` using `@noble/ciphers` and `argon2-wasm-edge`.

## Data Flow: Record Creation

```
1. Application calls Aura.store("content text", { tags: [...], namespace: "default" })
2. Aura.store:
   a. Calls Clock.nowSeconds() for timestamp
   b. Generates a 12-character ID via @aura/utils id12()
   c. Constructs a full Record object with defaults
   d. Opens CognitiveStoreFile at brainDir
   e. Appends OP_STORE (0x01) entry to brain.cog:
      [op: u8][payload_len: u32le][crc32: u32le][JSON payload]
   f. Flushes (fsync) brain.cog
3. brain.aura is NOT updated (simplified implementation)
4. index/ is NOT updated (indexing happens during maintenance cycles)
```

## Data Flow: Recall

```
1. Application calls Aura.recall("query text", { topK: 10, namespaces: ["default"] })
2. Resolves RecallViewTag from the Layer:
   a. loadCognitiveRecords(dir) -- reads brain.cog + brain.snap to build Map<string, CognitiveRecord>
   b. readBrainAuraFile(dir) -- reads brain.aura for SDR headers (sdr_indices per aura_id)
   c. InvertedIndex.load(dir/index/) -- loads index_manifest.json + sdr.idx
   d. Builds ngramIndex, tagIndex, auraIndex
3. recallPipeline(query, options):
   a. collectSdr(view, sdr, query, topK, namespaces):
      - SDRInterpreter.textToSdr(query) converts text to SDR bit array
      - InvertedIndex.searchScored(bits, topK*2, 1) finds matching document IDs
      - auraIndex maps aura IDs to record IDs
      - auraHeaders provides sdr_indices for Tanimoto similarity scoring
   b. collectNgram(view, query, topK, namespaces):
      - Computes trigrams over query text
      - Matches against pre-built trigram signatures over record content
      - Returns topK records by Jaccard similarity
   c. collectTags(view, query, topK, namespaces):
      - Tokenizes query into lowercase tags
      - Scores records by Jaccard(tag intersection / tag union)
   d. (Optional) collectEmbedding(view, EmbeddingStore, query, topK, namespaces):
      - Delegates to an external embedding service
   e. rrfFuse([sdrRanked, ngramRanked, tagRanked, embeddingRanked?]):
      - Reciprocal Rank Fusion: score = sum(1 / (K + rank_i)) per result list
      - Normalizes against theoretical max
4. filterByStrengthAndNamespace(view, fused, minStrength, namespaces)
5. graphWalk(view, matched, minStrength, namespaces):
   - 2-hop expansion from matched record connections
   - Damping factor 0.6 per hop, min score threshold 0.05
   - Max 30 expanded records
6. causalWalk(view, matched, minStrength, namespaces):
   - Traces caused_by_id chains up to depth 3
   - Decay formula: score * 0.8 * 0.9^depth
7. applyRecencyScoring(view, scored, topK, nowSec, trustConfig):
   - Multiplies each score by record.strength * computeEffectiveTrust()
   - Sorts by final score, truncates to topK
8. (Optional) BoundedReranker.rerank(scored, query)
9. (Optional) RecallFinalizer.finalize(scored, sessionId)
10. Returns RecallScored: Array<[score: number, recordId: string]>
```

## Directory Structure

```
typescript/
├── packages/
│   ├── contract/          # Type definitions, service Tags, error classes, enums
│   │   └── src/
│   │       ├── Belief.ts          # BeliefEngine/BeliefStore Tag + impl type
│   │       ├── belief/BeliefTypes.ts  # Belief, Hypothesis, BeliefState types
│   │       ├── Causal.ts          # CausalEngine/CausalStore Tag + impl type
│   │       ├── Clock.ts           # Clock service (nowSeconds)
│   │       ├── Concept.ts         # ConceptEngine/ConceptStore Tag + impl type
│   │       ├── concept/ConceptTypes.ts  # ConceptCandidate, ConceptState
│   │       ├── Context.ts         # Effect-TS Tag helper
│   │       ├── Crypto.ts          # Crypto service Tag (encrypt/decrypt/hmac)
│   │       ├── EpistemicRuntime.ts # EpistemicRuntime Tag
│   │       ├── EpistemicTrace.ts  # EpistemicTrace Tag (event/span)
│   │       ├── Errors.ts          # Unified error types (TaggedError)
│   │       ├── FileRead.ts        # FileRead service Tag
│   │       ├── FileWrite.ts       # FileWrite service Tag
│   │       ├── Optional.ts        # serviceOption helper
│   │       ├── Policy.ts          # PolicyEngine/PolicyStore Tag + impl type
│   │       ├── Recall.ts          # RecallViewTag, EmbeddingStore, BoundedReranker
│   │       ├── record/Record.ts   # Record, StoreOptions, UpdateOptions types
│   │       ├── relation/Relation.ts # RelationEdge, EntityDigest
│   │       └── sdr/Sdr.ts         # Sdr, SdrLookup types
│   │
│   ├── utils/             # Zero-dependency utility functions
│   │   └── src/
│   │       ├── Bytes.ts           # Buffer utilities (fixedBytes)
│   │       ├── Crc32.ts           # CRC32 checksum for log integrity
│   │       ├── Hex.ts             # Hex encoding/decoding
│   │       ├── Id12.ts            # 12-char nanoid-style ID generator
│   │       ├── Time.ts            # nowSecs() helper
│   │       └── path.ts            # Path utilities
│   │
│   ├── codec/             # Binary serialization and crypto primitives
│   │   └── src/
│   │       ├── Binary.ts          # BinaryReader / BinaryWriter
│   │       ├── Bincode.ts         # Bincode serialization
│   │       └── Crypto.ts          # encrypt/decrypt/deriveKey/hmac
│   │
│   ├── indexing/          # Inverted index with Roaring Bitmaps
│   │   └── src/
│   │       ├── InvertedIndex.ts   # SDR bit → document set index
│   │       └── Roaring.ts         # Roaring Bitmap wrapper (roaring-wasm)
│   │
│   ├── storage/           # File-based persistence layer
│   │   └── src/
│   │       ├── Backup.ts                   # Backup utilities
│   │       ├── BeliefStoreFile.ts          # Belief state persistence (beliefs.cog)
│   │       ├── BrainAura.ts                # brain.aura file reader
│   │       ├── BrainAuraFile.ts            # brain.aura binary format
│   │       ├── CausalStoreFile.ts          # Causal state persistence
│   │       ├── CogJsonSnapshotFile.ts      # Atomic JSON snapshot helper
│   │       ├── Cognitive.ts                # brain.cog binary format decoder
│   │       ├── CognitiveRecord.ts          # Record loader (cog + snap)
│   │       ├── CognitiveStoreFile.ts       # brain.cog append-only log writer
│   │       ├── ConceptStoreFile.ts         # Concept state persistence
│   │       ├── PersistenceManifest.ts      # Schema version manifest
│   │       ├── PolicyStoreFile.ts          # Policy state persistence
│   │       ├── RecallView.ts               # RecallView builder (records + indexes)
│   │       ├── Temporal.ts                 # Temporal utilities
│   │       └── Versioning.ts               # Data versioning logic
│   │
│   ├── belief/            # Belief engine (tier 2 of cognitive hierarchy)
│   │   └── src/
│   │       ├── BeliefEngine.ts    # Claim grouping, hypothesis formation, belief resolution
│   │       └── BeliefStore.ts     # Persistence adapter wrapping BeliefStoreFile
│   │
│   ├── concept/           # Concept engine (tier 3 of cognitive hierarchy)
│   │   └── src/
│   │       ├── ConceptEngine.ts   # Concept discovery from belief clusters
│   │       └── ConceptStore.ts    # Persistence adapter wrapping ConceptStoreFile
│   │
│   ├── causal/            # Causal engine (tier 4 -- stub)
│   │   └── src/
│   │       ├── CausalEngine.ts    # Stub (all methods return UnimplementedError)
│   │       └── CausalStore.ts     # Persistence adapter
│   │
│   ├── policy/            # Policy engine (tier 5 -- stub)
│   │   └── src/
│   │       ├── PolicyEngine.ts    # Stub (all methods return UnimplementedError)
│   │       └── PolicyStore.ts     # Persistence adapter
│   │
│   ├── recall/            # Recall pipeline (multi-signal retrieval)
│   │   └── src/
│   │       ├── Pipeline.ts        # Main recallPipeline orchestrator
│   │       ├── Signals.ts         # SDR, NGram, Tag, Embedding signal collectors
│   │       ├── RRF.ts             # Reciprocal Rank Fusion
│   │       ├── GraphWalk.ts       # Connection graph expansion (2-hop, damped)
│   │       ├── CausalWalk.ts      # Causal chain traversal (caused_by_id)
│   │       ├── SDRInterpreter.ts  # Text-to-SDR encoding
│   │       ├── Trust.ts           # Trust scoring with recency decay
│   │       ├── Types.ts           # RecallPipelineOptions, Scored, RankedList
│   │       └── Errors.ts          # SdrInterpreterError
│   │
│   ├── core/              # Top-level facade and wiring
│   │   └── src/
│   │       ├── Aura.ts            # Main Aura class (open, store, update, delete, recall, connect)
│   │       ├── Recall.ts          # recallScored / recallRecords effect wrappers
│   │       └── DefaultLayer.ts    # Layer.mergeAll of all engine/store layers
│   │
│   ├── platform-node/     # Node.js platform implementations
│   │   └── src/
│   │       ├── NodeFileRead.ts    # fs.readFile / fs.stat via Effect.tryPromise
│   │       ├── NodeFileWrite.ts   # fs.writeFile / fs.appendFile / fs.mkdir / fs.sync
│   │       ├── NodeClock.ts       # nowSecs delegate to @aura/utils
│   │       └── NodeCrypto.ts      # Crypto delegate to @aura/codec primitives
│   │
│   ├── epistemic-runtime/ # Epistemic runtime and tracing
│   │   └── src/
│   │       ├── EpistemicRuntime.ts # Stub (all methods return UnimplementedError)
│   │       ├── EpistemicTrace.ts   # Effect.log-based structured trace output
│   │       └── index.ts
│   │
│   └── code-extraction/   # Standalone code analysis tool (not in core cognitive pipeline)
│       └── src/
│           ├── extraction/        # Tree-sitter based code extraction (20+ languages)
│           ├── resolution/        # Import resolution and framework detection
│           ├── graph/             # Code graph traversal
│           ├── db/                # SQLite storage adapter
│           ├── search/            # Query parsing
│           └── context/           # Context formatter
│
├── package.json           # Root workspace config (pnpm workspaces)
├── pnpm-workspace.yaml    # pnpm workspace definition
├── tsconfig.json          # TypeScript configuration
└── vitest.config.ts       # Vitest test runner configuration (implied)
```

## File Formats

### brain.cog (Cognitive Event Log)

```
[Magic: "COG1" (4 bytes)]
[Version: u8 (2)]
-- repeat for each entry --
[Opcode: u8]     -- 0x01 = Store, 0x02 = Update, 0x03 = Delete
[PayloadLen: u32le]
[CRC32: u32le]   -- CRC32 of payload
[Payload: bytes] -- JSON for Store/Update, 12-byte fixed-string ID for Delete
```

### brain.snap (Cognitive Snapshot)

```
[Magic: "CSN1" (4 bytes)]
[Version: u8 (2)]
[LogPosition: u64le]  -- byte offset in brain.cog at snapshot time
[RecordCount: u32le]
-- repeat RecordCount times --
[Length: u32le]
[JSON payload: bytes]
```

### brain.aura (SDR Neural Signatures)

```
[Magic: "AURA" (4 bytes)]
[Version: u32le]
[Count: u64le]
[Created: f64le]  -- Unix timestamp
[Reserved: 40 bytes]
-- repeat Count times --
[Id: 32 bytes, fixed-string]
[DNA: 16 bytes, fixed-string]
[Timestamp: f64le]
[Intensity: f32le]
[Stability: f32le]
[DecayVelocity: f32le]
[Entropy: f32le]
[SdrCount: u16le]
[TextLen: u32le]
[EncryptedFlag: u8]
[SDR indices: u16le * SdrCount]
[Text: bytes * TextLen]
```

### sdr.idx (Inverted Index Binary)

```
-- repeat per SDR bit --
[BitIndex: u16le]
[PayloadSize: u64le]
[Roaring Bitmap serialized: bytes * PayloadSize]
```

## Architecture Decisions

**Append-only event sourcing.** All record mutations (store, update, delete) are appended to `brain.cog` as ordered events. The current state is reconstructed by replaying the log from the last snapshot position. A CRC32 checksum on each entry ensures integrity.

**SDR-based indexing.** Records are indexed by Sparse Distributed Representation bit indices stored in `brain.aura` and mapped through a Roaring Bitmap inverted index. This enables fast approximate search via Tanimoto (Jaccard) similarity without dense embeddings as a hard requirement.

**Effect-TS for dependency injection.** The Effect-TS Tag/Layer system decouples business logic from platform I/O. The `Aura` class requires `FileRead | FileWrite` in its effect type but never imports `node:fs` directly. Tests provide mock layers; production uses `@aura/platform-node`. This enables future portability to Deno, Bun, or browser environments (with appropriate storage backends).

**Simplified implementations with Rust parity annotations.** Many methods are marked `SIMPLE IMPLEMENTATION` and reference the corresponding Rust source line. These provide functional behavior on the happy path while deferring full parity on edge cases (encryption, advanced indexing, explainability). Stub engines (`CausalEngine`, `PolicyEngine`, `EpistemicRuntime`) return `UnimplementedError` to make missing capability explicit rather than silently succeeding.
