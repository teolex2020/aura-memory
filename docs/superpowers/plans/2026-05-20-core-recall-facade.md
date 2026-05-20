# @aura/core Recall Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@aura/core` 接入 `@aura/recall`，新增 `Recall.ts`/`Recall.test.ts`，对外暴露 `recallScored` + `recallRecords` 两层 API，并通过 `storage/RecallViewLive + recallPipeline` 实现，全程使用 Effect Context/Layer。

**Architecture:** `@aura/core` 提供纯门面函数：内部把脑目录 `dir` 转换为 `RecallViewTag` Layer（`RecallViewLive(dir)`），再运行 `recallPipeline`。`recallRecords` 在同一上下文里额外读取 `RecallViewTag.records` 将 `recordId` 映射为记录对象。

**Tech Stack:** TypeScript + Effect（Context/Layer）+ Vitest + @effect/vitest

---

### Task 1: 新增 core/Recall.ts

**Files:**
- Create: `/workspace/typescript/packages/core/src/Recall.ts`

- [ ] **Step 1: 写出核心类型与函数签名**

```ts
import { Effect } from "effect"
import { RecallViewTag, type RecallScored } from "@aura/contract"
import { RecallViewLive } from "@aura/storage"
import { recallPipeline, type RecallPipelineOptions } from "@aura/recall"

export type RecallHit<TRecord = unknown> = readonly [score: number, record: TRecord]

export function recallScored(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>
): Effect.Effect<RecallScored, unknown, import("@aura/contract").FileRead | import("@aura/contract").Clock>

export function recallRecords<TRecord = unknown>(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>
): Effect.Effect<ReadonlyArray<RecallHit<TRecord>>, unknown, import("@aura/contract").FileRead | import("@aura/contract").Clock>
```

- [ ] **Step 2: 实现 recallScored（RecallViewLive + recallPipeline）**

```ts
export function recallScored(dir: string, query: string, options?: Partial<RecallPipelineOptions>) {
  return recallPipeline(query, options).pipe(Effect.provide(RecallViewLive(dir)))
}
```

- [ ] **Step 3: 实现 recallRecords（在同一 Layer 中读取 RecallViewTag）**

```ts
export function recallRecords<TRecord = unknown>(dir: string, query: string, options?: Partial<RecallPipelineOptions>) {
  const program = Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    const scored = yield* recallPipeline(query, options)
    const out: Array<readonly [number, TRecord]> = []
    for (const [score, id] of scored) {
      const rec = view.records.get(id)
      if (rec !== undefined) out.push([score, rec as TRecord])
    }
    return out
  })

  return program.pipe(Effect.provide(RecallViewLive(dir)))
}
```

- [ ] **Step 4: 补充 SIMPLE/FULL 注释（保持与现有代码风格一致）**

### Task 2: 为 Aura 增加 recall* 门面 + 更新 core/index.ts 导出

**Files:**
- Modify: `/workspace/typescript/packages/core/src/Aura.ts`
- Modify: `/workspace/typescript/packages/core/src/index.ts`

- [ ] **Step 1: Aura.ts 增加静态方法，委托到 Recall.ts**

```ts
static recallScored(dir: string, query: string, options?: Partial<RecallPipelineOptions>) {
  return recallScored(dir, query, options)
}

static recallRecords<TRecord = unknown>(dir: string, query: string, options?: Partial<RecallPipelineOptions>) {
  return recallRecords<TRecord>(dir, query, options)
}
```

- [ ] **Step 2: index.ts export Recall 门面**

```ts
export * from "./Recall"
```

### Task 3: 新增 core/Recall.test.ts

**Files:**
- Create: `/workspace/typescript/packages/core/src/Recall.test.ts`

- [ ] **Step 1: 复用 storage 的 fixture 搭建 brain 目录**

```ts
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-core-recall-"))
fs.mkdirSync(path.join(dir, "index"), { recursive: true })
fs.copyFileSync(path.join(process.cwd(), "test/fixtures/minimal_brain/brain.aura"), path.join(dir, "brain.aura"))
fs.copyFileSync(path.join(process.cwd(), "test/fixtures/minimal_index/index_manifest.json"), path.join(dir, "index/index_manifest.json"))
fs.copyFileSync(path.join(process.cwd(), "test/fixtures/minimal_index/sdr.idx"), path.join(dir, "index/sdr.idx"))
```

- [ ] **Step 2: 用 CognitiveStoreFile 生成 brain.cog + brain.snap**

```ts
const writeProgram = Effect.gen(function* () {
  const store = yield* CognitiveStoreFile.open(dir)
  yield* store.appendStore({ id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" })
  yield* store.appendStore({ id: "cog_2", content: "hello index", tags: ["index"], aura_id: "doc_a" })
  yield* store.flush()
  yield* store.writeSnapshot([
    { id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" },
    { id: "cog_2", content: "hello index", tags: ["index"], aura_id: "doc_a" }
  ])
}).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
```

- [ ] **Step 3: 测试 recallScored 至少能命中 tag/ngram 结果**

```ts
const scored = await Effect.runPromise(
  recallScored(dir, "ts", { topK: 10, expandConnections: false }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provideService(Clock, { nowSeconds: () => Effect.succeed(1_700_000_000) })
  )
)
assert.isTrue(scored.some(([, id]) => id === "cog_1"))
```

- [ ] **Step 4: 测试 recallRecords 返回 record 对象并保留 score**

```ts
const hits = await Effect.runPromise(
  recallRecords<any>(dir, "ts", { topK: 10, expandConnections: false }).pipe(
    Effect.provide(NodeFileReadLive),
    Effect.provideService(Clock, { nowSeconds: () => Effect.succeed(1_700_000_000) })
  )
)
assert.isTrue(hits.some(([, rec]) => rec.id === "cog_1"))
```

### Task 4: 验证

- [ ] **Step 1: Typecheck**

Run:

```bash
cd /workspace/typescript && bun run typecheck
```

Expected: exit code 0

- [ ] **Step 2: Tests**

Run:

```bash
cd /workspace/typescript && bun run test
```

Expected: exit code 0

