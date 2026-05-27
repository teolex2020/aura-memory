# STRUCTURE.md — Directory & Module Layout

## Root Layout

```
typescript/
├── package.json           # Workspace root, scripts, shared deps
├── tsconfig.json          # TypeScript config with path aliases
├── vitest.config.ts       # Test config with package aliases
├── bun.lock               # Bun lockfile
├── AGENTS.md              # Agent instructions & project context
├── test/fixtures/         # Shared test fixtures
└── packages/              # 14 workspace packages
```

## Package Inventory

| Package | Src Files | Test Files | Role |
|---------|-----------|------------|------|
| `@aura/contract` | 21 | 3 | Domain types, enums, context tags, errors |
| `@aura/utils` | 6 | 0 | Pure utilities (bytes, hex, crc32, id12, time) |
| `@aura/codec` | 4 | 3 | Binary/Bincode serialization, crypto primitives |
| `@aura/indexing` | 3 | 4 | InvertedIndex, Roaring bitmap serialization |
| `@aura/storage` | 16 | 13 | File parsers, read models (RecallView, BrainAura, snapshots) |
| `@aura/recall` | 10 | 3 | Recall pipeline algorithms (signals, RRF, graph, causal, trust) |
| `@aura/core` | 4 | 4 | Facade: Aura class, recall entrypoints, default layer |
| `@aura/belief` | 3 | 2 | Belief engine & store |
| `@aura/concept` | 3 | 1 | Concept engine & store |
| `@aura/causal` | 3 | 0 | Causal engine & store |
| `@aura/policy` | 3 | 0 | Policy engine & store |
| `@aura/epistemic-runtime` | 3 | 0 | Runtime orchestration & tracing |
| `@aura/platform-node` | 5 | 0 | Node.js implementations of FileRead, FileWrite, Clock, Crypto |

**Total**: ~84 source files, ~33 test files

## Package Internal Structure

Each package follows a flat `src/` layout:

```
packages/<name>/
├── package.json           # Minimal: { name, private, type, exports }
└── src/
    ├── index.ts           # Barrel export
    ├── <Feature>.ts       # Implementation
    ├── <Feature>.test.ts  # Co-located tests (if any)
    └── <subdirs>/         # Grouped types (e.g., levels/, record/, sdr/)
```

### Exception: `@aura/contract` subdirectories
- `src/levels/` — Level enum
- `src/record/` — Record types, StoreOptions, UpdateOptions
- `src/relation/` — Relation types
- `src/sdr/` — SDR types
- `src/belief/` — Belief types
- `src/concept/` — Concept types

## Key Files by Responsibility

### Entry Points
| File | Exports |
|------|---------|
| `packages/core/src/Aura.ts` | `Aura.open()`, `Aura.toRecordLike()` |
| `packages/core/src/Recall.ts` | `recallScored()`, `recallRecords()` |
| `packages/core/src/DefaultLayer.ts` | `DefaultLayer(brainDir)` |

### Recall Pipeline
| File | Role |
|------|------|
| `packages/recall/src/Pipeline.ts` | Main `recallPipeline()` orchestrator |
| `packages/recall/src/Signals.ts` | Tag/SDR/Ngram/Embedding collectors |
| `packages/recall/src/RRF.ts` | Reciprocal Rank Fusion |
| `packages/recall/src/GraphWalk.ts` | Connection-based graph expansion |
| `packages/recall/src/CausalWalk.ts` | Causal chain expansion |
| `packages/recall/src/Trust.ts` | Trust + recency scoring |
| `packages/recall/src/SDRInterpreter.ts` | Semantic decoding → SDR bits |

### Storage / Persistence
| File | Role |
|------|------|
| `packages/storage/src/RecallView.ts` | Read model assembling indices + records |
| `packages/storage/src/BrainAura.ts` | `brain.aura` format parser |
| `packages/storage/src/BrainAuraFile.ts` | Low-level brain.aura file I/O |
| `packages/storage/src/CognitiveRecord.ts` | Record normalization |
| `packages/storage/src/CogJsonSnapshotFile.ts` | `.cog` JSON snapshot handling |

### Platform
| File | Role |
|------|------|
| `packages/platform-node/src/NodeFileRead.ts` | `FileRead` live layer |
| `packages/platform-node/src/NodeFileWrite.ts` | `FileWrite` live layer |
| `packages/platform-node/src/NodeClock.ts` | `Clock` live layer |
| `packages/platform-node/src/NodeCrypto.ts` | `Crypto` live layer |

## Path Aliases

All packages mapped via `tsconfig.json` paths and Vitest `resolve.alias`:

```
@aura/contract      → packages/contract/src/index.ts
@aura/utils         → packages/utils/src/index.ts
@aura/codec         → packages/codec/src/index.ts
@aura/indexing      → packages/indexing/src/index.ts
@aura/storage       → packages/storage/src/index.ts
@aura/recall        → packages/recall/src/index.ts
@aura/core          → packages/core/src/index.ts
@aura/platform-node → packages/platform-node/src/index.ts
@aura/belief        → packages/belief/src/index.ts
@aura/concept       → packages/concept/src/index.ts
@aura/causal        → packages/causal/src/index.ts
@aura/policy        → packages/policy/src/index.ts
@aura/epistemic-runtime → packages/epistemic-runtime/src/index.ts
```

**Rule**: No cross-package relative imports; always use `@aura/*` aliases.
