---
name: rust-ts-projection-pattern
description: Rust→TS 语义投影代码风格 — Record+namespace 合并、Interface/Impl 分层、Layer DI 运行时装配、可选服务注入。
---
以此文档为准：不存在的函数说明需要实现它，而不是直接跳过。

# Rust→TypeScript 语义投影模式

本项目将 Rust 核心的架构模式投影到 TypeScript/Effect-TS 生态。以下是已确立的代码风格和分层约定。

> **关联技能：**
> - `effect-project-pattern` — Effect-TS 编码规范（Layer 构建、错误处理、Effect.gen 陷阱）
> - `contract-interface-pattern` — 合约接口模式详细转换步骤
> - `effect-ts` — Effect-TS 通用 API 参考
> - `effect` — Effect 源码验证

## 一、核心模式总览

```
┌─────────────────────────────────────────────────────────┐
│  @aura/contract    接口定义（Tag + namespace.Interface）   │
│  @aura/<module>    实现类（Impl implements X.Interface）  │
│  @aura/core        DefaultLayer 装配（Layer.mergeAll）    │
│  @aura/platform-*  Live 实现（IO/平台依赖）               │
└─────────────────────────────────────────────────────────┘
```

分层约束：
- `core/storage/codec/indexing/recall` 禁止直接 `import node:*`
- 平台 IO 通过 `@aura/contract` 的服务接口注入，由 `@aura/platform-node` 提供 Live 实现
- 所有服务用 `@aura/*` alias 跨包引用，不允许相对引用

## 二、Record 类型 + 命名空间合并

TypeScript 的 class/namespace 合并是 Rust struct + impl 块的直接投影。

### 模式

```typescript
// 1) 定义数据接口（= Rust struct 字段）
export interface Record {
  id: RecordId
  content: string
  strength: number
  // ...
}

// 2) 同名 namespace 挂载方法（= Rust impl Record { ... }）
export namespace Record {
  /**
   * Composite importance score.
   * 组合重要性分数；与 Rust `Record::importance` 公式对齐。
   *
   * Rust reference: `Record::importance` (`../src/record.rs`).
   */
  export function importance(record: Record): number {
    ...
  }
}
```

### 规则

- **数据用 `interface`**：定义纯数据字段，所有字段 `readonly`
- **方法用 `namespace`**：同名 namespace 内放纯函数，第一个参数是 `record: Record`
- **注释保持 Rust 对齐**：JSDoc 写中文翻译，保留 `Rust reference:` 路径标注
- **常量/辅助类型放在同一文件顶部**：如 `MAX_TAGS`、`VALID_SOURCE_TYPES`、`defaultConfidenceForSource()`
- **校验函数也放在同一 namespace 或同文件**：如 `validateRecordNamespace()`、`validateRecordStoreInput()`

### 调用方

```typescript
import { Record as AuraRecord } from "@aura/contract" // 同时导入type 和 namespace 方法

const score = AuraRecord.importance(rec)
```

### 适用场景

| 适用 | 不适用 |
|------|--------|
| Rust struct 的方法（纯计算、无副作用） | 需要 Effect 依赖的方法 → 走 Interface+Impl 模式 |
| 数据转换、校验、getter | 跨模块服务调用 |

## 三、Interface + Impl 分层模式

Rust trait → TypeScript `namespace.Interface`，Rust trait impl → TypeScript `class Impl implements X.Interface`。

### Contract 侧（`packages/contract/src/Xxx.ts`）

```typescript
import { Tag } from "./Context"
import type { Effect } from "effect"

export namespace Xxx {
  /**
   * 服务接口文档 — LSP 对调用方可见。
   */
  export interface Interface {
    /** 方法文档 — 中文翻译紧随其后 */
    method: (param: Type) => Effect.Effect<ReturnType, ErrorType, Requirements>
  }
}

export class Xxx extends Tag("aura.contract.Xxx")<
  Xxx,
  Xxx.Interface
>() {}
```

### 规则

