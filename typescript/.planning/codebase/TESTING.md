# 测试模式

**分析日期:** 2026-06-01

## 测试框架

**运行器:**
- Vitest 2.x（配置于 `vitest.config.ts`）
- 全局 API 通过 `globals: true` 启用（`describe`、`it`、`expect` 无需导入即可使用，但代码中仍然显式导入）

**断言库:**
- 双断言模式共存：
  - `@effect/vitest` 的 `assert` — 主要断言工具（`packages/belief`, `packages/codec`, `packages/cognitive`, `packages/contract` 等大量使用）
  - `vitest` 的 `expect` — 用于 `describe` + `expect` 风格的测试（`packages/belief/BeliefEngine.test.ts`, `packages/mcp/`, `packages/core/Aura.test.ts` 等使用）

**运行命令:**
```bash
pnpm test                        # 运行所有测试 (vitest run --passWithNoTests)
pnpm test:watch                  # Watch 模式 (vitest --passWithNoTests)
pnpm typecheck                   # 类型检查 (tsc -p tsconfig.json --noEmit)
```

**全局配置:**
- 环境: `node`
- 设置文件: `vitest.setup.ts`（提供 Node 环境下的 Web API polyfill: fetch, crypto, Blob, ReadableStream 等）
- 路径别名: `@aura/*` -> `packages/<name>/src/index.ts`
- 无需配置 `coverage`（未启用覆盖率收集）

## 测试文件组织

**位置:**
- 测试文件与源文件同目录 (`co-located`)，位于 `packages/<pkg>/src/` 目录下
- 无独立的 `__tests__` 或 `test/` 目录（但项目根目录有 `test/fixtures/` 存放测试 fixture 数据）

**命名:**
- `*.test.ts` — 标准测试文件
- `*.zh.test.ts` — 中文场景测试（如 `BeliefEngine.zh.test.ts`，用于测试中/英文双语用例）
- 无 `.spec.ts` 后缀

**结构:**
```
packages/<pkg>/src/
├── Module.ts               # 源文件
├── Module.test.ts          # 测试文件
├── index.ts                # Barrel export
```

## 测试结构

**套件组织 — `describe` + `it` + `expect` 风格:**
```typescript
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { surfaceConcepts } from "./Surface"

describe("surfaceConcepts", () => {
  it("returns all eligible concepts sorted by abstractionScore desc", async () => {
    const engine = mockEngine(makeState({ ... }))
    const surfaced = await surfaceConcepts(engine)
    expect(surfaced.length).toBeGreaterThan(0)
  })
})
```

**套件组织 — `it` + `assert` 风格（更简洁，不带 describe 分组）:**
```typescript
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryReader, BinaryWriter } from "./index"

it("BinaryReader/BinaryWriter roundtrip", () => {
  const w = new BinaryWriter()
  w.u8(1)
  w.u16le(0x2233)
  // ...
  const r = new BinaryReader(buf)
  assert.strictEqual(r.u8(), 1)
  assert.deepStrictEqual(Array.from(r.bytes(3)), [9, 8, 7])
})
```

**模式:**
- **Setup**: 测试函数内局部变量初始化，使用工厂函数创建 mock 数据（如 `makeRecord()`, `makeState()`, `makeView()`）
- **Teardown**: 无需显式清理（临时目录使用 `os.tmpdir()` + `fs.mkdtempSync()` 创建，测试结束后由操作系统清理）
- **Assertion**: `assert.strictEqual()` 用于精确比较，`assert.deepStrictEqual()` 用于深度比较，`assert.isTrue()` 用于布尔断言，`assert.ok()` 用于真值检查

## 两种断言风格使用模式

| 风格 | 导入来源 | 典型使用场景 | 示例文件 |
|--------|--------|------------------------|---------------|
| `describe` + `it` + `expect` | `vitest` | 多 suite 分组测试、复杂断言链 | `BeliefEngine.test.ts`, `Aura.test.ts`, `NGramIndex.test.ts` |
| `it` + `assert` | `vitest` + `@effect/vitest` | 简短的独立单测、effect 验证 | `Binary.test.ts`, `Cognitive.test.ts`, `Trust.test.ts` |

