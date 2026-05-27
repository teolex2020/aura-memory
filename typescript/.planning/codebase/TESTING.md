# TESTING.md — Test Strategy & Organization

## Framework

- **Vitest** 2.0+ with `globals: true` and `environment: "node"`
- **@effect/vitest** for Effect-aware assertions (`assert` imported from `@effect/vitest`)
- Executed via: `bun run --cwd typescript test` or `bun run test` from root

## Test File Organization

Tests are **co-located** with source files:

```
packages/<pkg>/src/
├── Feature.ts
└── Feature.test.ts
```

### Test File Inventory (33 total)

| Package | Test Files | Focus Areas |
|---------|------------|-------------|
| `@aura/core` | 4 | Aura facade, Recall parity, DefaultLayer |
| `@aura/storage` | 13 | BrainAura, CognitiveRecord, Store files, Snapshots |
| `@aura/indexing` | 4 | InvertedIndex (search, roundtrip, fixtures), Roaring |
| `@aura/recall` | 3 | Pipeline, SDRInterpreter, Trust |
| `@aura/codec` | 3 | Binary, Bincode, Crypto |
| `@aura/contract` | 3 | Enums, Optionals, Recall types |
| `@aura/belief` | 2 | BeliefEngine (EN + ZH tests) |
| `@aura/concept` | 1 | ConceptEngine |

## Test Categories

### 1. Unit Tests
- Algorithmic modules: `Trust.test.ts`, `InvertedIndex.searchScored.test.ts`
- Pure functions with deterministic inputs/outputs
- Effect tests run via `Effect.runPromise` with explicit service provision

### 2. Roundtrip / Format Tests
- `InvertedIndex.roundtrip.test.ts` — serialize → deserialize identity
- `BrainAuraFile.test.ts` — binary format correctness
- Goal: ensure disk format stability for Rust interop

### 3. Rust Parity Tests
- **Primary**: `packages/core/src/Recall.parity.test.ts`
- **Fixture generation**: Rust binary `aura-ts-recall-fixtures` generates temp directory
- **Verification**: Rust binary `aura-ts-verify-recall` produces expected IDs
- **Assertion**: TS `Aura.recallScored` output must match Rust output exactly

Parity test pattern:
```typescript
const gen = spawnSync("cargo", ["run", "--bin", "aura-ts-recall-fixtures", "--", dir], ...)
const rust = spawnSync("cargo", ["run", "--bin", "aura-ts-verify-recall", "--", dir, query], ...)
const rustIds: string[] = JSON.parse(rust.stdout.trim())
const tsIds = scored.map(([, id]) => id)
assert.deepStrictEqual(tsIds, rustIds)
```

### 4. Optional Service Path Tests
- Pipeline tests verify behavior when `EmbeddingStore`, `BoundedReranker`, `RecallFinalizer` are absent vs. present
- Ensures graceful degradation matches design intent

### 5. Effect Layer Integration Tests
- `DefaultLayer.test.ts` — verifies all store/engine layers assemble correctly
- `Aura.test.ts` — facade-level integration

## Test Utilities

- **Clock.fixed(1_700_000_000)** — deterministic timestamps in recall parity tests
- **NodeFileReadLive** — provide file system in tests
- **Temp directories** via `fs.mkdtempSync(path.join(os.tmpdir(), "..."))`

## Coverage Gaps (Known)

| Area | Status |
|------|--------|
| `@aura/causal` | No tests |
| `@aura/policy` | No tests |
| `@aura/epistemic-runtime` | No tests |
| `@aura/platform-node` | No tests (thin IO wrappers) |
| `@aura/utils` | No tests (pure utilities) |
| Embedding/rerank branches | Only tested via optional-service skip paths |
| Write path (store, finalize) | Minimal coverage; read-model prioritized |

## Type Checking
- `bun run --cwd typescript typecheck` runs `tsc --noEmit`
- All code changes must pass typecheck before considered valid