- **Tag key 用 `"aura.contract.Xxx"` 命名空间**
- **JSDoc 写在 contract 侧**（非实现侧），中英双语
- **方法签名用 `readonly` 箭头属性**（`method: (p: T) => Effect<...>`）
- **`E` 通道必须具体**：用 `TaggedError` 子类，不用 `unknown/any`
- **`R` 通道显式声明依赖**：`Effect.Effect<A, E, FileRead | Clock>`，不用隐式依赖
- **命名不以 `Tag` 或 `Context` 后缀结尾**

### 实现侧（`packages/xxx/src/Xxx.ts`）

```typescript
export class XxxImpl implements Xxx.Interface {
  private state: XxxState = { /* ... */ }

  method(param: Type): Effect.Effect<ReturnType, ErrorType, Requirements> {
    const self = this
    return Effect.gen(function* () {
      // ...
    })
  }
}
```

### 规则

- **显式 `implements Xxx.Interface`**
- **`Effect.gen` 内用 `const self = this` 捕获引用**（generator 中 this 不指向实例）
- **实现侧只保留特殊标记**（`SIMPLE IMPLEMENTATION`/`NON-PARITY`/`UNIMPLEMENTED`/`TODO`），不重复 JSDoc
- **状态用 instance fields**：`private state: XxxState = { ... }`
- **命名**：`XxxImpl`，与 contract 的 `Xxx` Tag class 区分

### 调用方式

```typescript
// 值位置 — 获取服务实例（依赖注入）
import { Xxx } from "@aura/contract"
const service = yield* Xxx

// 类型位置 — 参数/返回值类型
import type { Xxx } from "@aura/contract"
function foo(engine: Xxx.Interface): void {}
```

**关键区别：** 值导入同时提供 namespace（`.Interface` 类型可用），不需要单独 `import type`。

### 反模式

- ❌ 单独 `import type { Xxx }` — 值导入同时提供 namespace
- ❌ 在接口和实现两侧各写一份 JSDoc — 会漂移
- ❌ 用 `typeof Xxx` 取接口类型 — 应该用 `Xxx.Interface`

## 四、Layer 依赖注入与运行时装配

Effect Layer 是依赖注入的最规范化实现：`Layer` = 服务工厂，`Layer.mergeAll` = 组合多个工厂。

### 三种 Layer 构建方式

| 场景 | 方案 | 示例 |
|------|------|------|
| 无初始化副作用 | `Layer.succeed` | `Layer.succeed(BeliefEngine, new BeliefEngineImpl())` |
| 需要 Ref.make / 异步初始化 | `Layer.effect` | `Layer.effect(EpistemicRuntime, Effect.gen(function* () { ... }))` |
| 合并多个 Layer | `Layer.mergeAll` | `Layer.mergeAll(LayerA, LayerB, LayerC)` |

### Layer.succeed — 无副作用的同步构造

```typescript
// belief/src/BeliefEngine.ts
export class BeliefEngineImpl implements BeliefEngine.Interface {
  private state: BeliefEngineState = { version: 1, beliefs: {}, ... }
  // ...
}

export const BeliefEngineLive = Layer.succeed(BeliefEngine, new BeliefEngineImpl())
```

### Layer.effect — 需要 Effect 操作的初始化

```typescript
// epistemic-runtime/src/EpistemicRuntime.ts
export const EpistemicRuntimeLive = Layer.effect(
  EpistemicRuntime,
  Effect.gen(function* () {
    const counter = yield* Ref.make(0)       // 需要 Effect 上下文
    return new EpistemicRuntimeImpl(counter)
  })
)
```

### Layer.mergeAll/provide(Merge) — 组合装配（Default Layer）

```typescript
// core/src/DefaultLayer.ts
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
    BoundedRerankerFileLive(brainDir),
    RecallFinalizerFileLive(brainDir)
  )
}
```

### 规则

- **无provide关系的 Layer 要用`Layer.mergeAll`并排合并**：使用 provideMerge 建立 provide 关系。
- **Layer 合并顺序决定服务可见性**：1对1的依赖直接provideMerge, 多对1的依赖在Layer.mergeAll后使用provideMerge
- **provideMerge会合并服务**：如果不需要合并只提供，直接使用provide即可。
- **同一个 Layer 在同一个 Runtime 内只初始化一次**（天然缓存）
- **Promise 缓存模块**（`let _cache: Promise<T>`）→ 替换为 `Layer.effect` + `Tag`，Promise 只在 Layer 内出现一次