**选择原则:** 需要 `describe` 分组时使用 `expect` 风格；简单的无分组测试使用 `assert` 风格。

## Effect 测试模式

**异步 Effect 执行:**
```typescript
import { Effect } from "effect"
import { FileRead } from "@aura/contract"
import { NodeFileReadLive } from "@aura/platform-node"

it("loads fixture", async () => {
  const program = Effect.gen(function* () {
    const idx = yield* InvertedIndex.load(dir)
    assert.deepStrictEqual(idx.search([2, 3]).sort(), ["doc_a"].sort())
  }).pipe(Effect.provide(NodeFileReadLive))

  await Effect.runPromise(program)
})
```

**同步 Effect 执行:**
```typescript
function run<R>(effect: Effect.Effect<R>): R {
  return Effect.runSync(effect)
}
```

**依赖注入模式:**
```typescript
Effect.provide(NodeFileReadLive),
Effect.provide(NodeFileWriteLive),
Effect.provide(NodeClockLive),
Effect.provide(NodeCryptoLive),
Effect.provideService(Clock, Clock.fixed(nowUnixSec)),
```

## Mocking

**框架:** 无独立 mocking 框架；少量使用 `vitest` 的 `vi.spyOn`/`vi.fn`

**模式:**
```typescript
// 手动创建 mock 对象（最常见模式）
function mockEngine(state: ConceptEngineState): ConceptEngine.Interface {
  return {
    with_seed_mode: () => Effect.void,
    with_similarity_mode: () => Effect.void,
    discover: () => Effect.succeed({} as any),
    stable_concepts: () => Effect.succeed([] as readonly string[]),
    stats: () => Effect.succeed(state),
  }
}

// 内联 mock view 对象
const view: RecallView = {
  records,
  auraIndex: new Map(...),
  invertedIndex: { search: () => [...] },
  ngramIndex: { query: () => [] },
  tagIndex: new Map(),
}

// vi.spyOn 仅在 NGramIndex.test.ts 中使用过一次
const mathRandom = vi.spyOn(Math, "random").mockImplementation(() => { ... })
```

**Mock 原则:**
- **通常 mock 什么**: 外部依赖（FileRead, FileWrite, Clock, Crypto, 引擎服务的接口）
- **通常不 mock 什么**: 纯工具函数、数据结构类（如 `BinaryWriter`, `BinaryReader`）
- 依赖通过 `Effect.Interface` 类型实现 mock，保证类型安全

**重要:** 整个代码库未使用 `vi.mock()`（模块级 mock），全为内联 mock 对象。

## Fixtures 和工厂

**测试数据:**
```typescript
// 记录工厂（分散在各个测试文件中）
function makeRecord(id: string, content: string, tags: string[], semanticType: string): AuraRecord {
  return {
    id, content, level: Level.Working, strength: 1, ...
    tags, semantic_type: semanticType, ...
  }
}

// 状态工厂
function makeState(concepts: Record<string, ConceptCandidate>): ConceptEngineState {
  return {
    version: 1 as const,
    concepts, key_index: {}, ...
  }
}

// 最小参数工厂函数
function c(overrides: Partial<ConceptCandidate> & { id: string }): ConceptCandidate {
  return { key: `key-${overrides.id}`, namespace: "default", state: ConceptState.Stable, ...overrides }
}
```

**位置:**
- 工厂函数定义在单个测试文件内（非共享文件）
- 测试用二进制 fixture 数据存储在 `test/fixtures/` 目录（如 `minimal_brain/`, `minimal_index/`）

## 覆盖率

**要求:** 未强制执行覆盖率阈值，未配置 `vitest` 的 `coverage` 选项

**查看覆盖率:**
```bash
pnpm vitest run --coverage    # 需先安装 @vitest/coverage-v8
```

## 测试类型

**单元测试（主要类型）:**
- 覆盖范围：单个函数、类方法、模块
- 测试数据结构解析/编码、算法逻辑、状态转换
- 典型断言：输入 -> 输出等价性、边界条件、错误处理

