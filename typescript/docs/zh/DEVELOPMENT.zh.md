<!-- generated-by: gsd-doc-writer -->

## 本地搭建

### 前置条件

- **Bun**（主要包管理器；锁文件为 `bun.lock`）
- **TypeScript >= 5.6**（由项目的 `devDependencies` 管理）
- **Git** 用于克隆仓库

### 克隆和安装

```bash
git clone <仓库地址>
cd AuraSDK/typescript
bun install
```

在根目录运行 `bun install` 会一次性安装所有工作区包，无需逐包安装。

### 类型检查

```bash
bun run typecheck
```

运行 `tsc -p tsconfig.json --noEmit`，执行完整类型检查而不生成输出文件。不存在构建步骤 —— 每个工作区包直接从 `src/index.ts` 导出 TypeScript 源码，Bun 运行时原生解析 `.ts` 文件。

## 构建命令

| 命令 | 描述 |
|---|---|
| `bun run test` | 单次运行完整测试套件（`vitest run --passWithNoTests`） |
| `bun run test:watch` | 监听模式运行测试（`vitest --passWithNoTests`） |
| `bun run typecheck` | 对整个 monorepo 进行类型检查（`tsc --noEmit`） |

`--passWithNoTests` 标志确保即使未找到测试文件，套件也能成功退出 —— 这对测试覆盖不均衡的 monorepo 很重要。

没有 `build` 命令。项目不将 TypeScript 编译为 JavaScript —— Bun 和 Vitest 均原生解析 `.ts` 源文件。

## 代码风格

项目根目录未配置代码检查器或格式化器（ESLint、Prettier、Biome、`.editorconfig`）。代码风格由约定维护，并通过 TypeScript `strict` 模式和 `noUncheckedIndexedAccess` 强制执行。

关键风格约定：

- **仅 ESM** —— 无 CommonJS。所有包声明 `"type": "module"`。
- **Effect 错误通道中不使用 `any` 或 `unknown`** —— 所有错误类型均为显式的 `Data.TaggedError` 子类。
- **仅类型导入** 显式使用 `type` 关键字：`import type { RecallView } from "@aura/contract"`。
- **当前未配置代码检查器/格式化器**；一致性由约定和 TypeScript 严格检查维护。

### 命名约定

| 构造 | 模式 | 示例 |
|---|---|---|
| 类型 / 接口 | PascalCase | `RecallView`、`StoreOptions` |
| Effect 服务 | PascalCase 名词 | `FileRead`、`Clock` |
| Live 层 | PascalCase + Live | `NodeFileReadLive`、`RecallViewLive` |
| 带标签错误 | PascalCase + Error | `FileReadError`、`JsonParseError` |
| 函数 | camelCase | `recallScored`、`computeEffectiveTrust` |
| 常量 / 枚举 | PascalCase | `Level`、`DEFAULT_NAMESPACE` |

### Rust 对等约定

此项目是 Rust Aura 核心的 1:1 TypeScript 重写。为跟踪差异，源代码中放置了标注标记：

- `SIMPLE IMPLEMENTATION:` —— 简化方案，附原因和 Rust 参考
- `NON-PARITY IMPLEMENTATION:` —— 有意偏离，附原因
- `UNIMPLEMENTED:` —— 占位符，附原因和 Rust 参考
- `TODO:` —— 待处理工作

这些标记可全局搜索，帮助贡献者理解实现意图。

### 路径别名

所有跨包导入使用 `@aura/*` 别名。跨包相对导入不被允许。别名在 `tsconfig.json`（`paths`）和 `vitest.config.ts`（`resolve.alias`）中同时配置：

| 别名 | 映射到 |
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

每个包也配置了通配子路径别名（`@aura/<name>/*`）。

## 分支约定

仓库中未记录分支命名约定。主分支名为 `main`。

<!-- VERIFY: 分支约定可能在外部有文档记录（项目 wiki、Notion 等） -->

## PR 流程

仓库中不存在 PR 模板或 CI 工作流配置。目前没有 `.github/` 目录。

提交更改时：

