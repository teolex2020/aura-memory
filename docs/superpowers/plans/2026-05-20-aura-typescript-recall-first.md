# Recall-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Rust recall pipeline in TypeScript (Bun) using effect-smol layering, with optional embedding/reranking/finalize services, and deterministic tests.

**Architecture:** Add a new `@aura/recall` package containing pure recall algorithms. Add `RecallView` as a storage-built runtime read model and optional services for embedding/reranking/finalize. `@aura/core` orchestrates.

**Tech Stack:** TypeScript + Bun, `effect`, `@effect/vitest`, `vitest`, `roaring-wasm`, plus an `xxhash3` implementation for SDR (`xxh3_64`).

---

## File/Module Map (Locked)

### New Packages / Files

- Create: `/workspace/typescript/packages/recall/package.json`
- Create: `/workspace/typescript/packages/recall/src/index.ts`
- Create: `/workspace/typescript/packages/recall/src/Comments.ts`
- Create: `/workspace/typescript/packages/recall/src/Types.ts`
- Create: `/workspace/typescript/packages/recall/src/SDRInterpreter.ts`
- Create: `/workspace/typescript/packages/recall/src/RRF.ts`
- Create: `/workspace/typescript/packages/recall/src/Signals.ts`
- Create: `/workspace/typescript/packages/recall/src/GraphWalk.ts`
- Create: `/workspace/typescript/packages/recall/src/CausalWalk.ts`
- Create: `/workspace/typescript/packages/recall/src/Trust.ts`
- Create: `/workspace/typescript/packages/recall/src/Pipeline.ts`

### New Storage Read-Models

- Create: `/workspace/typescript/packages/storage/src/CognitiveRecord.ts`
- Create: `/workspace/typescript/packages/storage/src/RecallView.ts`

### Contract Extensions

- Modify: `/workspace/typescript/packages/contract/src/index.ts`
- Create: `/workspace/typescript/packages/contract/src/Optional.ts`
- Create: `/workspace/typescript/packages/contract/src/Recall.ts`

### Core Orchestration

- Modify: `/workspace/typescript/packages/core/src/Aura.ts`
- Create: `/workspace/typescript/packages/core/src/Recall.ts`

### Workspace Config

- Modify: `/workspace/typescript/tsconfig.json` (paths)
- Modify: `/workspace/typescript/vitest.config.ts` (alias)
- Modify: `/workspace/typescript/package.json` (workspace deps)

---

## Task 1: Add `@aura/recall` Package + Workspace Wiring

**Files:**
- Create: `/workspace/typescript/packages/recall/package.json`
- Create: `/workspace/typescript/packages/recall/src/index.ts`
- Modify: `/workspace/typescript/tsconfig.json`
- Modify: `/workspace/typescript/vitest.config.ts`

- [ ] **Step 1: Add package skeleton**

Create `/workspace/typescript/packages/recall/package.json`:

```json
{
  "name": "@aura/recall",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: Wire TS path aliases**

In `/workspace/typescript/tsconfig.json` add:

```json
{
  "compilerOptions": {
    "paths": {
      "@aura/recall": ["packages/recall/src/index.ts"],
      "@aura/recall/*": ["packages/recall/src/*"]
    }
  }
}
```

- [ ] **Step 3: Wire Vitest alias**

In `/workspace/typescript/vitest.config.ts` add:

```ts
resolve: {
  alias: {
    "@aura/recall": path.resolve(__dirname, "packages/recall/src/index.ts")
  }
}
```

- [ ] **Step 4: Add barrel export**

Create `/workspace/typescript/packages/recall/src/index.ts`:

```ts
export * from "./Pipeline"
export * from "./Types"
export * from "./Trust"
export * from "./SDRInterpreter"
```

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`  
Expected: PASS

---

## Task 2: Add Recall Contracts + Optional Service Helper (effect-smol)

