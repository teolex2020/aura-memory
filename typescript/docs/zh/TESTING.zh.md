<!-- generated-by: gsd-doc-writer -->

---

title: 测试

---

## 概览

Aura TypeScript monorepo 使用 **Vitest** 作为测试运行器，使用 **`@effect/vitest`** 进行与项目基于 Effect 的架构自然集成的断言。测试与源文件并列放置于 `packages/*/src/` 下，使用 `*.test.ts` 命名约定。

## 测试框架和设置

| 组件 | 工具 | 版本 |
|---|---|---|
| 测试运行器 | [Vitest](https://vitest.dev) | `^2.0.0` |
| 断言 | `@effect/vitest` | `4.0.0-beta.68` |
| Effect 运行时 | `effect` | `4.0.0-beta.68` |
| 环境 | `node`（来自 vitest 配置） | -- |

测试使用 `globals: true`（通过配置启用 vitest 全局变量），因此 `it`、`expect`、`describe` 等 vitest 函数无需显式导入即可使用。但项目约定是：在每个测试文件中显式从 `vitest` 导入 `it`，从 `@effect/vitest` 导入 `assert`。

除了根目录 `vitest.config.ts` 外，不需要额外的测试设置或配置文件。该配置将工作区包别名（`@aura/core`、`@aura/storage` 等）映射到它们的源入口点，使跨包导入在测试运行期间正确解析。

## 运行测试

### 完整套件

```bash
bun run test
```

这执行 `vitest run --passWithNoTests`，单次运行所有工作区包中的所有 `*.test.ts` 文件并退出。`--passWithNoTests` 标志防止在包没有测试文件时报错。

### 监听模式

```bash
bun run test:watch
```

这执行 `vitest --passWithNoTests` 的监听模式，文件变更时重新运行受影响的测试。

### 运行特定测试文件

```bash
bun vitest run packages/recall/src/Trust.test.ts
```

### 逐包测试隔离

```bash
bun vitest run packages/recall/src/
```

### 类型检查

```bash
bun run typecheck
```

运行 `tsc -p tsconfig.json --noEmit` 验证整个 monorepo 的类型正确性。类型检查与测试执行是分开的。

## 测试结构约定

### 文件位置

测试文件位于其所测试的源文件旁边：

```
packages/recall/src/Trust.ts
packages/recall/src/Trust.test.ts       <-- 并列测试
```

目前跨 8 个包共有 **32 个测试文件**。多个包共用的 fixture 数据位于 monorepo 根的 `test/fixtures/` 下。

### 文件命名

所有测试文件使用 `*.test.ts` 后缀。项目不使用 `*.spec.ts`。

### 测试组织

测试在文件顶层使用扁平的 `it` 块。项目**不**使用 `describe` 块进行测试分组。每个 `it` 块自包含，带有描述被验证行为的有意义名称。

### 导入约定

每个测试文件遵循一致的导入模式：

```typescript
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
```

额外导入取决于测试要验证的内容 —— 被测试源的导入和所需的任何 Effect Layer 实现。

## 断言

项目使用来自 `@effect/vitest` 的 `assert` 而非 vitest 内置的 `expect`。`@effect/vitest` 的 assert 对象提供类似 chai 的熟悉 API：

| 方法 | 用法 |
|---|---|
| `assert.strictEqual(actual, expected)` | 严格相等检查 |
| `assert.deepStrictEqual(actual, expected)` | 深度相等（对象、数组） |
| `assert.ok(condition)` | 真值检查 |
| `assert.isTrue(condition)` | 严格 `true` 检查 |
| `assert.isDefined(value)` | 非 `undefined` 检查 |
| `assert.isFalse(condition)` | 严格 `false` 检查 |

## 模式

### Effect.runPromise —— 在测试中执行 Effect

大多数测试调用 `Effect.runPromise()` 执行 Effect 程序并 `await` 其结果。这是运行纯逻辑和 I/O 绑定测试逻辑的主要模式。

纯单元测试（无依赖）：

```typescript
it("defaultTrustConfig 与 Rust 默认值一致", () => {
  const cfg = defaultTrustConfig()
  assert.strictEqual(cfg.recency_boost_max, 0.2)
})
```

对于有依赖的 Effect，`Effect.runPromise` 包裹整个程序：

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

### Effect.gen —— 基于生成器的 Effect 组合

项目使用 `Effect.gen(function* () {})`（生成器语法）组合多个 Effect 操作。在生成器内，`yield*` 展开 Effect 值：

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

### 使用 Effect.provide 注入 Layer

需要 I/O 或平台服务的测试使用 `Effect.provide`（和 `Effect.provideService`）在 `.pipe()` 链中提供所需的 Effect Layer 实现：

| 方法 | 用途 |
|---|---|
| `Effect.provide(layer)` | 提供已构建的 Layer（如 `NodeFileReadLive`） |
| `Effect.provideService(tag, impl)` | 为 Tag 提供单例实现 |

测试中使用的常见平台层：

| Layer | 来源包 | 用途 |
|---|---|---|
| `NodeFileReadLive` | `@aura/platform-node` | 文件读取能力 |
| `NodeFileWriteLive` | `@aura/platform-node` | 文件写入能力 |
| `NodeClockLive` | `@aura/platform-node` | 系统时钟访问 |
| `NodeCryptoLive` | `@aura/platform-node` | 加密随机数源 |

### 用于服务组装的 Layer 构造

验证服务组装的集成测试使用 `Layer.provide` 组合各层，然后将结果提供给程序：

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
    // ... 验证所有服务可解析
    return true as const
  }).pipe(Effect.provide(layer))
)
```

### 临时目录模式

需要文件 I/O 的测试使用 `fs.mkdtempSync` 创建临时目录，并以测试域名为前缀：

```typescript
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-core-recall-"))
```

这确保测试之间不互相干扰，且每个测试的临时空间在失败时可识别。

### Fixture 加载

测试 fixture 位于仓库根目录的 `test/fixtures/` 下。测试使用 `process.cwd()` 引用它们：

```typescript
const fixtureDir = path.join(process.cwd(), "test/fixtures/epistemic_belief_v1")
```

可用 fixture 集：

| Fixture | 内容 | 使用者 |
|---|---|---|
| `minimal_brain/` | `temporal.bin` | BrainAura、Aura.open 的集成测试 |
| `minimal_index/` | `index_manifest.json`、`sdr.idx`（Rust 生成） | InvertedIndex.load、召回管道测试 |
| `epistemic_belief_v1/` | `records.json`、`expected.json` | BeliefEngine.update 快照测试 |

### 测试数据工厂函数

测试定义辅助函数来构造具有合理默认值的测试数据。覆盖值作为偏参数传入：

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

### Fake / 存根实现

当测试需要验证依赖于服务接口的组件时，测试提供内联的 fake 实现，而非使用 mock 库：

```typescript
const NoopTrace: EpistemicTraceImpl = {
  event: () => Effect.void,
  span: (_name, _fields, eff) => eff
}