**集成测试（次主要类型）:**
- 覆盖范围：跨包协作（如 Aura.open() 调用 storage + indexing + recall）
- 使用临时目录和 fixture 数据进行端到端流程测试
- 依赖 `@aura/platform-node` 中的 Live 实现（FileRead, FileWrite, Clock, Crypto）

**E2E 测试:**
- MCP 相关 E2E 测试（`packages/mcp/src/StdioSmoke.test.ts`）：启动子进程连接 MCP server 并验证工具列表
- Rust 一致性实验（`NGramIndex.test.ts`）：编译并运行 Rust 二进制，对比哈希和查询结果
- MCP Rust/TS 一致性测试（`Parity.test.ts`）：通过 `MCPClient` 并行连接 TS 和 Rust MCP server，对比工具执行结果

## 常见模式

**异步测试 — Effect:**
```typescript
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"

it("loads and parses correctly", async () => {
  const program = Effect.gen(function* () {
    const result = yield* someEffect()
    assert.strictEqual(result, expected)
  }).pipe(Effect.provide(NodeFileReadLive))

  await Effect.runPromise(program)
})
```

**错误测试:**
```typescript
// 验证 Effect 失败（抛出特定错误）
it("fails on invalid input", async () => {
  try {
    await Effect.runPromise(badEffect())
    assert.fail("expected error")
  } catch (e) {
    assert.ok(e instanceof FileFormatError)
  }
})

// 验证同步函数抛异常
it("throws on bad magic", () => {
  assert.throws(() => decodeCognitiveLog(badBytes), Error)
})
```

**具有 describe 分组的测试:**
```typescript
import { describe, expect, it } from "vitest"

describe("FeatureName", () => {
  // 共享测试辅助函数（文件作用域）

  it("behaves correctly when ...", () => {
    // setup
    // execute
    // assert
  })
})
```

**Rust 一致性测试:**
```typescript
// 启动外部 Rust 进程获取预期结果，接着验证 TypeScript 实现是否匹配
it("matches Rust verifier for xxh3_64", () => {
  const rust = rustVerifier()  // spawnSync("cargo", ["run", "--bin", "aura-ts-verify-ngram"])
  const hashes = new Map(rust.hashes)
  for (const [sample, expected] of hashes) {
    expect(xxh3NGramHash(te.encode(sample))).toBe(expected)
  }
})
```

**临时目录模式:**
```typescript
// 所有文件 I/O 测试使用的标准模式
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-prefix-"))
// 测试后不需要 fs.rmSync — 临时目录由 OS 清理
```

**全局 polyfill 设置 (`vitest.setup.ts`):**
- 提供 `crypto.webcrypto` / `crypto.getRandomValues`（Node 16 兼容）
- 提供 `fetch`、`Headers`、`Request`、`Response`（通过 `node-fetch`）
- 提供 `Blob`、`ReadableStream`、`TransformStream`、`WritableStream`（通过 `node:buffer` / `node:stream/web`）

## 测试统计

| 包 | 测试文件数 | 说明 |
|---------|-----------|-----------|
| belief | 2 | `BeliefEngine.test.ts`（~200 测试）+ `BeliefEngine.zh.test.ts`（中文场景） |
| codec | 3 | Binary, Bincode, Crypto roundtrip 测试 |
| concept | 2 | ConceptEngine + Surface |
| contract | 4 | Enums, McpDtos, Optional, Recall |
| core | 7 | Aura, DefaultLayer, Recall 系列, MaintenanceService |
| epistemic-runtime | 1 | 大型 EpistemicRuntime 测试文件 |
| indexing | 5 | InvertedIndex (3), NGramIndex, Roaring |
| mcp | 5 | Inventory, Invocation, MastraCompat, Parity, StdioSmoke |
| policy | 2 | PolicyEngine + Surface |
| recall | 7 | BoundedReranker, GraphWalk, Pipeline, RRF, SDRInterpreter, Signals, Trust |
| storage | 12 | BeliefStoreFile, BrainAura 系列, Cognitive 系列, CausalStoreFile 等 |

---

*测试分析日期: 2026-06-01*