**Files:**
- Create: `/workspace/typescript/packages/contract/src/Optional.ts`
- Create: `/workspace/typescript/packages/contract/src/Recall.ts`
- Modify: `/workspace/typescript/packages/contract/src/index.ts`
- Test: `/workspace/typescript/packages/contract/src/Optional.test.ts`

- [ ] **Step 1: Implement Optional service helper**

Create `/workspace/typescript/packages/contract/src/Optional.ts`:

```ts
import { Context, Effect, Option } from "effect"

export function serviceOption<Tag extends Context.Tag<any, any>>(
  tag: Tag
): Effect.Effect<Option.Option<Context.Tag.Service<Tag>>, never, Context.Tag.Identifier<Tag>> {
  return Effect.contextWith((ctx) => Context.getOption(ctx, tag))
}
```

- [ ] **Step 2: Define recall-related service tags**

Create `/workspace/typescript/packages/contract/src/Recall.ts`:

```ts
import { Effect } from "effect"
import { Tag } from "./Context"

export type RecallScored = ReadonlyArray<readonly [score: number, recordId: string]>

export type RecallView = {
  records: ReadonlyMap<string, any>
  auraIndex: ReadonlyMap<string, string>
  auraHeaders: ReadonlyMap<string, { sdr_indices: ReadonlyArray<number> }>
  invertedIndex: { search: (bits: ReadonlyArray<number>, topK: number, minOverlap: number) => Array<[string, number]> }
  ngramIndex: { query: (text: string, topK: number) => Array<[number, string]> }
  tagIndex: ReadonlyMap<string, ReadonlySet<string>>
}

export class RecallViewTag extends Tag("aura.contract.RecallView")<
  RecallViewTag,
  RecallView
>() {}

export class EmbeddingStore extends Tag("aura.contract.EmbeddingStore")<
  EmbeddingStore,
  {
    query: (text: string, topK: number) => Effect.Effect<Array<[string, number]>>
  }
>() {}

export class BoundedReranker extends Tag("aura.contract.BoundedReranker")<
  BoundedReranker,
  {
    rerank: (scored: RecallScored, query: string) => Effect.Effect<RecallScored>
  }
>() {}

export class RecallFinalizer extends Tag("aura.contract.RecallFinalizer")<
  RecallFinalizer,
  {
    finalize: (scored: RecallScored, sessionId?: string) => Effect.Effect<void>
  }
>() {}

export type TrustConfig = {
  source_trust: Record<string, number>
  source_authority: Record<string, number>
  recency_boost_max: number
  recency_half_life_days: number
}

export class TrustConfigTag extends Tag("aura.contract.TrustConfig")<
  TrustConfigTag,
  TrustConfig
>() {}
```

- [ ] **Step 3: Export from contract barrel**

Modify `/workspace/typescript/packages/contract/src/index.ts`:

```ts
export * from "./Optional"
export * from "./Recall"
```

- [ ] **Step 4: Add unit test for serviceOption**

Create `/workspace/typescript/packages/contract/src/Optional.test.ts`:

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Context, Effect, Option } from "effect"
import { serviceOption } from "@aura/contract"
import { Tag } from "./Context"

class Foo extends Tag("test.Foo")<Foo, { v: number }>() {}

it("serviceOption returns None when missing, Some when present", async () => {
  const none = await Effect.runPromise(serviceOption(Foo))
  assert.isTrue(Option.isNone(none))

  const ctx = Context.empty().pipe(Context.add(Foo, { v: 1 }))
  const some = await Effect.runPromise(serviceOption(Foo).pipe(Effect.provideContext(ctx)))
  assert.isTrue(Option.isSome(some))
})
```

- [ ] **Step 5: Run tests**

Run: `bun run test`  
Expected: PASS

---

## Task 3: Add Cognitive Record Type + RecallView Builder (Read-Path)

**Files:**
- Create: `/workspace/typescript/packages/storage/src/CognitiveRecord.ts`
- Create: `/workspace/typescript/packages/storage/src/RecallView.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/RecallView.test.ts`

- [ ] **Step 1: Define `CognitiveRecord` matching Rust fields**

Create `/workspace/typescript/packages/storage/src/CognitiveRecord.ts`:

```ts
export type CognitiveLevel = "Working" | "Decisions" | "Domain" | "Identity"

