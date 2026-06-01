# 编码规范

**分析日期:** 2026-06-01

## 命名模式

**文件:**
- PascalCase 用于组件/服务/引擎文件 (如 `BeliefEngine.ts`, `BrainAuraFile.ts`, `InvertedIndex.ts`)
- camelCase 用于纯函数工具文件 (如 `cognitive.ts`, `versioning.ts`, `Recoil.ts`)
- `index.ts` 用于 barrel export
- 测试文件使用与源文件相同的名称 + `.test.ts` 后缀 (如 `Binary.ts` -> `Binary.test.ts`)
- 特定区域的中文测试使用 `.zh.test.ts` 后缀 (如 `BeliefEngine.zh.test.ts`)

**函数:**
- 导出函数使用 camelCase (`computeEffectiveTrust`, `surfaceConcepts`, `decodeCognitiveLog`, `crc32`)
- 私有/模块内部函数使用 camelCase (`need`, `push`, `decodeFixedString`)
- 工厂函数使用 PascalCase 风格但以首字母小写开头 (`defaultTrustConfig`, `makeState`, `makeRecord`)
- generator 兼容的 Effect 函数使用 `function* ()` 语法

**变量:**
- 所有变量使用 camelCase
- 模块级常量使用 UPPER_SNAKE_CASE (`LAMBDA = 0.35`, `MAX_PARTITION_SIZE = 80`, `CONCEPT_SIMILARITY_THRESHOLD = 0.1`)
- 导出常量根据语境使用 PascalCase 或 UPPER_SNAKE_CASE (`export const CORE_TERM_THRESHOLD = 0.7`, `export const SDR_TANIMOTO_THRESHOLD = 0.15`)
- 类型层面的常量（用作默认值）使用 PascalCase (`DEFAULT_NAMESPACE = "default"`, `DEFAULT_SOURCE_TYPE = "recorded"`)

**类型:**
- 类型和接口使用 PascalCase (`type Record`, `type Scored`, `type RecallView`)
- 类型参数使用简写 (`A`, `E`, `R` 用于 Effect 类型参数) (`Effect.Effect<A, E, R>`)
- ReadonlyArray 和 readonly 修饰符广泛用于不可变类型 (`type AuraRecord` 中的字段)
- 使用 `type` 为主，`interface` 为辅，且 interface 仅在有 `implement` 场景时使用

**枚举:**
- 枚举值使用 PascalCase 字符串值 (`Level.Working = "Working"`, `BeliefState.Resolved = "Resolved"`)
- 枚举作为类型的一部分与 Rust 对齐 (见 `packages/contract/src/levels/Level.ts`, `packages/contract/src/Enums.ts`)

## 代码风格

**格式化:**
- 未使用 Prettier (无 `.prettierrc` 配置文件)
- 未使用 ESLint 或 Biome (无 `.eslintrc*` 或 `biome.json` 配置文件)
- TypeScript 编译器 (`tsc`) 类型检查通过 `tsc -p tsconfig.json --noEmit` 执行
- 字符串引号: 双引号 `"` (非单引号)
- 分号: 使用分号结尾 (`;`)
- 缩进: 2 空格

**Linting:**
- 无独立 linter；仅依赖 TypeScript strict 模式检查：
  ```json
  {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
  ```
- `skipLibCheck: true` 跳过 `node_modules` 的类型检查

## 导入组织

**顺序:**
1. Node built-in 模块 (`"node:path"`, `"node:fs"`, `"node:os"`, `"node:crypto"`)
2. 第三方外部包 (`"vitest"`, `"effect"`, `"xxhash-wasm"`)
3. 内部 workspace 包 (`"@aura/contract"`, `"@aura/codec"`, `"@aura/utils"`)
4. 本地相对导入 (`"./Surface"`, `"./index"`, `"./Trust"`)

**路径别名:**
- `@aura/*` 映射到 `packages/<name>/src/index.ts`（在 `tsconfig.json` 和 `vitest.config.ts` 中均配置）
- vitest 配置中的 alias 指向每个包的 `index.ts` 入口
- tsconfig 支持 `@aura/codec/*` -> `packages/codec/src/*` 通配符模式

**导入风格:**
- 类型导入使用 `import type { ... }` 语法
- 值+类型混合导入合并为一条语句（如 `import { Effect, Layer, Option } from "effect"`）
- 使用 `* as` 导入命名空间（如 `import * as path from "node:path"`）
- Effect 的效果类型显式导入（如 `Effect.Effect<void, FileReadError>`）

## 导出模式

**Barrel 文件:**
- 每个包的 `src/index.ts` 使用 `export * from "./ModuleName"` 重新导出所有公共符号
- 示例 (`packages/codec/src/index.ts`):
  ```typescript
  export * from "./Binary"
  export * from "./Bincode"
  export * from "./Crypto"
  ```

