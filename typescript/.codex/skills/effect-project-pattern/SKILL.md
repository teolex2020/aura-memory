---
name: effect-project-pattern
description: AuraSDK 项目 Effect-TS 编码规范 — 合约接口、Layer 构建、错误处理、测试 mock。写 Effect 代码时自动应用，避免本项目已知陷阱。
---

# Effect-TS 项目编码规范

本项目使用 Effect v4 (beta.68)，遵循特定的架构模式和约定。以下规则来自项目 LEARNINGS 和实际踩坑记录。

> **关联技能：**
> - `effect` — 本项目 Effect 编码基础规则（source of truth、代码搜索策略）
> - `effect-ts` — Effect-TS 通用 API 参考（组合子、Schedule、Stream、Layer 组合等）
> - `contract-interface-pattern` — 合约接口模式详细转换步骤
>
> 写本项目的 Effect 代码时，本 skill 优先级最高（项目特有约定 + 陷阱），
> 通用 API 查询回退到 `effect-ts`，源码验证回退到 `effect`。

## 架构模式

### 合约接口三段式

所有引擎服务遵循同一结构：contract 定义接口 → engine 实现 → Live Layer 装配。

**contract 侧：**

```typescript
// packages/contract/src/Xxx.ts
import { Tag } from "./Context"
import type { Effect } from "effect"

export namespace Xxx {
  export interface Interface {
    /** 方法文档 — 中英双语，LSP 对调用方可见 */
    method: (param: Type) => Effect.Effect<ReturnType, ErrorType, Requirements>
  }
}

export class Xxx extends Tag("aura.contract.Xxx")<
  Xxx, Xxx.Interface
>() {}
```

规则：
- 用 `namespace.Interface` + `Tag`，不用 deprecated 的 `export type XxxImpl`
- Tag key 用 `"aura.contract.Xxx"` 命名空间
- JSDoc 写在 contract 侧（非实现侧），中英双语
- 方法签名用 `readonly` 箭头属性

**engine 侧：**

```typescript
// packages/xxx/src/Xxx.ts
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

规则：
- 显式 `implements Xxx.Interface`
- `Effect.gen` 内用 `const self = this` 捕获引用（generator 中 this 不指向实例）
- 实现侧只保留 `SIMPLE IMPLEMENTATION` / `NON-PARITY` / `UNIMPLEMENTED` / `TODO` 标记，不重复 JSDoc

### Layer 构建

| 场景 | 方案 |
|------|------|
| 服务无初始化副作用 | `Layer.succeed(Xxx, Xxx.of({...}))` |
| 服务需要 Ref.make / 异步初始化 | `Layer.effect(Xxx, Effect.gen(function* () { ... }))` |
| 合并多个 Layer | `Layer.mergeAll(LayerA, LayerB, LayerC)` |

```typescript
// Layer.effect 示例 — 需要 Ref 初始化时
export const EpistemicRuntimeLive = Layer.effect(
  EpistemicRuntime,
  Effect.gen(function* () {
    const counter = yield* Ref.make(0)
    return new EpistemicRuntimeImpl(counter)
  })
)
```

### Context.Reference 模式（带默认值的服务）

`Context.Reference` 创建一个自带默认值的服务 Tag，无需显式列入依赖类型（R 通道），但保留了 DI 覆盖能力。

参照项目中的 `Clock`（`packages/contract/src/Clock.ts`）：

```typescript
import { Context } from "effect"

export class Clock extends Context.Reference<{
  nowSeconds: () => number
}>("aura.contract.Clock", {
  defaultValue() {
    return { nowSeconds: nowSecs }  // 生产环境默认实现
  },
}) {
  static nowSeconds = () => Clock.useSync((_) => _.nowSeconds())
  static fixed = (nowUnixSec: number) => ({ nowSeconds: () => nowUnixSec })
}
```

**为什么不需要列入 R 通道：**

`Context.Reference` 的类型签名是 `Reference<Shape>` extends `Service<never, Shape>`。因为 Identifier 是 `never`，Effect 类型系统认为该依赖"永远已满足"，不会出现在 `Effect.Effect<A, E, R>` 的 `R` 中。这避免了每个调用方都要声明 `R = Clock` 的繁琐。

**DI 仍然可用：**

```typescript
// 默认用法 — 无需 provide，自动使用 defaultValue
const time = yield* Clock