### 平台 IO 分层

```
@aura/contract          → FileRead Tag (interface only)
@aura/platform-node     → NodeFileReadLive (Layer providing real fs)
@aura/core              → DefaultLayer (consumer — 不 import node:*)
```

```typescript
// contract 侧 — 只定义接口
export class FileRead extends Tag("aura.contract.FileRead")<FileRead, {
  read: (path: string) => Effect.Effect<string, FileReadError>
}>() {}

// platform-node 侧 — 提供平台实现
export const NodeFileReadLive = Layer.succeed(FileRead, {
  read: (path) => Effect.try({ try: () => fs.readFileSync(path, "utf-8"), catch: ... })
})

// 使用方
const content = yield* FileRead
const data = yield* content.read("/path/to/file")
```

## 五、可选服务注入 (serviceOption)

Rust 的 `Option<Arc<dyn Trait>>` 投影为 `serviceOption(Tag)`。

```typescript
import { serviceOption } from "@aura/utils"

const reranker = yield* serviceOption(BoundedReranker)
if (Option.isSome(reranker)) {
  yield* reranker.value.rerank(scored, query)
}
// 未提供时静默跳过，不报错
```

### 规则

- **横切关注点用 serviceOption**：trace、rerank、finalize、embedding — 可插拔
- **核心依赖用 `yield* Tag`**：强制要求，缺失即报错（不透明 Effect.die）
- **涉及serviceOption的模块测试必须覆盖两条路径**：提供服务 + 缺失跳过

### 实现

```typescript
// packages/utils/src/Optional.ts
export function serviceOption<I, S>(key: Context.Key<I, S>): Effect.Effect<Option.Option<S>> {
  return Effect.contextWith((ctx) => Effect.succeed(Context.getOption(ctx, key)))
}
```

## 六、Context.Reference 模式（带默认值的工具服务）

`Context.Reference` 自带 defaultValue，不显式出现在 `R` 通道。

```typescript
// packages/contract/src/Clock.ts
export class Clock extends Context.Reference<{
  nowSeconds: () => number
}>("aura.contract.Clock", {
  defaultValue() {
    return { nowSeconds: nowSecs }
  },
}) {
  static nowSeconds = () => Clock.useSync((_) => _.nowSeconds())
  static fixed = (nowUnixSec: number) => ({ nowSeconds: () => nowUnixSec })
}
```

### 适用场景

| 适用 | 不适用 |
|------|--------|
| 工具/横切服务（Clock、Random、Logger） | 明确的服务类依赖（引擎、仓储、API 客户端） |
| 有合理默认实现，80% 场景不需要替换 | 必须由调用方显式提供的核心依赖 |
| 测试中偶尔需要固定值 | 每个测试都需要不同 mock 的服务 |

**决策规则：** 不确定时默认走 `Tag`。只有提供合理默认值的工具类才用 `Context.Reference`。

## 七、错误处理投影

Rust `Result<T, E>` → Effect `E` 通道，Rust `panic!` → Effect `die`。

```typescript
import { Data } from "effect"

// 可恢复业务错误 → TaggedError（在 E 通道）
export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

// 不可恢复缺陷 → die（不污染 E 通道）
export class UnimplementedError extends Data.TaggedError("UnimplementedError")<{
  readonly feature: string
}> {}

// 使用
Effect.fail(new FileReadError({ path, cause: err }))        // fail → E 通道
Effect.die(new UnimplementedError({ feature: "NGram" }))    // die → 缺陷

// 精确捕获
effect.pipe(
  Effect.catchTag("FileReadError", (err) => Effect.succeed(defaultValue))
)
```

### 规则

- **所有可恢复错误用 `Data.TaggedError` 子类**
- **主写入/召回链路不要用 `UnimplementedError`** — 优先跑通
- **非主流程占位可以用 `Effect.die(new UnimplementedError(...))`**

## 八、Surface Pipeline 模式

引擎内部状态 → 公开视图类型的统一管线：

```
filter → sort → limit → map
```

```typescript
function surfaceConcepts(state: ConceptState, limit = 20): SurfacedConcept[] {
  return Object.values(state.candidates)
    .filter(c => c.state === "Stable")
    .sort((a, b) => b.coherence - a.coherence)
    .slice(0, limit)
    .map(toSurfacedConcept)
}
```