**模块导出:**
- 函数导出：直接 `export function` 或 `export const fn = () => {}`
- 类导出：`export class ClassName {}`
- 类型导出：`export type TypeName = ...`
- 具名导出为主，无默认导出 (`export default` 未使用)

## 错误处理

**模式:**
- 全项目使用 Effect-TS `Data.TaggedError` 模式定义域错误：
  ```typescript
  import { Data } from "effect"
  export class FileReadError extends Data.TaggedError("FileReadError")<{
    readonly path: string
    readonly cause: unknown
  }> {}
  ```
- 每个错误类携带 `readonly` 字段定义，字段名使用 camelCase
- 域错误集中在 `packages/contract/src/Errors.ts`（核心错误）和各包的 `Errors.ts` 中
- Effect 管道中通过 `Effect.mapError()` 将 throw 转换为 TypeErrors：
  ```typescript
  Effect.tryPromise(() => fs.readFile(p)).pipe(
    Effect.mapError((cause) => new FileReadError({ path: p, cause }))
  )
  ```
- 低层工具函数（如 `BinaryReader`）在数据格式错误时 throw `Error`（不会进入 Effect 管道）
- `UnsupportedSurfaceError` 用于计划中但尚未实现的 MCP 工具面

## 日志记录

**框架:** 未使用专用日志框架；使用 `console` 和 Effect 内联（仅限必要场景）

**模式:**
- 无全局日志配置或日志级别
- 中文跨平台项目使用带有中英文双语的注释来描述日志内容

## 注释

**何时注释:**
- 每个引擎模块有顶部注释描述其职责（中英文双语）：
  ```typescript
  /**
   * The belief engine — maintains the full belief state.
   *
   * Belief 引擎——维护完整的信念层状态（Belief/Hypothesis/索引），用于在 maintenance 周期中从 records
   * 构建更稳定的"主张层"。
   */
  ```
- 常量有简短释义注释
- 算法/algo 注释包含 Rust 交叉引用路径（`Rust: CLAIM_SIMILARITY_THRESHOLD = 0.15 (belief.rs:53)`）
- 测试函数注释使用中文描述场景（如 `"中文用例：SDR子簇分桶后每个子簇产生独立Belief，记录映射稳定"`）
- 非公有函数通常无 JSDoc（内联注释为主）

**JSDoc/TSDoc:**
- 仅在导出函数/类时使用 JSDoc，且包含 Rust cross-reference 注释
- 格式：`/**` 块，内容含中英文双语说明
- 复杂公式/算法在 JSDoc 中附公式文字说明

## 函数设计

**大小:**
- 引擎类方法通常较大（100-300 行），因为包含复杂业务逻辑
- 纯函数工具函数保持简短（5-50 行）
- 测试辅助函数较短（10-30 行）

**参数:**
- 复杂配置使用对象参数（使用 `Partial<>` 支持可选覆盖）
- 简单函数使用位置参数
- 参数尽可能使用 `Readonly` 或 `readonly` 修饰符

**返回值:**
- Effect 返回统一使用 `Effect.Effect<A, E, R>` 泛型签名
- 同步操作直接返回值类型
- 数组/集合返回使用 `ReadonlyArray` 或 `ReadonlyMap` 作为只读类型
- `void` 返回用于不需要返回值的 Effect

## 模块设计

**Barrel 文件:**
- 每个包的 `src/index.ts` 使用 `export * from "./ModuleName"` 模式
- 无选择性导出，全部导出通过单一 barrel 文件暴露

**模块边界:**
- `@aura/contract` 是所有跨包依赖的唯一桥梁（类型定义、Tag 服务定义、错误定义）
- 其他包（如 `@aura/recall`、`@aura/belief`）实现 `@aura/contract` 中定义的服务接口
- 依赖方向：`core -> contract`、`belief -> contract`、`storage -> contract + codec + utils`

## 类设计

**模式:**
- 引擎类实现 contract 中定义的 Interface（`implements BeliefEngine.Interface`）
- 构造函数通常为 `private constructor()` + `static` 工厂方法（如 `BrainAuraFile.open()`）
- 使用 `private readonly` 字段存储依赖和状态
- 部分类（如 `BinaryReader`、`BinaryWriter`）使用纯 Class 模式，不依赖 Effect
- Layer 声明通常放在模块末尾：`export const EngineLive = Layer.succeed(Engine, new EngineImpl())`

## 数据不可变性

- 类型定义中广泛使用 `readonly` 修饰符
- 使用 `ReadonlyArray<T>` 而非 `T[]` 表示函数参数
- 使用 `ReadonlyMap<K, V>` 和 `Readonly<Record<K, V>>`
- 可变状态仅在 Engine 类的 `private` 字段中使用

---

*约定分析日期: 2026-06-01*
