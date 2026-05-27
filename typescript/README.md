<!-- generated-by: gsd-doc-writer -->

# AuraSDK (TypeScript)

A TypeScript monorepo implementing the Aura cognitive architecture -- a local knowledge-graph runtime that gives AI agents durable memory, explainability, and governed adaptation, rewritten from the Rust core for learning, research, and cross-platform parity.

Built with [Effect-TS](https://effect.website/) for layered dependency injection and functional error handling. Targets Bun and Node.js.

## Key Features

- **Two-tier memory**: Cognitive (ephemeral) + Core (permanent) with decay, promotion, and maintenance
- **Multi-signal recall pipeline**: Tag inverted index, SDR Tanimoto similarity, n-gram matching, RRF fusion, graph/causal walk expansion, trust/recency scoring
- **Epistemic runtime**: Belief -> Concept -> Causal -> Policy chain for bounded cognitive reranking
- **Disk format parity with Rust**: TypeScript reads and writes the same `brain.aura` and `brain.cog` file formats
- **Effect-TS dependency injection**: Pure core logic separated from platform concerns via Context Tags and Layer composition -- no direct `node:*` imports outside `@aura/platform-node`
- **Read-model-first design**: Recall pipeline operates on read-only views before any write paths
- **WASM-powered primitives**: Roaring bitmaps, xxHash, Argon2id via WASM

## Package Overview

| Package | Role |
|---------|------|
| `@aura/contract` | Domain types, enums (`Level`, `Record`, `SourceType`), context tags (`FileRead`, `FileWrite`, `Clock`, `Crypto`), errors |
| `@aura/utils` | Pure utilities: bytes/hex encoding, CRC32, ID generation (`id12`), time helpers |
| `@aura/codec` | Binary serialization primitives (bincode-style), crypto operations |
| `@aura/indexing` | Inverted index with Roaring bitmap storage for tag and SDR lookups |
| `@aura/storage` | Persistence layer: `brain.aura` parser, `brain.cog` snapshot append-only log, recall view assembly |
| `@aura/recall` | Recall pipeline: signal collectors -> RRF fusion -> graph/causal expansion -> trust/recency scoring |
| `@aura/core` | Public facade: `Aura.open()`, `recallScored()`, `recallRecords()`, `DefaultLayer` assembly |
| `@aura/belief` | Belief engine and store for bounded belief-based reranking |
| `@aura/concept` | Concept engine and store for concept annotation and surfacement |
| `@aura/causal` | Causal engine and store for cause-effect chain tracking |
| `@aura/policy` | Policy engine and store for advisory policy hints (Prefer/Avoid/Warn) |
| `@aura/epistemic-runtime` | Orchestration of the full Belief->Concept->Causal->Policy maintenance chain |
| `@aura/platform-node` | **Only layer importing `node:*`** -- provides live implementations of `FileRead`, `FileWrite`, `Clock`, `Crypto` |
| `@aura/code-extraction` | Tree-sitter-based AST code graph extraction for dead code detection and symbol indexing |

## Quick Start

### Prerequisites

- **Bun** (recommended) or **Node.js** >= 22
- **TypeScript** 5.6+

### Install

```bash
# Clone the repository
git clone https://github.com/yuyi919/AuraSDK.git
cd AuraSDK/typescript

# Install dependencies
bun install
```

### Verify Build

```bash
# Type-check the entire workspace
bun run typecheck

# Run the test suite
bun run test
```

### Minimal Usage

```typescript
import { Aura, DefaultLayer } from "@aura/core";
import { FileRead, FileWrite, Clock, Crypto } from "@aura/contract";
import { NodeFileRead, NodeFileWrite, NodeClock, NodeCrypto } from "@aura/platform-node";
import { Effect, Layer } from "effect";

// Assemble the platform layer (only layer importing node:*)
const platformLive = Layer.mergeAll(
  NodeFileRead.Live,
  NodeFileWrite.Live,
  NodeClock.Live,
  NodeCrypto.Live,
);

// Compose with Aura's default cognitive layer and run
const program = Effect.gen(function* () {
  const aura = yield* Aura.open("./my_brain");

  // Store a record
  const record = yield* aura.store("User prefers dark mode");
  console.log("Stored:", record.id);

  // Recall relevant records
  const results = yield* aura.recall_structured("user preferences", { top_k: 5 });
  console.log("Recalled:", results.length, "records");

  return results;
});

const mainLayer = platformLive.pipe(
  Layer.provideMerge(DefaultLayer("./my_brain")),
);

Effect.runPromise(Effect.provide(program, mainLayer));
```

## Project Structure

```
typescript/
├── package.json           # Workspace root, scripts
├── tsconfig.json          # TypeScript config with path aliases
├── vitest.config.ts       # Test config
├── bun.lock               # Bun lockfile
├── packages/
│   ├── contract/          # Domain types and context tags
│   ├── utils/             # Pure utility functions
│   ├── codec/             # Binary / crypto primitives
│   ├── indexing/          # Inverted index and Roaring bitmaps
│   ├── storage/           # Persistence and read models
│   ├── recall/            # Recall pipeline algorithms
│   ├── core/              # Aura facade and public API
│   ├── belief/            # Belief engine
│   ├── concept/           # Concept engine
│   ├── causal/            # Causal engine
│   ├── policy/            # Policy engine
│   ├── epistemic-runtime/ # Maintenance chain orchestration
│   ├── platform-node/     # Node.js platform implementations
│   └── code-extraction/   # Tree-sitter code graph extraction
└── test/
    └── fixtures/          # Shared test data
```

## Scripts

| Command | Description |
|---------|-------------|
| `bun run test` | Run all tests via Vitest |
| `bun run test:watch` | Run tests in watch mode |
| `bun run typecheck` | Type-check the entire workspace with `tsc --noEmit` |

## Architecture Highlights

- **Layered DI**: Services defined as `Context.Tag` in `@aura/contract`, live implementations in `@aura/platform-node`. Core logic never imports `node:*` directly.
- **Recall pipeline**: `Query -> SDRInterpreter -> Signal Collectors -> RRF Fusion -> Graph/Causal Walk -> Trust/Recency -> Scored Results`
- **Maintenance chain**: `Record -> Belief -> Concept -> Causal -> Policy -> EpistemicRuntime/EpistemicTrace`
- **Error handling**: Tagged errors with explicit types in the Effect `E` channel; defects (`Effect.die`) for unimplemented features

## Contributing

This is a research/learning project for the AuraSDK cognitive architecture. The TypeScript monorepo focuses on disk format parity with the Rust core and cross-platform cognitive runtime capabilities.

## License

MIT. See the [parent repository LICENSE](https://github.com/yuyi919/AuraSDK/blob/main/LICENSE) for details.

The project also has patent pending (US 63/969,703) on core architectural concepts -- see the parent repository for full patent and commercial licensing information.