1. 确保 `bun run typecheck` 通过且零错误。
2. 运行 `bun run test` 并确认所有测试通过。
3. 保持更改聚焦 —— 每个提交应处理单一关注点。
4. 遵循现有代码约定，特别是 Effect-TS 模式和 Rust 对等标记。
5. 为新行为添加并列测试（见[测试约定](#测试约定)）。

<!-- VERIFY: PR 审查流程 -- 仓库中没有 PR 模板或 CI 配置；外部审查流程可能在其他地方有文档记录 -->

## 工作区结构

### Monorepo 布局

根 `package.json` 声明单个工作区 glob：`packages/*`。所有 14 个工作区包遵循扁平 `src/` 布局。

```
typescript/
├── package.json           # 工作区根、脚本、共享依赖
├── tsconfig.json          # TypeScript 配置（含路径别名）
├── vitest.config.ts       # 测试配置（含包别名）
├── bun.lock               # Bun 锁文件
├── test/fixtures/         # 共享测试 fixtures
├── docs/                  # 项目文档
└── packages/              # 14 个工作区包
    ├── contract/          # 领域类型、枚举、上下文标签、错误
    ├── utils/             # 纯工具函数（bytes、hex、crc32、id12、time）
    ├── codec/             # 二进制/Bincode 序列化、加密原语
    ├── indexing/          # InvertedIndex、Roaring bitmap 序列化
    ├── storage/           # 文件解析、读模型、快照
    ├── recall/            # 召回管道算法（信号、RRF、信任）
    ├── core/              # 外观：Aura 类、召回入口、default layer
    ├── belief/            # 信念引擎和存储
    ├── concept/           # 概念引擎和存储
    ├── causal/            # 因果引擎和存储
    ├── policy/            # 策略引擎和存储
    ├── epistemic-runtime/ # 运行时编排和追踪
    ├── platform-node/     # Node.js Live 层（FileRead、FileWrite、Clock、Crypto）
    ├── code-extraction/   # 源代码解析和提取
    └── utils/             # 共享工具函数
```

### 包内部结构

每个包遵循扁平 `src/` 布局：

```
packages/<name>/
├── package.json           # 最小配置：{ name, private: true, type: "module", exports }
└── src/
    ├── index.ts           # 桶导出（重导出所有公开符号）
    ├── <Feature>.ts       # 实现
    ├── <Feature>.test.ts  # 并列测试（如有）
    └── <subdirs>/         # 分组类型（如 levels/、record/、sdr/）
```

例外是 `@aura/contract`，它使用子目录组织相关类型组（`levels/`、`record/`、`relation/`、`sdr/`、`belief/`、`concept/`）。

### Package.json 约定

所有工作区包：

- **私有**（`"private": true`）—— 不发布到 npm。
- **ESM**（`"type": "module"`）。
- **入口导出** 使用 `"exports": { ".": "./src/index.ts" }`，直接指向 TypeScript 源码。

依赖只在跨包共享时才在根 `package.json` 中声明。`@aura/code-extraction` 包是例外，自己声明了 `dependencies`（tree-sitter 相关包）。

## 从合约到实现的模式

项目遵循 Effect-TS 分层 DI 模式。服务在 `@aura/contract` 中定义为抽象合约，在平台或引擎包中实现为 Live 层。

### 1. 定义服务合约

在 `packages/contract/src/` 中，使用 `Context.Tag` 创建服务标签：

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

`Tag()` 辅助函数在 `packages/contract/src/Context.ts` 中定义，是 `Context.Service` 的轻量封装。

### 2. 定义错误类型

在 `packages/contract/src/Errors.ts` 中，使用 `Data.TaggedError` 定义带标签错误：

```typescript
export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}
```

绝不在 Effect 错误通道中使用 `unknown` 或 `any`。错误类型必须是显式且可枚举的。

### 3. 实现 Live 层

平台特定实现放在 `@aura/platform-node` 中：

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

Live 层的关键规则：

- **只有 `@aura/platform-node` 可以导入 `node:*`**。核心包（`storage`、`indexing`、`recall`、`codec`）绝不可直接引用 `node:*`。
- 使用 `Layer.succeed` 实现同步/基于对象的服务实现。
- 使用 `Layer.effect` 实现需要依赖的 effectful 构造。
- 用 `Effect.tryPromise` 封装平台 IO，然后用 `Effect.mapError` 将错误映射为类型化的带标签错误。

### 4. 组装 Layer 组合

在 `packages/core/src/DefaultLayer.ts` 中，用 `Layer.mergeAll` 组合各层：

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

### 可选服务模式

可能或可能不存在的服务使用 `serviceOption`：

```typescript
const traceOpt = yield* serviceOption(EpistemicTrace)
if (Option.isSome(traceOpt)) {
  yield* traceOpt.value.event("belief.update_with_sdr.start", { records: records.size })
}
```

服务存在和不存在两种路径都必须被测试。

## Effect-TS 模式

### 依赖注入

服务在调用处提供，而非静态导入：

```typescript
// 使用 —— 服务在 Effect 类型签名中被要求
const result = yield* Effect.service(FileRead)
const buf = yield* result.readFile(somePath)

// 在调用边界处提供
Effect.runPromise(myEffect.pipe(Effect.provide(NodeFileReadLive)))
```

### pipe 风格

Effect 使用 `.pipe()` 和 Effect 组合子进行组合：

```typescript
Effect.tryPromise(() => fs.readFile(p)).pipe(
  Effect.mapError((cause) => new FileReadError({ path: p, cause }))
)
```

### Effect.gen 生成器

需要顺序 yield 的复杂 Effect 使用 `Effect.gen`：

```typescript
Effect.gen(function* () {
  const { nowSeconds } = yield* Effect.service(Clock)
  const fs = yield* Effect.service(FileRead)
  const buf = yield* fs.readFile(path)
  return process(buf)
})
```

### 时间处理

始终使用 `@aura/utils/Time` 中的 `nowSecs()` 而非 `Date.now() / 1000`。这确保整个代码库的秒级时间戳行为一致，并允许在测试中使用确定性时间（通过 `Clock.fixed`）。

## 如何添加新包

1. **创建目录**：`mkdir packages/<新包名>/src`

2. **添加 `package.json`**：
   ```json
   {
     "name": "@aura/<新包名>",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts"
     }
   }
   ```

3. **创建桶导出**：`packages/<新包名>/src/index.ts` 重导出所有公开符号。

4. **在两个配置文件中添加路径别名**：
   - 在 `tsconfig.json` 的 `compilerOptions.paths` 中添加：
     ```json
     "@aura/<新包名>": ["packages/<新包名>/src/index.ts"],
     "@aura/<新包名>/*": ["packages/<新包名>/src/*"]
     ```
   - 在 `vitest.config.ts` 的 `resolve.alias` 中添加：
     ```typescript
     "@aura/<新包名>": pkg("<新包名>")
     ```

5. **运行 `bun install`** 链接工作区包。

6. **导入**：使用 `@aura/<新包名>` 别名从新包导入。绝不要在包边界之间使用相对路径。

## 测试约定

### 框架

测试使用 **Vitest 2.0+**，配置 `globals: true` 和 `environment: "node"`。`@effect/vitest` 包提供 Effect 原生的断言。

测试全局变量（`describe`、`it`、`expect`）无需显式导入即可使用。从 `@effect/vitest` 导入 `assert` 用于类型安全的断言。

### 文件组织

测试与它们所测试的源文件**并列放置**：

```
packages/<包名>/src/
├── Feature.ts
└── Feature.test.ts
```

### 编写测试

```typescript
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"

it("描述预期的行为", async () => {
  const result = await Effect.runPromise(
    myEffect.pipe(Effect.provide(MyLiveLayer))
  )
  assert.strictEqual(result, expected)
})
```

### 测试分类

测试分为几类：

| 类别 | 模式 | 示例 |
|---|---|---|
| 单元测试 | 具有确定性输入的算法函数 | `Trust.test.ts` |
| 往返测试 | 序列化到反序列化的恒等检查 | `InvertedIndex.roundtrip.test.ts` |
| Rust 对等 | 启动 Rust 二进制文件，比较 TS 输出与 Rust 输出 | `Recall.parity.test.ts` |
| 可选服务 | 测试"服务存在"和"服务不存在"两种路径 | Pipeline 测试含/不含 `BoundedReranker` |
| Layer 集成 | 验证 layer 组装和连接 | `DefaultLayer.test.ts` |

### Rust 对等测试模式

部分测试验证与 Rust 实现的磁盘格式和行为对等：

```typescript
const gen = spawnSync("cargo", ["run", "--bin", "aura-ts-recall-fixtures", "--", dir], ...)
const rust = spawnSync("cargo", ["run", "--bin", "aura-ts-verify-recall", "--", dir, query], ...)
const rustIds: string[] = JSON.parse(rust.stdout.trim())
const tsIds = scored.map(([, id]) => id)
assert.deepStrictEqual(tsIds, rustIds)
```

### Fixtures

共享测试 fixture 位于项目根的 `test/fixtures/` 中。测试通过 `path.join(process.cwd(), "test/fixtures/...")` 引用它们。

### 覆盖率

未配置覆盖率阈值。测试覆盖在各包之间不均衡 —— `@aura/storage` 测试最多（13 个文件），而 `@aura/causal`、`@aura/policy`、`@aura/epistemic-runtime` 和 `@aura/platform-node` 没有测试。

## 常见开发任务

### 更改后类型检查

```bash
bun run typecheck
```

提交前务必运行此命令。TypeScript `strict` 模式配合 `noUncheckedIndexedAccess` 在编译时捕获多种错误。

### 运行单个测试文件

```bash
bun run vitest run packages/belief/src/BeliefEngine.test.ts
```

或监听模式：

```bash
bun run vitest packages/belief/src/BeliefEngine.test.ts
```

### 对特定包运行测试

```bash
bun run vitest run packages/belief
```

### 调试特定包的类型错误

```bash
bun run tsc --noEmit --project tsconfig.json | grep "@aura/belief"
```

### 遵循 Rust 对等工作流

添加或修改行为时：

1. 找到对应的 Rust 源码并理解其意图。
2. 遵循现有约定实现 TypeScript 版本。
3. 用全局可搜索的标记标注任何差异：
   - `SIMPLE IMPLEMENTATION:` —— 简化方案
   - `NON-PARITY IMPLEMENTATION:` —— 有意偏离
   - `UNIMPLEMENTED:` —— 占位符 / 尚未完成
4. 如果 Rust 端有测试 fixture，使用 `spawnSync` 添加对等测试以验证输出一致。

### 添加 Effect 服务

1. 在 `@aura/contract` 中使用 `Tag("命名空间.名称")` 定义服务标签。
2. 如需，向 `@aura/contract/src/Errors.ts` 添加错误类型。
3. 实现 Live 层（IO 类型在 `@aura/platform-node` 中，逻辑类型在引擎包中）。
4. 从包的 `index.ts` 导出 Live 层。
5. 如果它是标准组合的一部分，在 `@aura/core` 的 `DefaultLayer` 中接入。
6. 编写并列测试，覆盖服务提供和服务不存在两种路径（如为可选服务）。