function fakeBeliefEngine(state: BeliefEngineState): BeliefEngineImpl {
  return {
    belief_for_record: (rid) => Effect.succeed(state.record_to_belief[rid] ?? null),
    unresolved_beliefs: () => Effect.succeed(/* ... */),
    // ... 其余方法
  }
}
```

然后通过 `Effect.provideService` 注入这些 fake：

```typescript
await Effect.runPromise(
  concept.discover(fakeBeliefEngine(state), records, sdr)
    .pipe(Effect.provideService(EpistemicTrace, NoopTrace))
)
```

### 确定性时钟

依赖时间的测试使用 `@aura/contract` 的 `Clock.fixed()` 将系统时钟冻结到已知时间戳：

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

这使得时间依赖逻辑（如信任评分中的新近度提升）完全确定且可重现。

## 测试分类

### 单元测试

纯逻辑测试，无文件 I/O 或平台依赖。这些测试直接用内存数据测试算法。

示例：
- `packages/recall/src/Trust.test.ts` —— 用硬编码元数据验证信任评分数学
- `packages/contract/src/Enums.test.ts` —— 运行时枚举字符串值
- `packages/indexing/src/InvertedIndex.searchScored.test.ts` —— 用内存 bitmap 验证倒排索引搜索和评分
- `packages/contract/src/Recall.test.ts` —— 标签提供和可选服务解析

### 集成测试

测试多个组件联合使用，包括真实的（或真实的）Effect Layer，在临时目录中进行文件 I/O。

示例：
- `packages/core/src/Aura.test.ts` —— Aura.open 配合 BrainAuraFile + 平台层
- `packages/core/src/Recall.test.ts` —— 端到端召回管道（BrainAuraFile、CognitiveStoreFile、recallScored）
- `packages/core/src/DefaultLayer.test.ts` —— 完整的 layer 组合和服务解析
- `packages/storage/src/BrainAura.test.ts` —— BrainAuraFile 打开、写入、刷新、读回
- `packages/indexing/src/InvertedIndex.fixture.test.ts` —— 加载 Rust 生成的二进制 fixture
- `packages/belief/src/BeliefEngine.test.ts` —— 基于 JSON fixture 的信念消解

### 对等测试

跨语言验证测试，比较 TypeScript 输出与 Rust 参考实现。这些测试启动 Rust 二进制文件作为子进程，并断言 TypeScript 和 Rust 结果完全匹配。

示例：
- `packages/core/src/Recall.parity.test.ts` —— 启动 `aura-ts-recall-fixtures` 和 `aura-ts-verify-recall` Rust 二进制文件，在相同数据上运行 `Aura.recallScored`，并断言结果排序一致。

对等测试需要安装 Rust 工具链（`cargo`）并构建 monorepo 的 Rust crates。它们不应在没有 Rust 的环境中运行。

### 中文语言测试

信念引擎有以 `.zh.test.ts` 后缀标识的语言特定测试。

- `packages/belief/src/BeliefEngine.zh.test.ts` —— 用中文内容测试信念消解，验证桶聚类、相近分数的未消解状态以及已消解优胜者选择。

## 覆盖率要求

未配置覆盖率阈值。项目依赖中没有覆盖率工具（c8、istanbul、nyc），vitest 配置也未定义 `coverage` 设置。

## CI 集成

此仓库中不存在 CI 工作流（`.github/workflows/`）。测试必须在提交更改前通过 `bun run test` 本地运行。

## 编写新测试

按照以下步骤，遵循项目约定添加测试：

1. **创建测试文件**与源文件并列，使用 `*.test.ts` 后缀。例如，为 `packages/recall/src/MyModule.ts` 添加测试，创建 `packages/recall/src/MyModule.test.ts`。

2. **以标准导入开头：**

   ```typescript
   import { it } from "vitest"
   import { assert } from "@effect/vitest"
   import { Effect } from "effect"
   ```

3. **对于纯逻辑测试**，编写直接调用函数并断言返回值的 `it` 块。如果函数是同步的，不需要 `await` 或 `Effect.runPromise`。

4. **对于基于 Effect 的测试**，用 `Effect.runPromise` 包裹代码并 `await` 结果。对于多步 Effect，使用 `Effect.gen(function* () {})`。通过 `.pipe(Effect.provide(...))` 提供所需的层。

5. **对于需要文件 I/O 的测试**，使用 `fs.mkdtempSync(path.join(os.tmpdir(), "aura-<domain>-"))` 创建临时目录，并从 `@aura/platform-node` 提供平台层（`NodeFileReadLive`、`NodeFileWriteLive` 等）。

6. **对于依赖服务接口的测试**，创建 fake 或存根实现作为纯对象字面量，然后用 `Effect.provideService(Tag, fake)` 注入。不要使用 mock 库。

7. **对于时间依赖逻辑**，通过 `Effect.provideService(Clock, clock)` 注入 `Clock.fixed(timestamp)` 使测试确定化。

8. **运行测试**验证：

   ```bash
   bun vitest run packages/<包名>/src/<模块名>.test.ts
   ```

### 应避免的反模式

- 不要使用 `describe` 块 —— 项目约定是扁平的 `it` 块。
- 不要从 vitest 导入 `expect` —— 使用 `@effect/vitest` 的 `assert`。
- 不要安装 mock 库 —— 使用手写的 fake/存根对象。
- 不要编写依赖真实时间流逝的测试 —— 使用 `Clock.fixed()`。
- 不要编写在 `it` 块之间修改共享全局状态的测试。