export type CognitiveRecord = {
  id: string
  content: string
  level: CognitiveLevel
  strength: number
  activation_count: number
  created_at: number
  last_activated: number
  tags: string[]
  connections: Record<string, number>
  connection_types?: Record<string, string>
  content_type: string
  metadata: Record<string, string>
  aura_id?: string | null
  caused_by_id?: string | null
  namespace?: string
  source_type?: string
  semantic_type?: string
}
```

- [ ] **Step 2: Build RecallView from disk**

Create `/workspace/typescript/packages/storage/src/RecallView.ts`:

```ts
import { Effect, Layer } from "effect"
import { FileRead } from "@aura/contract"
import { InvertedIndex } from "@aura/indexing"
import { readBrainAuraFile } from "./BrainAura"
import { CognitiveStoreFile } from "./CognitiveStoreFile"
import { RecallViewTag, type RecallView } from "@aura/contract"
import type { CognitiveRecord } from "./CognitiveRecord"

function buildTagIndex(records: ReadonlyMap<string, CognitiveRecord>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [id, r] of records.entries()) {
    for (const t of r.tags ?? []) {
      const key = t.toLowerCase()
      const set = out.get(key) ?? new Set<string>()
      set.add(id)
      out.set(key, set)
    }
  }
  return out
}

export function RecallViewLive(rootDir: string): Layer.Layer<RecallViewTag, unknown, FileRead> {
  return Layer.effect(
    RecallViewTag,
    Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)

      // SIMPLE IMPLEMENTATION: use CognitiveStoreFile.loadAll() (JSON) and treat as CognitiveRecord
      // FULL IMPLEMENTATION: implement full Record schema validation/defaults and exact Rust behaviors.
      const cog = yield* CognitiveStoreFile.open(rootDir).pipe(
        Effect.provideService(FileRead, fr as any)
      )
      const loaded = yield* cog.loadAll().pipe(Effect.provideService(FileRead, fr as any))
      const records = new Map<string, CognitiveRecord>()
      for (const [id, rec] of loaded.entries()) {
        records.set(id, rec as CognitiveRecord)
      }

      const auraIndex = new Map<string, string>()
      for (const [id, rec] of records.entries()) {
        const auraId = rec.aura_id ?? null
        if (typeof auraId === "string" && auraId.length > 0) {
          auraIndex.set(auraId, id)
        }
      }

      const brainAura = yield* fr.readFile(`${rootDir}/brain.aura`)
      const parsed = readBrainAuraFile(brainAura)
      const auraHeaders = new Map<string, { sdr_indices: number[] }>()
      for (const r of parsed.records) {
        auraHeaders.set(r.id, { sdr_indices: r.sdr_indices })
      }

      const invertedIndex = yield* InvertedIndex.load(`${rootDir}/index`).pipe(Effect.provideService(FileRead, fr as any))

      // SIMPLE IMPLEMENTATION: a trivial ngram index built at query time (implemented in @aura/recall)
      // FULL IMPLEMENTATION: port Rust NGramIndex (minhash/LSH) for speed and stability.
      const ngramIndex = {
        query: (_text: string, _topK: number) => [] as Array<[number, string]>
      }

      const tagIndex = buildTagIndex(records)

      const view: RecallView = {
        records,
        auraIndex,
        auraHeaders,
        invertedIndex,
        ngramIndex,
        tagIndex
      }
      return view
    })
  )
}
```

- [ ] **Step 3: Export from storage barrel**

Modify `/workspace/typescript/packages/storage/src/index.ts`:

```ts
export * from "./CognitiveRecord"
export * from "./RecallView"
```

- [ ] **Step 4: Add a minimal RecallView read test**

Create `/workspace/typescript/packages/storage/src/RecallView.test.ts`:

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive } from "@aura/platform-node"
import { RecallViewLive } from "@aura/storage"
import { RecallViewTag } from "@aura/contract"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

it("RecallViewLive builds from fixture", async () => {
  const fixture = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recall-view-"))
  fs.copyFileSync(path.join(fixture, "brain.aura"), path.join(root, "brain.aura"))
  fs.copyFileSync(path.join(fixture, "temporal.bin"), path.join(root, "temporal.bin"))

  const program = Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    assert.isTrue(view.auraHeaders.size >= 1)
  }).pipe(Effect.provide(RecallViewLive(root)), Effect.provide(NodeFileReadLive))

  await Effect.runPromise(program)
})
```

