---
name: contract-interface-pattern
description: 合约接口模式 — 将 Tag class 与 namespace.Interface 合并，JSDoc 写在合约侧，实现类显式 implements
---

# 合约接口模式 (Contract Interface Pattern)

## 模式说明

将 `export type XxxImpl = { ... }` 重构为 `export namespace Xxx { export interface Interface { ... } }`，
利用 TypeScript 的 class+namespace 合并特性，让 Tag class 与接口类型挂载在同一个名字下。
**JSDoc 注释从实现类移到合约接口**，确保所有调用方通过 LSP 能看到方法文档。

## 合约文件 (`packages/contract/src/Xxx.ts`)

```typescript
import { Tag } from "./Context"
import type { Effect } from "effect"
// ... other imports ...

export namespace Xxx {
  /**
   * 服务接口文档 — LSP 对调用方可见。
   */
  export interface Interface {
    /** 方法文档 — 中文翻译紧随其后 */
    method1: (param: Type) => Effect.Effect<ReturnType>
    method2: (param: Type) => Effect.Effect<ReturnType, ErrorType, RType>
  }
}

export class Xxx extends Tag("aura.contract.Xxx")<
  Xxx,
  Xxx.Interface
>() {}

```

## 实现文件 (`packages/xxx/src/Xxx.ts`)

```typescript
import { Xxx } from "@aura/contract"

export class XxxImpl implements Xxx.Interface {
  // 方法实现 — 仅保留实现相关标记（SIMPLE IMPLEMENTATION, NON-PARITY, UNIMPLEMENTED, TODO）
  // 通用 API 文档已在合约接口中
  method1(param: Type): Effect.Effect<ReturnType> {
    // ...
  }
}

export const XxxLive = Layer.sync(Xxx, () => new XxxImpl())
```

或直接使用 纯函数/`Effect.gen` 实现
```typescript
import { Effect } from "effect"

// Layer.sync 同步实现
export const XxxLive = Layer.sync(Xxx, () => {
  const impl: Xxx.Interface = {/*...*/}
  return impl
})

// Layer.effect 可以在 Effect.gen 中使用 yield* 来处理异步操作
export const XxxLive = Layer.effect(Xxx, Effect.gen(function*() {
  const impl: Xxx.Interface = {/*...*/ }
  return impl
}))

```



## 调用方式

```typescript
// 导入 Tag（值）— 同时提供 namespace 用于类型访问
import { Xxx } from "@aura/contract"

// 类型位置使用 Interface
function foo(engine: Xxx.Interface): void { }

// 值位置使用 Tag
Effect.service(Xxx)
Layer.succeed(Xxx, instance)
```

## 转换步骤

1. **合约文件**：`export type XxxImpl = { ... }` → `export namespace Xxx { export interface Interface { ... } }`，将实现中的 JSDoc 移入接口，Tag 泛型改为 `Xxx.Interface`
2. **实现文件**：添加 `implements Xxx.Interface`，移除已迁移的 JSDoc（保留 `SIMPLE IMPLEMENTATION` 等标记）
3. **所有消费者**：`import type { XxxImpl }` 改为直接使用 `Xxx.Interface`（Tag 导入已包含 namespace），删除重复的 type-only 导入
4. **测试文件**：mock 返回类型从 `XxxImpl` 改为 `Xxx.Interface`
5. **验证**：`bun run typecheck && bun run test`

## 反模式

- 不要在`contract`包中同时保留 `export type XxxImpl` 和 namespace — Interface 完全替代前者
- 注意`Xxx`的命名不要以 `Tag` 或 `Context` 为后缀 — 与类型推断重复
- 不要单独 `import type { Xxx }` — 值导入同时提供 namespace
- 不要在接口和实现两侧各写一份 JSDoc — 会漂移
- 不要用 `typeof Xxx` 取接口类型 — 直接用 `Xxx.Interface`
