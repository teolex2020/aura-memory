---
name: effect-ts
description: Effect-TS 通用 API 参考 — 组合子、错误处理、依赖注入、Stream、Schedule。项目特有约定见 effect-project-pattern。
---

# Effect-TS 通用 API 参考

Effect-TS 是 TypeScript 的函数式编程库。核心类型 `Effect<Success, Error, Requirements>` 表示可组合的惰性计算。

> **关联技能：**
> - `effect-project-pattern` — 本项目特有编码规范（合约接口、Layer 构建、已知陷阱），优先级高于本 skill
> - `effect` — 本项目 Effect 编码基础规则（source of truth、代码搜索策略）
>
> 写本项目的 Effect 代码时，先用 `effect-project-pattern` 检查项目约定，本 skill 仅作通用 API 速查。

## 常用组合子

### 基本转换

```typescript
import { Effect } from "effect"

// map — 同步转换成功值
Effect.succeed(42).pipe(Effect.map(n => n * 2))

// flatMap — 链式调用
Effect.succeed(42).pipe(Effect.flatMap(n => Effect.succeed(n * 2)))

// as — 忽略原值，替换为新值
Effect.succeed(42).pipe(Effect.as("done"))
```

### 错误处理

```typescript
import { Effect } from "effect"

// catchAll — 捕获任意错误并恢复
Effect.fail("oops").pipe(Effect.catchAll(err => Effect.succeed(`recovered: ${err}`)))

// catchTag — 按标签捕获特定错误类型（需 Data.TaggedError）
Effect.fail(new MyError("fail")).pipe(Effect.catchTag("MyError", err => Effect.succeed("ok")))

// orElse — 失败时尝试备选
Effect.fail("err").pipe(Effect.orElse(() => Effect.succeed("fallback")))

// mapError — 转换错误类型
Effect.fail("raw").pipe(Effect.mapError(e => new DomainError(e)))

// retry — 失败重试
Effect.fail("temporary").pipe(Effect.retry({ times: 3, delay: () => Duration.millis(100) }))
```

### 组合

```typescript
import { Effect } from "effect"

// all — 并行合并
Effect.all([a, b]) // Effect<[A, B], never, never>
Effect.all({ x: a, y: b }) // Effect<{ x: A; y: B }, never, never>

// race — 竞速，取最先完成的
Effect.race(a, Effect.delay(b, "1 seconds"))

// timeout — 超时
a.pipe(Effect.timeout("5 seconds"))
a.pipe(Effect.timeoutOption("5 seconds")) // 返回 Option
```

### 条件与循环

```typescript
import { Effect } from "effect"

// when — 条件执行
Effect.succeed(42).pipe(Effect.when(() => true))

// loop — 循环直到条件满足
Effect.loop(0, { while: n => n < 10, step: n => n + 1, body: n => Effect.log(n) })

// repeat — 重复 N 次
Effect.succeed("ping").pipe(Effect.repeatN(5))
```

## 错误模型

### 可恢复错误 vs 缺陷

```typescript
import { Effect, Data } from "effect"

// fail — 可预期的业务错误（在 E 通道，类型安全）
Effect.fail(new ValidationError("invalid"))

// die — 不可恢复的缺陷（不追踪类型）
Effect.die(new Error("unexpected bug"))

// orDie — 将 E 通道错误转为缺陷
Effect.fail("oops").pipe(Effect.orDie)

// TaggedError 模式
class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entityId: string
}> {}

// 精确捕获
effect.pipe(
  Effect.catchTag("NotFoundError", err => Effect.succeed(`missing: ${err.entityId}`)),
  Effect.catchTag("ValidationError", err => Effect.succeed(`bad: ${err.message}`))
)
```

### Either 与 Option

```typescript
import { Effect, Either, Option } from "effect"

Effect.either(Effect.fail("err")) // Effect<Either<string, never>>
Effect.option(Effect.fail("err")) // Effect<Option<string>>
Effect.fail("err").pipe(Effect.ignore) // Effect<void>
```

## 依赖注入

### Tag + Layer

```typescript
import { Effect, Context, Layer, Tag } from "effect"

// 1. 定义服务接口
class Database extends Tag("app/Database")<Database, {
  readonly query: (sql: string) => Effect.Effect<unknown, DbError>
}>() {}

// 2. Layer.succeed — 同步构建
const DatabaseLive = Layer.succeed(Database, Database.of({
  query: (sql) => Effect.succeed([])
}))

// 3. 消费
const program = Database.pipe(Effect.flatMap(db => db.query("SELECT 1")))

// 4. 注入
program.pipe(Effect.provide(DatabaseLive))
```

### Layer 组合

```typescript
// 合并多个 Layer
const MainLayer = Layer.mergeAll(DatabaseLive, LoggerLive)

// Layer.effect — 需要 Effect 初始化
const ServiceLive = Layer.effect(ServiceA, Effect.gen(function* () {
  const dep = yield* Ref.make(0)
  return { /* ... */ }
})).pipe(Layer.provide(DatabaseLive))
```

### 资源生命周期 (Scope)

```typescript
import { Effect } from "effect"

const withFile = Effect.acquireRelease(
  Effect.sync(() => fs.open("file.txt")),           // acquire
  (file) => Effect.sync(() => fs.close(file))       // release
)

Effect.scoped(withFile.pipe(Effect.flatMap(file => /* use file */)))
```

## Stream

```typescript
import { Stream } from "effect"

// 创建
Stream.fromIterable([1, 2, 3])
Stream.range(0, 100)

// 转换
Stream.range(0, 10).pipe(
  Stream.map(n => n * 2),
  Stream.filter(n => n > 10),
  Stream.take(5)
)

// 消费
Stream.range(0, 10).pipe(Stream.runCollect) // Effect<Chunk<number>>
Stream.range(0, 10).pipe(Stream.runForEach(n => Effect.log(n)))
```

## Schedule（重试策略）

```typescript
import { Effect, Schedule } from "effect"

// 固定次数 + 延迟
Schedule.recursively(3).pipe(Schedule.addDelay(() => Duration.millis(100)))

// 指数退避
Schedule.exponential("100 millis", 2.0).pipe(Schedule.recursively(5))

// 带抖动
Schedule.exponential("100 millis").pipe(Schedule.jittered())

// 应用
effect.pipe(Effect.retry(policy))
```

## Fiber（协程）

```typescript
import { Effect, Fiber } from "effect"

const fib = Effect.succeed(42).pipe(Effect.fork)
fib.pipe(Effect.flatMap(f => Fiber.join(f))) // 等待完成

Effect.forkAll([a, b, c]).pipe(Effect.flatMap(fibers => Fiber.joinAll(fibers)))
```

## 同步/异步桥接

```typescript
import { Effect } from "effect"

Effect.sync(() => JSON.parse(str))                    // 同步，异常转缺陷
Effect.try(() => JSON.parse(str))                     // 同步，异常转 Either
Effect.promise(() => fetch(url))                      // Promise，不可中断
Effect.tryPromise(() => fetch(url).then(r => r.json())) // Promise，异常转 Either
```

## 计时与日志

```typescript
import { Effect, Duration } from "effect"

Effect.sleep("1 seconds")
Effect.sleep(Duration.millis(500))
effect.pipe(Effect.timeout("10 seconds"))

Effect.log("info message")
Effect.logError("error message")
```