- [ ] **Step 5: Run tests**

Run: `bun run test`  
Expected: PASS

---

## Task 4: Implement SDRInterpreter (xxh3_64 compatible)

**Files:**
- Modify: `/workspace/typescript/package.json`
- Create: `/workspace/typescript/packages/recall/src/SDRInterpreter.ts`
- Test: `/workspace/typescript/packages/recall/src/SDRInterpreter.test.ts`

- [ ] **Step 1: Add xxhash dependency**

Add dependency to `/workspace/typescript/package.json`:

```json
{
  "dependencies": {
    "xxhash-wasm": "^1.1.0"
  }
}
```

- [ ] **Step 2: Write failing test for deterministic SDR bits**

Create `/workspace/typescript/packages/recall/src/SDRInterpreter.test.ts`:

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { SDRInterpreter } from "@aura/recall"

it("SDRInterpreter.textToSdr is deterministic and sorted", async () => {
  const sdr = await SDRInterpreter.default()
  const a = sdr.textToSdr("Hello 123", false)
  const b = sdr.textToSdr("Hello 123", false)
  assert.deepStrictEqual(a, b)
  assert.isTrue(a.every((v, i) => i === 0 || a[i - 1]! <= v))
})
```

- [ ] **Step 3: Implement SDRInterpreter aligned to Rust**

Create `/workspace/typescript/packages/recall/src/SDRInterpreter.ts` implementing:

- `default()` resolves wasm hasher and returns interpreter instance
- `textToSdr(text, isIdentity)`
- `tanimotoSparse(a, b)` for sorted u16 arrays

Also include in-file markers:

- `SIMPLE IMPLEMENTATION:` only supports ASCII path first, then implement UTF-8 fallback
- `FULL IMPLEMENTATION:` match Rust `sdr.rs` byte-for-byte with the same hashing/seed tweaks and ranges

- [ ] **Step 4: Run tests**

Run: `bun run test packages/recall/src/SDRInterpreter.test.ts`  
Expected: PASS

---

## Task 5: Implement Recall Pipeline (Signals → RRF → Walks → Scoring)

**Files:**
- Create: `/workspace/typescript/packages/recall/src/Types.ts`
- Create: `/workspace/typescript/packages/recall/src/Trust.ts`
- Create: `/workspace/typescript/packages/recall/src/RRF.ts`
- Create: `/workspace/typescript/packages/recall/src/Signals.ts`
- Create: `/workspace/typescript/packages/recall/src/GraphWalk.ts`
- Create: `/workspace/typescript/packages/recall/src/CausalWalk.ts`
- Create: `/workspace/typescript/packages/recall/src/Pipeline.ts`
- Test: `/workspace/typescript/packages/recall/src/Pipeline.test.ts`

- [ ] **Step 1: Define pipeline types**

Create `/workspace/typescript/packages/recall/src/Types.ts`:

```ts
export type RankedList = Array<[recordId: string, rawScore: number]>
export type Scored = Array<[score: number, recordId: string]>
```

- [ ] **Step 2: Implement trust scoring aligned to Rust**

Create `/workspace/typescript/packages/recall/src/Trust.ts`:

```ts
import type { TrustConfig } from "@aura/contract"

