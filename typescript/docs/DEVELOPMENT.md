<!-- generated-by: gsd-doc-writer -->

## Local setup

### Prerequisites

- **Bun** (primary package manager; the lock file is `bun.lock`)
- **TypeScript >= 5.6** (managed by the project's `devDependencies`)
- **Git** for cloning the repository

### Clone and install

```bash
git clone <repo-url>
cd AuraSDK/typescript
bun install
```

`bun install` in the root installs all workspace packages in one pass. No per-package install step is needed.

### Type-check

```bash
bun run typecheck
```

This runs `tsc -p tsconfig.json --noEmit`, performing a full type-check without producing output files. No build step exists -- each workspace package exports TypeScript source directly from `src/index.ts`, and Bun resolves `.ts` files at runtime.

## Build commands

| Command | Description |
|---|---|
| `bun run test` | Run the full test suite once (`vitest run --passWithNoTests`) |
| `bun run test:watch` | Run tests in watch mode (`vitest --passWithNoTests`) |
| `bun run typecheck` | Type-check the entire monorepo (`tsc --noEmit`) |

The `--passWithNoTests` flag ensures the suite exits successfully even if no test files are found -- important for a monorepo where test coverage is uneven across packages.

There is no `build` command. The project does not compile TypeScript to JavaScript -- Bun and Vitest both resolve `.ts` source files natively.

## Code style

No linter or formatter (ESLint, Prettier, Biome, `.editorconfig`) is configured at the project root. Code style is maintained by convention and enforced by TypeScript `strict` mode with `noUncheckedIndexedAccess`.

Key style conventions:

- **ESM only** -- no CommonJS. All packages declare `"type": "module"`.
- **No `any` or `unknown` in Effect error channels** -- all error types are explicit `Data.TaggedError` subclasses.
- **Type-only imports** use the `type` keyword explicitly: `import type { RecallView } from "@aura/contract"`.
- **No linter/formatter** currently configured; consistency is maintained by convention and TypeScript strict checks.

### Naming conventions

| Construct | Pattern | Example |
|---|---|---|
| Types / Interfaces | PascalCase | `RecallView`, `StoreOptions` |
| Effect services | PascalCase noun | `FileRead`, `Clock` |
| Live layers | PascalCase + Live | `NodeFileReadLive`, `RecallViewLive` |
| Tagged errors | PascalCase + Error | `FileReadError`, `JsonParseError` |
| Functions | camelCase | `recallScored`, `computeEffectiveTrust` |
| Constants / enums | PascalCase | `Level`, `DEFAULT_NAMESPACE` |

### Rust parity conventions

This project is a 1:1 TypeScript rewrite of a Rust Aura core. To track divergence, comment markers are placed in the source code:

- `SIMPLE IMPLEMENTATION:` -- simplified approach with reason and Rust reference
- `NON-PARITY IMPLEMENTATION:` -- intentional divergence with reason
- `UNIMPLEMENTED:` -- placeholder with reason and Rust reference
- `TODO:` -- pending work

These markers are globally searchable and help contributors understand implementation intent.

### Path aliases

All cross-package imports use `@aura/*` aliases. Relative imports across packages are not allowed. Aliases are configured in both `tsconfig.json` (`paths`) and `vitest.config.ts` (`resolve.alias`):

| Alias | Maps to |
|---|---|
| `@aura/contract` | `packages/contract/src/index.ts` |
| `@aura/utils` | `packages/utils/src/index.ts` |
| `@aura/codec` | `packages/codec/src/index.ts` |
| `@aura/indexing` | `packages/indexing/src/index.ts` |
| `@aura/storage` | `packages/storage/src/index.ts` |
| `@aura/recall` | `packages/recall/src/index.ts` |
| `@aura/core` | `packages/core/src/index.ts` |
| `@aura/platform-node` | `packages/platform-node/src/index.ts` |
| `@aura/belief` | `packages/belief/src/index.ts` |
| `@aura/concept` | `packages/concept/src/index.ts` |
| `@aura/causal` | `packages/causal/src/index.ts` |
| `@aura/policy` | `packages/policy/src/index.ts` |
| `@aura/epistemic-runtime` | `packages/epistemic-runtime/src/index.ts` |

Wildcard sub-path aliases (`@aura/<name>/*`) are also configured for each package.

Note: the `@aura/code-extraction` package exists in `packages/code-extraction/` but does not have `@aura/*` path aliases configured in `tsconfig.json` or `vitest.config.ts`. It is not currently imported by any other workspace package.

## Branch conventions

No branch naming conventions are documented in the repository. The main branch is called `main`.

<!-- VERIFY: Branch conventions may be documented externally (project wiki, Notion, etc.) -->

## PR process

No PR template or CI workflow configuration exists in the repository. There is no `.github/` directory at this time.

When contributing changes:

1. Ensure `bun run typecheck` passes with no errors.
2. Run `bun run test` and confirm all tests pass.
3. Keep changes focused -- each commit should address a single concern.
4. Follow the existing code conventions, especially for Effect-TS patterns and Rust parity markers.
5. Add co-located tests for new behavior (see [Testing conventions](#testing-conventions)).

<!-- VERIFY: PR review process -- no PR template or CI config exists in the repo; external review process may be documented elsewhere -->

## Workspace structure

### Monorepo layout

The root `package.json` declares a single workspace glob: `packages/*`. All 14 workspace packages follow a flat `src/` layout.

```
typescript/
├── package.json           # Workspace root, scripts, shared deps
├── tsconfig.json          # TypeScript config with path aliases
├── vitest.config.ts       # Test config with package aliases
├── bun.lock               # Bun lockfile
├── test/fixtures/         # Shared test fixtures
├── docs/                  # Project documentation
└── packages/              # 14 workspace packages
    ├── contract/          # Domain types, enums, context tags, errors
    ├── utils/             # Pure utilities (bytes, hex, crc32, id12, time)
    ├── codec/             # Binary/Bincode serialization, crypto primitives
    ├── indexing/          # InvertedIndex, Roaring bitmap serialization
    ├── storage/           # File parsers, read models, snapshots
    ├── recall/            # Recall pipeline algorithms (signals, RRF, trust)
    ├── core/              # Facade: Aura class, recall entrypoints, default layer
    ├── belief/            # Belief engine and store
    ├── concept/           # Concept engine and store
    ├── causal/            # Causal engine and store
    ├── policy/            # Policy engine and store
    ├── epistemic-runtime/ # Runtime orchestration and tracing
    ├── platform-node/     # Node.js Live layers (FileRead, FileWrite, Clock, Crypto)
    └── code-extraction/   # CodeGraph: local-first semantic code knowledge graph
```

### Package internal structure

Each package follows a flat `src/` layout:

```
packages/<name>/
├── package.json           # Minimal: { name, private: true, type: "module", exports }
└── src/
    ├── index.ts           # Barrel export (re-exports all public symbols)
    ├── <Feature>.ts       # Implementation
    ├── <Feature>.test.ts  # Co-located tests (if any)
    └── <subdirs>/         # Grouped types (e.g., levels/, record/, sdr/)
```

The exception is `@aura/contract`, which uses subdirectories to organize related type groups (`levels/`, `record/`, `relation/`, `sdr/`, `belief/`, `concept/`).

### Package.json conventions

All workspace packages are:

- **Private** (`"private": true`) -- not published to npm.
- **ESM** (`"type": "module"`).
- **Entry-point** exports use `"exports": { ".": "./src/index.ts" }`, pointing directly to TypeScript source.

Dependencies are declared at the root `package.json` only where they are shared across packages. The `@aura/code-extraction` package is the exception, declaring its own `dependencies` (tree-sitter-related packages).

## Contract to implementation pattern

The project follows the Effect-TS layered DI pattern. Services are defined as abstract contracts in `@aura/contract` and implemented as Live layers in platform or engine packages.

### 1. Define the service contract

In `packages/contract/src/`, create a service tag using `Context.Tag`:

```typescript
// packages/contract/src/FileRead.ts
import { Effect } from "effect"
import { Tag } from "./Context"
import { FileReadError } from "./Errors"

export class FileRead extends Tag("aura.contract.FileRead")<
  FileRead,
  {
    readFile: (path: string) => Effect.Effect<Uint8Array, FileReadError>
    exists: (path: string) => Effect.Effect<boolean, FileReadError>
    stat: (path: string) => Effect.Effect<FileStat, FileReadError>
  }
>() {}
```

The `Tag()` helper is defined in `packages/contract/src/Context.ts` as a thin wrapper around `Context.Service`.

### 2. Define error types

In `packages/contract/src/Errors.ts`, define tagged errors using `Data.TaggedError`:

```typescript
export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}
```

Never use `unknown` or `any` in Effect error channels. Error types must be explicit and enumerable.

### 3. Implement the Live layer

Platform-specific implementations go in `@aura/platform-node`:

```typescript
// packages/platform-node/src/NodeFileRead.ts
import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileRead, FileReadError } from "@aura/contract"

export const NodeFileReadLive = Layer.succeed(FileRead, {
  readFile: (p) =>
    Effect.tryPromise(() => fs.readFile(p).then((b) => new Uint8Array(b))).pipe(
      Effect.mapError((cause) => new FileReadError({ path: p, cause }))
    ),
  exists: (p) =>
    Effect.tryPromise(() => fs.stat(p).then(() => true).catch(() => false)).pipe(
      Effect.mapError((cause) => new FileReadError({ path: p, cause }))
    ),
  stat: (p) =>
    Effect.tryPromise(() => fs.stat(p).then((s) => ({ size: s.size }))).pipe(
      Effect.mapError((cause) => new FileReadError({ path: p, cause }))
    )
})
```

Key rules for live layers:

- **Only `@aura/platform-node` may import `node:*`**. Core packages (`storage`, `indexing`, `recall`, `codec`) must never reference `node:*` directly.
- Use `Layer.succeed` for synchronous/object-based service implementations.
- Use `Layer.effect` for effectful construction that requires dependencies.
- Wrap platform IO in `Effect.tryPromise` and map errors to typed tagged errors.

### 4. Assemble the layer composition

In `packages/core/src/DefaultLayer.ts`, compose layers with `Layer.mergeAll`:

```typescript
export function DefaultLayer(brainDir: string) {
  return Layer.mergeAll(
    RecallViewLive(brainDir),
    BeliefStoreLive(brainDir),
    BeliefEngineLive,
    ConceptStoreLive(brainDir),
    ConceptEngineLive,
    CausalStoreLive(brainDir),
    CausalEngineLive,
    PolicyStoreLive(brainDir),
    PolicyEngineLive,
    EpistemicRuntimeLive,
    EpistemicTraceLive
  )
}
```

### Optional service pattern

Services that may or may not be present use `serviceOption`:

```typescript
const traceOpt = yield* serviceOption(EpistemicTrace)
if (Option.isSome(traceOpt)) {
  yield* traceOpt.value.event("belief.update_with_sdr.start", { records: records.size })
}
```

Both paths (service present and absent) must be tested.

## Effect-TS patterns

### Dependency injection

Services are provided at the call site, not imported statically:

```typescript
// Usage -- service is required in the Effect type signature
const result = yield* Effect.service(FileRead)
const buf = yield* result.readFile(somePath)

// Provision at call boundary
Effect.runPromise(myEffect.pipe(Effect.provide(NodeFileReadLive)))
```

### pipe style

Effects are composed using `.pipe()` and Effect combinators:

```typescript
Effect.tryPromise(() => fs.readFile(p)).pipe(
  Effect.mapError((cause) => new FileReadError({ path: p, cause }))
)
```

### Effect.gen for generators

Complex effects that require sequential yields use `Effect.gen`:

```typescript
Effect.gen(function* () {
  const { nowSeconds } = yield* Effect.service(Clock)
  const fs = yield* Effect.service(FileRead)
  const buf = yield* fs.readFile(path)
  return process(buf)
})
```

### Time handling

Always use `nowSecs()` from `@aura/utils/Time` instead of `Date.now() / 1000`. This ensures consistent seconds-level timestamp behavior across the codebase and allows deterministic time in tests (via `Clock.fixed`).

## How to add a new package

1. **Create the directory**: `mkdir packages/<new-pkg>/src`

2. **Add `package.json`**:
   ```json
   {
     "name": "@aura/<new-pkg>",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts"
     }
   }
   ```

3. **Create the barrel export**: `packages/<new-pkg>/src/index.ts` that re-exports all public symbols.

4. **Add path aliases** in both config files:
   - In `tsconfig.json` `compilerOptions.paths`, add:
     ```json
     "@aura/<new-pkg>": ["packages/<new-pkg>/src/index.ts"],
     "@aura/<new-pkg>/*": ["packages/<new-pkg>/src/*"]
     ```
   - In `vitest.config.ts` `resolve.alias`, add:
     ```typescript
     "@aura/<new-pkg>": pkg("<new-pkg>")
     ```

5. **Run `bun install`** to link the workspace package.

6. **Import** from the new package using the `@aura/<new-pkg>` alias. Never use relative paths across package boundaries.

## Testing conventions

### Framework

Tests use **Vitest 2.0+** with `globals: true` and `environment: "node"`. The `@effect/vitest` package provides Effect-native assertions.

Test globals (`describe`, `it`, `expect`) are available without explicit imports. Import `assert` from `@effect/vitest` for type-safe assertions.

### File organization

Tests are **co-located** beside the source files they test:

```
packages/<pkg>/src/
├── Feature.ts
└── Feature.test.ts
```

### Writing tests

```typescript
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"

it("describes the expected behavior", async () => {
  const result = await Effect.runPromise(
    myEffect.pipe(Effect.provide(MyLiveLayer))
  )
  assert.strictEqual(result, expected)
})
```

### Test categories

Tests fall into several categories:

| Category | Pattern | Example |
|---|---|---|
| Unit | Algorithmic functions with deterministic inputs | `Trust.test.ts` |
| Roundtrip | Serialize to deserialize identity check | `InvertedIndex.roundtrip.test.ts` |
| Rust parity | Spawn Rust binary, compare TS output to Rust output | `Recall.parity.test.ts` |
| Optional service | Test both "service present" and "service absent" paths | Pipeline tests with/without `BoundedReranker` |
| Layer integration | Verify layer assembly and wiring | `DefaultLayer.test.ts` |

### Rust parity test pattern

Some tests verify disk format and behavioral parity with the Rust implementation:

```typescript
const gen = spawnSync("cargo", ["run", "--bin", "aura-ts-recall-fixtures", "--", dir], ...)
const rust = spawnSync("cargo", ["run", "--bin", "aura-ts-verify-recall", "--", dir, query], ...)
const rustIds: string[] = JSON.parse(rust.stdout.trim())
const tsIds = scored.map(([, id]) => id)
assert.deepStrictEqual(tsIds, rustIds)
```

### Fixtures

Shared test fixtures live in `test/fixtures/` at the project root. Tests reference them via `path.join(process.cwd(), "test/fixtures/...")`.

### Coverage

No coverage threshold is configured. Test coverage is uneven across packages -- `@aura/storage` has the most tests (13 files), while `@aura/platform-node` and `@aura/code-extraction` have none. `@aura/causal` has 1 test file, `@aura/policy` has 2 test files, and `@aura/epistemic-runtime` has 1 test file.

## Common development tasks

### Type-check after changes

```bash
bun run typecheck
```

Always run this before committing. The TypeScript `strict` mode with `noUncheckedIndexedAccess` catches many categories of errors at compile time.

### Run a single test file

```bash
bun run vitest run packages/belief/src/BeliefEngine.test.ts
```

Or in watch mode:

```bash
bun run vitest packages/belief/src/BeliefEngine.test.ts
```

### Run tests for a specific package

```bash
bun run vitest run packages/belief
```

### Debug type errors in a specific package

```bash
bun run tsc --noEmit --project tsconfig.json | grep "@aura/belief"
```

### Following the Rust parity workflow

When adding or modifying behavior:

1. Locate the corresponding Rust source and understand its intent.
2. Implement the TypeScript version following existing conventions.
3. Mark any divergence with a globally-searchable marker:
   - `SIMPLE IMPLEMENTATION:` -- simplified approach
   - `NON-PARITY IMPLEMENTATION:` -- intentional divergence
   - `UNIMPLEMENTED:` -- placeholder / not yet done
4. If the Rust side has test fixtures, add a parity test using `spawnSync` to verify identical output.

### Adding an Effect service

1. Define the tag in `@aura/contract` using `Tag("namespace.Name")`.
2. Add error types to `@aura/contract/src/Errors.ts` if needed.
3. Implement the Live layer (in `@aura/platform-node` for IO, in engine packages for logic).
4. Export the Live layer from the package's `index.ts`.
5. Wire it into `DefaultLayer` in `@aura/core` if it's part of the standard composition.
6. Write co-located tests covering both service-provided and service-absent paths (if optional).
