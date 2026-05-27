<!-- generated-by: gsd-doc-writer -->

---

title: Testing

---

## Overview

The Aura TypeScript monorepo uses **Vitest** as its test runner, with **`@effect/vitest`** for assertions that integrate naturally with the project's Effect-based architecture. Tests are co-located with their source files under `packages/*/src/` and use the `*.test.ts` naming convention.

## Test framework and setup

| Component | Tool | Version |
|---|---|---|
| Test runner | [Vitest](https://vitest.dev) | `^2.0.0` |
| Assertions | `@effect/vitest` | `4.0.0-beta.68` |
| Effect runtime | `effect` | `4.0.0-beta.68` |
| Environment | `node` (from vitest config) | -- |

Tests use `globals: true` (vitest globals enabled via config), so `it`, `expect`, `describe` and other vitest functions are available without explicit imports. However, the project convention is to explicitly import `it` from `vitest` and `assert` from `@effect/vitest` in every test file.

No additional test setup or configuration files beyond the root `vitest.config.ts` are required. The config maps workspace package aliases (`@aura/core`, `@aura/storage`, etc.) to their source entry points so that cross-package imports resolve correctly during test runs.

## Running tests

### Full suite

```bash
bun run test
```

This executes `vitest run --passWithNoTests`, which runs all `*.test.ts` files across all workspace packages once and exits. The `--passWithNoTests` flag prevents failure when a package has no test files.

### Watch mode

```bash
bun run test:watch
```

This executes `vitest --passWithNoTests` in watch mode, re-running affected tests on file changes.

### Running a specific test file

```bash
bun vitest run packages/recall/src/Trust.test.ts
```

### Per-package test isolation

```bash
bun vitest run packages/recall/src/
```

### Type checking

```bash
bun run typecheck
```

Runs `tsc -p tsconfig.json --noEmit` to verify type correctness across the entire monorepo. Type checking is separate from test execution.

## Test structure conventions

### File placement

Tests live next to the source they exercise:

```
packages/recall/src/Trust.ts
packages/recall/src/Trust.test.ts       <-- co-located test
```

There are currently **32 test files** across 8 packages. Fixture data common to multiple packages lives under `test/fixtures/` at the monorepo root.

### File naming

All test files use the `*.test.ts` suffix. The project does not use `*.spec.ts`.

### Test organization

Tests use flat `it` blocks directly at the top level of the file. The project does **not** use `describe` blocks for test grouping. Each `it` block is self-contained with a descriptive name that explains the behavior being verified.

### Imports convention

Every test file follows a consistent import pattern:

```typescript
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
```

Additional imports depend on what the test exercises -- source-under-test imports and any required Effect Layer implementations.

## Assertions

The project uses `assert` from `@effect/vitest` rather than vitest's built-in `expect`. The `@effect/vitest` assert object provides a familiar chai-like API:

| Method | Usage |
|---|---|
| `assert.strictEqual(actual, expected)` | Strict equality check |
| `assert.deepStrictEqual(actual, expected)` | Deep equality (objects, arrays) |
| `assert.ok(condition)` | Truthiness check |
| `assert.isTrue(condition)` | Strict `true` check |
| `assert.isDefined(value)` | Not `undefined` check |
| `assert.isFalse(condition)` | Strict `false` check |

## Patterns

### Effect.runPromise -- executing effects in tests

Most tests call `Effect.runPromise()` to execute an Effect program and `await` its result. This is the primary pattern for running both pure and I/O-bound test logic.

Pure unit test (no dependencies):

```typescript
it("defaultTrustConfig matches Rust defaults", () => {
  const cfg = defaultTrustConfig()
  assert.strictEqual(cfg.recency_boost_max, 0.2)
})
```

For Effects with dependencies, `Effect.runPromise` wraps the entire program:

```typescript
await Effect.runPromise(
  Effect.gen(function* () {
    const f = yield* BrainAuraFile.open(dir)
    yield* f.append({ /* record */ })
    yield* f.flush()
  }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provide(NodeFileWriteLive),
    Effect.provide(NodeClockLive),
    Effect.provide(NodeCryptoLive)
  )
)
```

### Effect.gen -- generator-based effect composition

The project uses `Effect.gen(function* () {})` (generator syntax) for composing multiple Effect operations. Within the generator, `yield*` unwraps Effect values:

```typescript
const program = Effect.gen(function* () {
  const store = yield* CognitiveStoreFile.open(dir)
  for (const r of recordsToWrite) {
    yield* store.appendStore(r)
  }
  yield* store.flush()
  yield* store.writeSnapshot(recordsToWrite)
}).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
```

### Layer injection with Effect.provide

Tests that require I/O or platform services use `Effect.provide` (and `Effect.provideService`) in a `.pipe()` chain to supply the required Effect Layer implementations:

| Method | Purpose |
|---|---|
| `Effect.provide(layer)` | Provides a constructed Layer (e.g., `NodeFileReadLive`) |
| `Effect.provideService(tag, impl)` | Provides a singleton implementation for a Tag |

Common platform layers used in tests:

| Layer | Source package | Purpose |
|---|---|---|
| `NodeFileReadLive` | `@aura/platform-node` | File read capability |
| `NodeFileWriteLive` | `@aura/platform-node` | File write capability |
| `NodeClockLive` | `@aura/platform-node` | System clock access |
| `NodeCryptoLive` | `@aura/platform-node` | Cryptographic random source |

### Layer construction for service wiring

Integration tests that verify service wiring use `Layer.provide` to compose layers, then provide the result to a program:

```typescript
const layer = DefaultLayer(dir).pipe(
  Layer.provide(NodeFileReadLive),
  Layer.provide(NodeFileWriteLive),
  Layer.provide(NodeClockLive),
  Layer.provide(NodeCryptoLive)
)

const ok = await Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.service(RecallViewTag)
    yield* Effect.service(BeliefStore)
    // ... verify all services resolve
    return true as const
  }).pipe(Effect.provide(layer))
)
```

### Temp directory pattern

Tests that need file I/O create temporary directories using `fs.mkdtempSync` and prefix them with the test domain:

```typescript
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-core-recall-"))
```

This ensures tests do not interfere with each other and each test's scratch space is identifiable in case of failures.

### Fixture loading

Test fixtures live under `test/fixtures/` at the repository root. Tests reference them using `process.cwd()`:

```typescript
const fixtureDir = path.join(process.cwd(), "test/fixtures/epistemic_belief_v1")
```

Available fixture sets:

| Fixture | Contents | Used by |
|---|---|---|
| `minimal_brain/` | `temporal.bin` | Integration tests for BrainAura, Aura.open |
| `minimal_index/` | `index_manifest.json`, `sdr.idx` (Rust-generated) | InvertedIndex.load, recall pipeline tests |
| `epistemic_belief_v1/` | `records.json`, `expected.json` | BeliefEngine.update snapshot tests |

### Factory functions for test data

Tests define helper functions to construct test data with sensible defaults. Overrides are passed as partial arguments:

```typescript
function makeMeta(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    trust_score: "0.5",
    source: "user-confirmed",
    timestamp: new Date(1_700_000_000_000).toISOString(),
    ...overrides
  }
}
```

### Fake / stub implementations

When a test needs to exercise a component that depends on a service interface, the test provides a fake implementation inline rather than using a mocking library:

```typescript
const NoopTrace: EpistemicTraceImpl = {
  event: () => Effect.void,
  span: (_name, _fields, eff) => eff
}

function fakeBeliefEngine(state: BeliefEngineState): BeliefEngineImpl {
  return {
    belief_for_record: (rid) => Effect.succeed(state.record_to_belief[rid] ?? null),
    unresolved_beliefs: () => Effect.succeed(/* ... */),
    // ... remaining methods
  }
}
```

These fakes are then injected via `Effect.provideService`:

```typescript
await Effect.runPromise(
  concept.discover(fakeBeliefEngine(state), records, sdr)
    .pipe(Effect.provideService(EpistemicTrace, NoopTrace))
)
```

### Deterministic clock

Tests that depend on time use `Clock.fixed()` from `@aura/contract` to freeze the system clock to a known timestamp:

```typescript
const clock = Clock.fixed(1_700_000_000)
// ...
await Effect.runPromise(
  recallScored(dir, "ts", { topK: 10, expandConnections: false }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provideService(Clock, clock)
  )
)
```

This makes time-dependent logic (such as recency boosts in trust scoring) fully deterministic and reproducible.

## Test categories

### Unit tests

Pure logic tests with no file I/O or platform dependencies. These tests exercise algorithms directly with in-memory data.

Examples:
- `packages/recall/src/Trust.test.ts` -- trust scoring math with hardcoded metadata
- `packages/contract/src/Enums.test.ts` -- enum string values at runtime
- `packages/indexing/src/InvertedIndex.searchScored.test.ts` -- inverted index search and scoring with in-memory bitmaps
- `packages/contract/src/Recall.test.ts` -- tag provisioning and optional service resolution

### Integration tests

Tests that exercise multiple components wired together with real (or realistic) Effect Layers, including file I/O in temporary directories.

Examples:
- `packages/core/src/Aura.test.ts` -- Aura.open with BrainAuraFile + platform layers
- `packages/core/src/Recall.test.ts` -- recall pipeline from end to end (BrainAuraFile, CognitiveStoreFile, recallScored)
- `packages/core/src/DefaultLayer.test.ts` -- full layer composition and service resolution
- `packages/storage/src/BrainAura.test.ts` -- BrainAuraFile open, write, flush, read-back
- `packages/indexing/src/InvertedIndex.fixture.test.ts` -- loads Rust-generated binary fixtures
- `packages/belief/src/BeliefEngine.test.ts` -- JSON fixture-based belief resolution

### Parity tests

Cross-language verification tests that compare TypeScript output against the Rust reference implementation. These tests spawn Rust binaries as child processes and assert that the TypeScript and Rust results match exactly.

Example:
- `packages/core/src/Recall.parity.test.ts` -- spawns `aura-ts-recall-fixtures` and `aura-ts-verify-recall` Rust binaries, runs `Aura.recallScored` on the same data, and asserts identical result ordering.

Parity tests require a Rust toolchain (`cargo`) installed and the monorepo's Rust crates built. They are not expected to run in environments without Rust.

### Chinese-language tests

The belief engine has language-specific tests identified by the suffix `.zh.test.ts`.

- `packages/belief/src/BeliefEngine.zh.test.ts` -- exercises belief resolution with Chinese-language content, verifying bucket clustering, unresolved state for close scores, and resolved winner selection.

## Coverage requirements

No coverage thresholds are configured. The project does not have a coverage tool (c8, istanbul, nyc) in its dependencies and the vitest config does not define `coverage` settings.

## CI integration

No CI workflows (`.github/workflows/`) are present in this repository. Tests must be run locally via `bun run test` before submitting changes.

## Writing a new test

Follow these steps to add a test following the project's conventions:

1. **Create the test file** next to the source, using the `*.test.ts` suffix. For example, adding a test for `packages/recall/src/MyModule.ts` creates `packages/recall/src/MyModule.test.ts`.

2. **Start with the standard imports:**

   ```typescript
   import { it } from "vitest"
   import { assert } from "@effect/vitest"
   import { Effect } from "effect"
   ```

3. **For pure logic tests**, write `it` blocks that call the function directly and assert on the return value. If the function is synchronous, no `await` or `Effect.runPromise` is needed.

4. **For Effect-based tests**, wrap the code in `Effect.runPromise` and `await` the result. Use `Effect.gen(function* () {})` for multi-step effects. Provide required layers via `.pipe(Effect.provide(...))`.

5. **For tests that need file I/O**, use `fs.mkdtempSync(path.join(os.tmpdir(), "aura-<domain>-"))` to create a temp directory, and provide the platform layers (`NodeFileReadLive`, `NodeFileWriteLive`, etc.) from `@aura/platform-node`.

6. **For tests with dependencies on service interfaces**, create a fake or stub implementation as a plain object literal, then inject it with `Effect.provideService(Tag, fake)`. Do not use mocking libraries.

7. **For time-dependent logic**, inject `Clock.fixed(timestamp)` via `Effect.provideService(Clock, clock)` to make the test deterministic.

8. **Run the test** to verify:

   ```bash
   bun vitest run packages/<pkg>/src/<Module>.test.ts
   ```

### Anti-patterns to avoid

- Do not use `describe` blocks -- the project convention is flat `it` blocks.
- Do not import `expect` from vitest -- use `assert` from `@effect/vitest`.
- Do not install mocking libraries -- use hand-written fake/stub objects.
- Do not write tests that depend on real time passing -- use `Clock.fixed()`.
- Do not write tests that mutate shared global state between `it` blocks.