export function defaultTrustConfig(): TrustConfig {
  return {
    source_trust: {
      "user-confirmed": 1.0,
      "agent-interactive": 0.7,
      system: 0.6,
      agent: 0.5,
      "agent-autonomous": 0.4,
      "agent-worker": 0.35
    },
    source_authority: {
      "user-telegram": 1.2,
      "user-desktop": 1.2,
      "user-voice": 1.2,
      "user-confirmed": 1.2,
      "agent-interactive": 1.0,
      system: 0.9,
      agent: 0.85,
      "agent-autonomous": 0.75,
      "agent-worker": 0.7,
      "agent-inference": 0.65
    },
    recency_boost_max: 0.2,
    recency_half_life_days: 7.0
  }
}

export function computeEffectiveTrust(
  metadata: Record<string, string>,
  nowUnixSec: number,
  config: TrustConfig,
  sourceType: string
): number {
  const trust = Number.parseFloat(metadata["trust_score"] ?? "0.5") || 0.5
  const source = metadata["source"] ?? ""
  const authority = config.source_authority[source] ?? 0.85

  const tsStr = metadata["timestamp"] ?? metadata["created_at"] ?? ""
  const parsed = Date.parse(tsStr)
  const ts = Number.isFinite(parsed) ? parsed / 1000 : nowUnixSec - 86400 * 14
  const ageDays = Math.max(0, (nowUnixSec - ts) / 86400)
  const recencyBoost = Math.max(0, config.recency_boost_max * (1 - ageDays / config.recency_half_life_days))

  const sourceTypeFactor =
    sourceType === "recorded" ? 1.0 :
    sourceType === "retrieved" ? 0.9 :
    sourceType === "inferred" ? 0.85 :
    sourceType === "generated" ? 0.8 :
    0.9

  const effective = (trust + recencyBoost) * authority * sourceTypeFactor
  return Math.min(1.0, Math.max(0.05, effective))
}
```

- [ ] **Step 3: Implement RRF**

Create `/workspace/typescript/packages/recall/src/RRF.ts`:

```ts
import type { RankedList, Scored } from "./Types"

export const RRF_K = 60