// 测试中覆盖 — 与普通 Tag 完全一样的 DI 方式
const fixedClock = Layer.succeed(Clock, Clock.fixed(1700000000))
program.pipe(Effect.provide(fixedClock))
```

**适用场景：**

| 适用 | 不适用 |
|------|--------|
| 工具/横切服务（Clock、Random、Logger） | 明确的服务类依赖（引擎、仓储、API 客户端） |
| 有合理默认实现，80% 场景不需要替换 | 必须由调用方显式提供的核心依赖 |
| 测试中偶尔需要固定值 | 每个测试都需要不同 mock 的服务 |

**规则：**

- 只有提供合理默认值的工具类服务才使用 `Context.Reference`
- 明确的服务类依赖（如 `BeliefEngine`、`EpistemicRuntime`、任何 `*Repo`）**绝对不能**使用此模式 — 它们必须走标准 `Tag` + `Layer`，在 R 通道中显式声明
- 如果犹豫一个服务是否该用 Reference，答案是：**不要用**。默认走 `Tag`

### 可选服务注入 (serviceOption)

```typescript
// 从 packages/contract/src/Optional.ts 导入
const traceOpt = yield* serviceOption(EpistemicTrace)
if (Option.isSome(traceOpt)) {
  yield* traceOpt.value.event("start", {})
}
// 未提供时静默跳过，不报错
```

规则：
- 横切关注点（trace、rerank、finalize）用 serviceOption
- 核心依赖用 `Effect.service()` 强制要求

### Promise 缓存模块 → Layer 替换（最小 Promise 模式）

项目中存在大量 `function getHasher(): Promise<{ h64: ... }>` 模式的懒加载缓存函数，本质是用 module-level 的 `let` 做 `Promise` 缓存：

```typescript
// ❌ 反模式：Promise 缓存模块加载
let _hasher: Promise<Hasher> | null = null

export function getHasher(): Promise<{ h64: (input: string) => bigint }> {
  if (!_hasher) _hasher = createHasher()
  return _hasher
}

// 调用方
const hasher = await getHasher()
const hash = hasher.h64("input")
```

**为什么这是问题：**
- 隐式全局状态，无法在测试中替换
- Promise 缓存生命周期不可控（没有 teardown）
- 与 Effect 的依赖注入体系割裂，调用方必须用 `await` 逃出 Effect pipeline

**最小迁移模式 — 用 Layer 表达可缓存的一次性初始化：**

```typescript
// ✅ Layer 替换：Effect 原生的"可缓存模块加载"
import { Layer } from "effect"

export class Hasher extends Tag("aura.Hasher")<Hasher, {
  h64: (input: string) => Effect.Effect<bigint>
  unsafeH64: (input: string) => bigint
}>() {}

export const HasherLive = Layer.effect(
  Hasher,
  Effect.gen(function* () {
    const _ = yield* Effect.promise(() => createHasher())
    return Hasher.of({
      h64: (input) => Effect.sync(() => _.h64(input)), // or Effect.promise(() => _.h64Async(input))
      unsafeH64: (input) => _.h64(input),
    })
  })
)

// 调用方 — 通过 Effect.service 获取，无需 await
const hasher = yield* Hasher
const hash = yield* hasher.h64("input")
```

规则：
- **封装 `Promise` 只在 `Layer.effect` 内出现一次**，其余代码全部走 `Tag` + `yield*`
- `Layer` 天然缓存：同一 `Layer` 在同一个 `Runtime` 内只初始化一次
- 测试时直接 `Layer.succeed(Hasher, mock)` 替换，无需 hack module-level 变量
- 如果 `Promise` 返回的函数有同步路径，用 `Effect.sync(() => raw.fn(input))` 包裹，避免 `Effect.promise` 的微任务开销 pollute 调用链

## Effect.gen 规范 (beta.68)

```typescript
// ✅ 正确：function* () 无参数
Effect.gen(function* () {
  const data = yield* someEffect
  return process(data)
})

// ❌ 错误：beta.68 不支持 $ 参数
Effect.gen(function* ($) { /* ... */ })

// ❌ 错误：exactOptionalPropertyTypes 下 satisfies 可能冲突
const report = { /* ... */ } satisfies Report  // 可能报错

