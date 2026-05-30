<!-- generated-by: gsd-doc-writer -->

---

title: Configuration
description: Project configuration reference for the Aura monorepo

---

## Package manager

The project uses **Bun** as the primary package manager. The lock file is `bun.lock`.

The `package.json` root declares a `"workspaces": ["packages/*"]` field.

### Install dependencies

```bash
bun install
```

Running `bun install` in the root installs all workspace packages in one pass. No per-package install step is needed.

## TypeScript configuration

All TypeScript settings reside in the root `tsconfig.json`. There are no per-package `tsconfig.json` overrides.

### Compiler options

| Option | Value | Purpose |
|---|---|---|
| `target` | `ES2022` | Emit modern JS; supported by Bun, Node >= 18 |
| `module` | `ESNext` | Produce ES module syntax |
| `moduleResolution` | `Bundler` | Resolves specifiers the same way Bun/bundlers do |
| `strict` | `true` | Enable all strict type-checking flags |
| `noUncheckedIndexedAccess` | `true` | Treat `T[key]` as `T[key] \| undefined` |
| `skipLibCheck` | `true` | Skip `.d.ts` validation for faster type-checking |
| `types` | `["node", "vitest/globals"]` | Include Node and Vitest global type declarations |
| `baseUrl` | `"."` | Project root for path mapping resolution |

### Path aliases

All packages are mapped under the `@aura/*` scope, with each package's entry pointing to `packages/<name>/src/index.ts`:

| Alias | Maps to |
|---|---|
| `@aura/codec` | `packages/codec/src/index.ts` |
| `@aura/storage` | `packages/storage/src/index.ts` |
| `@aura/core` | `packages/core/src/index.ts` |
| `@aura/contract` | `packages/contract/src/index.ts` |
| `@aura/utils` | `packages/utils/src/index.ts` |
| `@aura/platform-node` | `packages/platform-node/src/index.ts` |
| `@aura/indexing` | `packages/indexing/src/index.ts` |
| `@aura/recall` | `packages/recall/src/index.ts` |
| `@aura/belief` | `packages/belief/src/index.ts` |
| `@aura/concept` | `packages/concept/src/index.ts` |
| `@aura/causal` | `packages/causal/src/index.ts` |
| `@aura/policy` | `packages/policy/src/index.ts` |
| `@aura/epistemic-runtime` | `packages/epistemic-runtime/src/index.ts` |

Wildcard sub-path aliases (`@aura/<name>/*`) are also configured for each package, mapping to corresponding `src/*` subdirectories.

### Files included

The compiler includes:

- `packages/**/*.ts` (all workspace packages)
- `vitest.config.ts` (the test runner config)

### Type-checking

```bash
bun run typecheck
```

This runs `tsc -p tsconfig.json --noEmit`, performing a full type-check without producing output files.

## Test runner configuration

Tests are run with **Vitest** (configured in `vitest.config.ts` in the project root).

### Vitest settings

| Setting | Value | Purpose |
|---|---|---|
| `test.globals` | `true` | Expose `describe`, `it`, `expect` globally without imports |
| `test.environment` | `"node"` | Run tests in a Node.js environment (no DOM) |
| `resolve.alias` | (see below) | Mirrors the `@aura/*` path aliases from `tsconfig.json` |

### Resolve aliases

The Vitest config defines path aliases for all 13 workspace packages so that `@aura/<name>` imports resolve correctly during test runs:

- `@aura/codec`, `@aura/storage`, `@aura/core`, `@aura/contract`, `@aura/utils`, `@aura/platform-node`, `@aura/indexing`, `@aura/recall`, `@aura/belief`, `@aura/concept`, `@aura/causal`, `@aura/policy`, `@aura/epistemic-runtime`

All 13 packages are aliased in both `tsconfig.json` and `vitest.config.ts`. The `@aura/code-extraction` package is not aliased in either config — it is resolved directly by Bun via the workspace protocol.

### Test commands

| Command | Description |
|---|---|
| `bun run test` | Run the full test suite once (`vitest run --passWithNoTests`) |
| `bun run test:watch` | Run tests in watch mode (`vitest --passWithNoTests`) |