export function rrfFuse(ranked: ReadonlyArray<RankedList>): Scored {
  const scores = new Map<string, number>()
  for (const list of ranked) {
    for (let i = 0; i < list.length; i++) {
      const rid = list[i]![0]
      const share = 1 / (RRF_K + i + 1)
      scores.set(rid, (scores.get(rid) ?? 0) + share)
    }
  }
  const maxPossible = ranked.length / (RRF_K + 1)
  const out: Scored = []
  for (const [rid, score] of scores.entries()) {
    out.push([maxPossible > 0 ? score / maxPossible : score, rid])
  }
  out.sort((a, b) => b[0] - a[0])
  return out
}
```

- [ ] **Step 4: Implement signal collection against RecallView**

Create `/workspace/typescript/packages/recall/src/Signals.ts` with functions:

- `collectSdr(view, sdr, query, topK, namespaces)`
- `collectTags(view, query, topK, namespaces)`
- `collectNgram(view, query, topK, namespaces)` (simple fallback if ngramIndex.query returns empty)
- `collectEmbedding(view, query, topK)` (optional)

Each file must contain `SIMPLE IMPLEMENTATION:` and `FULL IMPLEMENTATION:` markers.

- [ ] **Step 5: Implement GraphWalk + CausalWalk aligned to Rust**

Create:

- `/workspace/typescript/packages/recall/src/GraphWalk.ts`
- `/workspace/typescript/packages/recall/src/CausalWalk.ts`

Implement same constants and expansion logic as `recall.rs`.

- [ ] **Step 6: Implement pipeline orchestration with optional services**

Create `/workspace/typescript/packages/recall/src/Pipeline.ts`:

- Reads `RecallViewTag` from Context.
- Uses `serviceOption(EmbeddingStore/BoundedReranker/RecallFinalizer/TrustConfigTag)`.
- Runs:
  - signals
  - rrf
  - graph/causal
  - recency scoring (default trust config if missing)
  - optional rerank
  - optional finalize

- [ ] **Step 7: Add pure pipeline tests (mock view)**

Create `/workspace/typescript/packages/recall/src/Pipeline.test.ts` with a mock `RecallView` context that asserts:

- RRF fusion produces expected ordering
- Graph walk adds connected nodes
- Causal walk adds parents
- Missing optional services does not throw and simply skips

- [ ] **Step 8: Run tests**

Run: `bun run test packages/recall/src/Pipeline.test.ts`  
Expected: PASS

---

## Task 6: Core API — `Aura.recall*` Using Layers

**Files:**
- Modify: `/workspace/typescript/packages/core/src/Aura.ts`
- Create: `/workspace/typescript/packages/core/src/Recall.ts`
- Test: `/workspace/typescript/packages/core/src/Recall.test.ts`

- [ ] **Step 1: Add core recall façade**

Create `/workspace/typescript/packages/core/src/Recall.ts` that exports:

- `Aura.recallRaw(query, opts)` returning list of record IDs + scores
- `Aura.recallStructured(query, opts)` (format can be minimal now)

Both should:

- require `RecallView` layer to be provided by caller or `Aura.openWithRecall()` helper that installs `RecallViewLive(brainPath)` for convenience
- avoid direct IO in core (IO happens in storage view builder)

- [ ] **Step 2: Add integration test using fixtures**

Create `/workspace/typescript/packages/core/src/Recall.test.ts`:

- Build a temporary directory with fixtures
- Provide `NodeFileReadLive` + `RecallViewLive(root)`
- Run recall pipeline for a query that deterministically returns at least one record

- [ ] **Step 3: Run tests**

Run: `bun run test packages/core/src/Recall.test.ts`  
Expected: PASS

---

## Task 7: Add Rust Fixture + TS Recall Parity Test (Read-Path)

**Files:**
- Create: `/workspace/src/bin/aura-ts-recall-fixtures.rs`
- Create: `/workspace/src/bin/aura-ts-verify-recall.rs`
- Create: `/workspace/typescript/packages/core/src/Recall.parity.test.ts`

- [ ] **Step 1: Add Rust fixture generator**

Create a Rust bin that writes:

- minimal cognitive records set (brain.cog + brain.snap)
- minimal brain.aura + index/ consistent with those records

Reuse existing bins style (`aura-ts-fixtures`, `aura-ts-index-fixtures`).

- [ ] **Step 2: Add Rust verifier**

Create a Rust bin that:

- loads the fixture dir using Rust `Aura::open(...)`
- runs `recall_raw` / `recall` for a fixed query
- prints deterministic JSON with ranked record IDs

- [ ] **Step 3: Add TS parity test**

In TS test:

- run Rust verifier via `spawnSync("cargo", ["run", ...])`
- run TS recall on same fixture dir/query
- assert IDs match (ignore scores initially; add score tolerance later if needed)

- [ ] **Step 4: Run full suite**

Run: `bun run typecheck && bun run test`  
Expected: PASS

---

## Plan Self-Review

- Spec coverage:
  - Optional services via Context: Task 2 + Task 5
  - RecallView builder: Task 3
  - SDRInterpreter aligned to Rust: Task 4
  - Pipeline parity path: Task 7
- Placeholder scan: no “TBD”; incremental gaps are documented via `SIMPLE IMPLEMENTATION` vs `FULL IMPLEMENTATION` markers in code, not as vague steps.
- Type consistency: `RecallViewTag` and optional service tags are defined once in contract and consumed elsewhere.

---

Plan complete and saved to `/workspace/docs/superpowers/plans/2026-05-20-aura-typescript-recall-first.md`. Two execution options:

1. Subagent-Driven (recommended) — dispatch a fresh subagent per task, review between tasks
2. Inline Execution — execute tasks in this session with checkpoints

Which approach?