// ✅ 正确：用 as 强制转换
const report = { /* ... */ } as Report
```

## 错误处理

### TaggedError 定义

```typescript
import { Data } from "effect"

export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class UnimplementedError extends Data.TaggedError("UnimplementedError")<{
  readonly feature: string
}> {}
```

### fail vs die 边界

```typescript
// 可恢复业务错误 → fail（类型安全，在 E 通道）
Effect.fail(new FileReadError({ path, cause: err }))

// 不可恢复缺陷 → die（不污染 E 通道）
Effect.die(new UnimplementedError({ feature: "NGramIndex" }))

// 外部异常转 TaggedError
Effect.try({
  try: () => JSON.parse(raw),
  catch: (cause) => new JsonParseError({ path, cause })
})
```

规则：
- 所有可恢复错误用 `Data.TaggedError` 子类
- 主写入/召回链路不要用 `UnimplementedError` — 优先跑通
- 非主流程占位可以用 `Effect.die(new UnimplementedError(...))`

### 精确捕获

```typescript
effect.pipe(
  Effect.catchTag("FileReadError", (err) => Effect.succeed(defaultValue)),
  Effect.catchTag("JsonParseError", (err) => Effect.fail(new DomainError({ ... })))
)
```

## Ref 使用

```typescript
import { Ref } from "effect"

const counter = yield* Ref.make(0)
const value = yield* Ref.get(counter)
yield* Ref.update(counter, (n) => n + 1)

// 类型注解
const ref: Ref.Ref<number> = yield* Ref.make(0)
// ❌ 不是 Effect.Ref.Ref<number> — beta.68 中不存在
```

## Effect.all 并发

```typescript
// 并行执行（等价 Rust rayon::join）
yield* Effect.all(
  { concept: conceptEngine.discover(records), causal: causalEngine.discover(records) },
  { concurrency: 2 }
)
```

## 测试 Mock 模式

```typescript
function mockBeliefEngine(opts: MockOptions = {}): BeliefEngine.Interface {
  const state = { version: 1 as const, beliefs: opts.beliefs ?? {}, /* ... */ } as BeliefEngineState
  return {
    update: () => Effect.succeed(emptyReport),
    stats: () => Effect.succeed(state),
    belief_for_record: (id: string) => Effect.succeed(opts.recordToBelief?.[id] ?? null),
    // 不需要的方法 → Effect.void
    deprecate_belief: () => Effect.void,
  }
}

// 注入
const layer = Layer.succeed(BeliefEngine, mockBeliefEngine({ /* ... */ }))
program.pipe(Effect.provide(layer))
```

规则：
- mock 返回类型声明为 `Xxx.Interface`，不用 `XxxImpl`
- 默认行为用 `Effect.succeed()` / `Effect.void`
- 用 `as` 强制转换（mock 不需要完全符合类型形状）

## Surface Pipeline 模式

转换引擎内部状态为公开视图类型的统一管线：

```
filter → sort → limit → map
```

```typescript
function surfaceXxx(state: XxxState, limit = 20): SurfacedXxx[] {
  return Object.values(state.items)
    .filter(item => item.state === XxxState.Stable)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(toSurfaced)
}
```

## 已知陷阱（必须避免）

1. **`function* ($)` 不支持** — beta.68 的 Effect.gen 用 `function* ()` 无参
2. **`Effect.dieMessage` 不存在** — 用 `Effect.die(new UnimplementedError(...))` 替代
3. **`satisfies` 不缩窄** — exactOptionalPropertyTypes 下用 `as` 强制转换
4. **Ref 类型是 `Ref.Ref<T>`** — 不是 `Effect.Ref.Ref<T>`
5. **`Effect.service` 不是 `Effect.service`** — 实际是 `Effect.service(Tag)`，无 `s`
6. **workspace 依赖需显式声明** — 跨包 import 要在 `package.json` 加 `"@aura/xxx": "workspace:*"`
7. **智能引号问题** — Windows 上 Edit 工具可能把 `"` 变成中文引号，导致 TS1127
8. **Effect.gen 返回类型** — 返回 `Effect.Effect<T, E, R>` 的完整标注可能与推断冲突，优先不加显式返回类型
9. **`getHasher()` Promise 缓存** — 用 `Layer.effect` + `Tag` 替换 module-level 的 `let _cache: Promise<T> | null` 模式，Promise 只在 Layer 内出现一次
