<!-- generated-by: gsd-doc-writer -->

# Getting Started

This guide walks you through setting up the AuraSDK TypeScript monorepo and running your first knowledge-graph operations using the public `Aura` facade.

## Prerequisites

- **Bun** (recommended) -- install from [bun.sh](https://bun.sh), or
- **Node.js** >= 22 (tested with `@types/node` v22)
- **TypeScript** 5.6+

The project optionally depends on WASM packages for core primitives:

| WASM Package | Purpose |
|--------------|---------|
| `roaring-wasm` | Roaring bitmap operations for inverted indexes |
| `xxhash-wasm` | High-speed fingerprint hashing |
| `argon2-wasm-edge` | Memory-hard key derivation for cryptographic operations |

These are bundled with the dependency tree and do not require a separate WASM runtime.

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yuyi919/AuraSDK.git
   cd AuraSDK/typescript
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

   The workspace root is managed by Bun. All 14 packages under `packages/` share a single `bun.lock`.

## Project Structure Overview

```
typescript/
├── package.json           # Workspace root, scripts
├── tsconfig.json          # TypeScript config with path aliases (@aura/*)
├── vitest.config.ts       # Test config
├── bun.lock               # Bun lockfile
├── packages/
│   ├── contract/          # Domain types, enums, context tags, errors
│   ├── utils/             # Pure utility functions (IDs, hex, CRC32)
│   ├── codec/             # Binary serialization and crypto primitives
│   ├── indexing/          # Inverted index with Roaring bitmap storage
│   ├── storage/           # Persistence layer (brain.aura, brain.cog)
│   ├── recall/            # Recall pipeline (signals, RRF fusion, scoring)
│   ├── core/              # Public facade: Aura, DefaultLayer
│   ├── belief/            # Belief engine and store
│   ├── concept/           # Concept engine and store
│   ├── causal/            # Causal engine and store
│   ├── policy/            # Policy engine and store
│   ├── epistemic-runtime/ # Belief -> Concept -> Causal -> Policy chain
│   ├── platform-node/     # Node.js platform implementations (no Node:* in core)
│   └── code-extraction/   # Tree-sitter-based code graph extraction
└── test/
    └── fixtures/          # Shared test brain images
```

The architecture follows an **Effect-TS layered dependency injection** pattern: domain services are defined as `Context.Tag` in `@aura/contract`, core logic never imports `node:*` directly, and live implementations live only in `@aura/platform-node`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed system overview.

## First Steps

Verify the workspace compiles and tests pass:

### Type-check the entire workspace

```bash
bun run typecheck
```

Runs `tsc -p tsconfig.json --noEmit` against all 14 packages. This confirms TypeScript compilation correctness without emitting output files.

### Run the test suite

```bash
bun run test
```

Runs all test files across the workspace with Vitest. Tests use `@effect/vitest` for Effect-TS integration and operate on temporary directories so no state persists between runs.

### Run tests in watch mode (development loop)

```bash
bun run test:watch
```

Re-runs affected tests on file change, useful during development.

### Run tests for a single package

```bash
bun vitest run packages/core
```

Scopes test execution to a specific package directory.

## Minimal Working Example

The following example opens an Aura brain, stores a record, and recalls it. It demonstrates the standard Effect-TS layer composition pattern used throughout the project:

```typescript
import { Aura, DefaultLayer } from "@aura/core";
import {
  NodeFileReadLive,
  NodeFileWriteLive,
  NodeClockLive,
  NodeCryptoLive,
} from "@aura/platform-node";
import { Effect, Layer } from "effect";

// Step 1: Assemble the platform layer.
// This is the only layer that imports node:* APIs.
const platformLive = Layer.mergeAll(
  NodeFileReadLive,
  NodeFileWriteLive,
  NodeClockLive,
  NodeCryptoLive,
);

// Step 2: Define the application logic using Effect.gen.
const program = Effect.gen(function* () {
  // Open a brain at the given path.
  // If the brain does not exist, it will be created on first store.
  const aura = yield* Aura.open("./my_brain");

  // Store a plain-text record.
  const record = yield* aura.store("User prefers dark mode");
  console.log("Stored:", record.id);

  // Store a tagged record with options.
  const tagged = yield* aura.store("Meeting notes: Q1 retro", {
    tags: ["meeting", "retro", "Q1"],
    level: "Important",
  });
  console.log("Stored tagged:", tagged.id);

  // Recall records matching a query.
  const results = yield* aura.recall_structured("user preferences", {
    top_k: 5,
  });
  console.log("Recalled:", results.length, "records");

  return results;
});

// Step 3: Compose the platform layer with Aura's cognitive layer.
const mainLayer = platformLive.pipe(
  Layer.provideMerge(DefaultLayer("./my_brain")),
);

// Step 4: Run the program.
Effect.runPromise(Effect.provide(program, mainLayer));
```

**Key concepts in this example:**

- **`Aura.open(path)`** -- Opens a brain directory. Reads `brain.aura` for the record index and validates the persistence manifest.
- **`aura.store(content, options?)`** -- Writes a record to the append-only cognitive log (`brain.cog`) with optional tags, level, namespace, and metadata.
- **`aura.recall_structured(query, options?)`** -- Runs the multi-signal recall pipeline (tag index, SDR similarity, n-gram matching, RRF fusion, graph expansion) and returns scored, full records.
- **Layer composition** -- The `platformLive` layer (file I/O, clock, crypto) is merged with `DefaultLayer` (belief/concept/causal/policy engines). Core logic stays pure; platform specifics are injected.

See [CONFIGURATION.md](./CONFIGURATION.md) for details on configurable options like brain paths, recall pipeline parameters, and storage settings.

## Common Setup Issues

### Wrong Bun or Node.js version

The project requires **Node.js >= 22**. If you see errors about missing APIs (e.g., `ReadableStream`, `fetch`, or updated `node:fs` behavior), check your runtime version:

```bash
node --version  # should print v22.x.x or later
bun --version   # should be 1.x or later
```

If using `nvm`, run `nvm install 22 && nvm use 22` before installing dependencies.

### WASM build failures

If you see errors related to `roaring-wasm`, `xxhash-wasm`, or `argon2-wasm-edge`, ensure your platform supports WebAssembly. WASM packages are shipped as pre-built binaries -- a standard Bun or Node.js 22+ installation should include WASM support out of the box.

### Path alias resolution errors in IDE

The workspace uses TypeScript path aliases (e.g., `@aura/core` maps to `packages/core/src/index.ts`). If your IDE (VS Code, IntelliJ) reports "Cannot find module" errors:

1. Ensure the workspace root `tsconfig.json` is the active TypeScript project (VS Code: open the `typescript/` folder as the workspace root, not a sub-package).
2. Run `tsc -p tsconfig.json --noEmit` to verify the aliases resolve correctly from the command line.

### Missing `temporal.bin` when opening a fresh brain

`Aura.open()` expects a valid brain directory with a `temporal.bin` file. If you are creating a new brain for experimentation, copy the minimal fixture:

```bash
cp -r test/fixtures/minimal_brain ./my_brain
```

Alternatively, use `BrainAuraFile.open()` and `BrainAuraFile.append()` to bootstrap a new brain programmatically (see `packages/core/src/Aura.test.ts` for the pattern).

## Next Steps

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** -- System design, data flow, and key abstractions.
- **[CONFIGURATION.md](./CONFIGURATION.md)** -- Environment variables, brain paths, and recall pipeline tuning.
- **Package READMEs** under `packages/*/` for per-package API details.
- **Test files** at `packages/core/src/*.test.ts` for executable usage examples of the public API.