## 九、枚举投影

Rust enum → TypeScript `enum`（string enum），非 string union。

```typescript
export enum Level {
  Working = "Working",
  Decisions = "Decisions",
  Domain = "Domain",
  Identity = "Identity",
}
```

### 规则

- **用 TypeScript `enum`**（提供运行期值对象，便于跨包引用与测试断言）
- **枚举值必须与 Rust 侧字符串表示一致**
- **解析外部输入时先验证**：`Object.values(Enum).includes(x)` 再 cast
- **有对应的 enum 测试**：`packages/contract/src/Enums.test.ts`

## 十、Effect.gen 编排规范 (beta.68)

```typescript
// ✅ 正确：function* () 无参数
Effect.gen(function* () {
  const a = yield* serviceA.method()
  const b = yield* serviceB.method(a)
  return b
})

// 并发
yield* Effect.all(
  { concept: conceptEngine.discover(records), causal: causalEngine.discover(records) },
  { concurrency: 2 }
)

// ❌ 错误：beta.68 不支持 $ 参数
Effect.gen(function* ($) { /* ... */ })

// ❌ 错误：satisfies 在 exactOptionalPropertyTypes 下可能冲突
const report = { /* ... */ } satisfies Report

// ✅ 正确：用 as 强制转换
const report = { /* ... */ } as Report
```

### 已知陷阱

1. `function* ($)` 不支持 — beta.68 用 `function* ()` 无参
2. `Effect.dieMessage` 不存在 — 用 `Effect.die(new UnimplementedError(...))`
3. `satisfies` 不缩窄返回类型 — 用 `as` 强制转换
4. Ref 类型是 `Ref.Ref<T>` — 不是 `Effect.Ref.Ref<T>`
5. `Effect.service(Tag)` — 不是 `Effect.service`（无 s）

## 十一、文件组织公约

```
packages/
├── contract/src/          ← 所有 Tag + namespace.Interface + 共享类型/enum
│   ├── Belief.ts          ← BeliefEngine Tag + BeliefStore Tag
│   ├── Causal.ts          ← CausalEngine Tag + CausalStore Tag
│   ├── Concept.ts         ← ConceptEngine Tag + ConceptStore Tag
│   ├── Policy.ts          ← PolicyEngine Tag + PolicyStore Tag
│   ├── Recall.ts          ← RecallView/BoundedReranker/RecallFinalizer/EmbeddingStore
│   ├── Context.ts         ← Tag helper
│   ├── Optional.ts        ← serviceOption helper
│   ├── Clock.ts           ← Context.Reference 示例
│   ├── Errors.ts          ← 所有 TaggedError 定义
│   └── record/Record.ts   ← Record interface + Record namespace
├── belief/src/            ← BeliefEngineImpl + BeliefStoreFile + BeliefEngineLive
├── concept/src/           ← ConceptEngineImpl + ConceptStoreFile + ConceptEngineLive
├── causal/src/            ← CausalEngineImpl + CausalStoreFile + CausalEngineLive
├── policy/src/            ← PolicyEngineImpl + PolicyStoreFile + PolicyEngineLive
├── epistemic-runtime/src/ ← EpistemicRuntimeImpl + EpistemicRuntimeLive
├── recall/src/            ← 召回算法（无状态，纯函数）
├── storage/src/           ← RecallViewLive + CognitiveRecord + 文件读取
├── indexing/src/          ← InvertedIndex + NGramIndex（无状态）
├── core/src/              ← DefaultLayer + Aura + Recall/Maintenance facade
├── utils/                 ← 公共 helper（hash、时间、UnionFind 等）
└── platform-node/         ← NodeFileReadLive + NodeFileWriteLive + NodeCryptoLive
```

### 规则

- **contract 是唯一真相源**：所有 Tag、Interface、enum、Error 类型定义在此
- **实现包不互相 import**：belief 不 import concept（反之亦然），通过 contract 解耦
- **utils 是纯函数工具库**：不依赖任何其他 @aura 包
- **禁止跨包相对引用**：一律用 `@aura/xxx` alias