The `--passWithNoTests` flag ensures the suite exits successfully even if no test files are found, which is important for a monorepo where test coverage may be uneven across packages.

### Test globals

Because `test.globals` is enabled and `vitest/globals` appears in the TypeScript `types` array, test files can use `describe`, `it`, `expect`, and other Vitest globals without explicit imports.

The `@effect/vitest` utility is available as a dependency for testing Effect-based code; import it in test files that exercise Effect services and layers.

## Monorepo workspace setup

### Workspace structure

The root `package.json` declares a single workspace glob:

```
packages/*
```

This matches the following packages:

| Package directory | Scoped name | Description |
|---|---|---|
| `packages/belief` | `@aura/belief` | Belief inference module |
| `packages/causal` | `@aura/causal` | Causal reasoning module |
| `packages/codec` | `@aura/codec` | Encoding/decoding primitives |
| `packages/code-extraction` | `@aura/code-extraction` | Source code parsing and extraction |
| `packages/concept` | `@aura/concept` | Concept modeling |
| `packages/contract` | `@aura/contract` | Type contracts and schemas |
| `packages/core` | `@aura/core` | Core abstractions |
| `packages/epistemic-runtime` | `@aura/epistemic-runtime` | Epistemic runtime engine |
| `packages/indexing` | `@aura/indexing` | Data indexing utilities |
| `packages/platform-node` | `@aura/platform-node` | Node.js platform bindings |
| `packages/policy` | `@aura/policy` | Policy evaluation |
| `packages/recall` | `@aura/recall` | Recall/memory module |
| `packages/storage` | `@aura/storage` | Storage layer |
| `packages/utils` | `@aura/utils` | Shared utility functions |

### Package conventions

All workspace packages are:

- **Private** (`"private": true` in each `package.json`) -- not published to npm.
- **ESM** (`"type": "module"` in each `package.json`).
- **Entry-point** exports use `"exports": { ".": "./src/index.ts" }`, pointing directly to TypeScript source. Bun (and Vitest) resolve `.ts` files natively.

## Environment variables

The project does not ship a `.env.example` file. Environment variables are primarily used by the `@aura/code-extraction` package to control debug output and runtime behavior.

### Variables used at runtime

| Variable | Required | Default | Description |
|---|---|---|---|
| `CODEGRAPH_DEBUG` | Optional | (unset) | When set to any truthy value, enables debug-level logging to `console.debug` in the code-extraction package's default logger. |
| `CODEGRAPH_RESOLVER_CACHE_SIZE` | Optional | `5000` | Sets the per-cache entry limit for the import resolver in `@aura/code-extraction`. Must be a positive integer. Values below 1 are ignored and the default is used. |
| `CODEGRAPH_NO_RELAUNCH` | Optional | (unset) | When set to any truthy value, prevents the WASM runtime flags relaunch mechanism in `@aura/code-extraction`. Useful when the Node.js process already has the required V8 flags. |
| `CODEGRAPH_WASM_RELAUNCHED` | Internal | (set automatically) | Internal guard flag set during the WASM relaunch process. Do not set manually. |
| `CODEGRAPH_HOST_PPID` | Internal | (set automatically) | Internal variable holding the parent PID during WASM relaunch. Do not set manually. |

### No startup-critical variables

None of the environment variables are required for the project to start or pass type-checking. All variables control optional behavior in the `@aura/code-extraction` package.

## Build configuration

The project does not define a build step. Each workspace package exports TypeScript source directly from `src/index.ts`, and Bun resolves `.ts` files at runtime without a separate compilation phase.

The root `package.json` scripts do not include a `build` command. Type-checking (`bun run typecheck`) is the closest equivalent to a build verification step.

## Linting and formatting

No linter or formatter configuration files (ESLint, Prettier, Biome, `.editorconfig`) are present at the project root. Code style enforcement is handled by the TypeScript compiler's `strict` mode.

## CI/CD

No CI/CD workflow configuration was found in the repository. There is no `.github/workflows/` directory at this time.

<!-- VERIFY: CI/CD pipeline status -- no workflow files found in the repo, but external CI may be configured outside the repository -->
