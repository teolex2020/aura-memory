# Aura TypeScript Epistemic Layer Skeleton Design (Rust 1:1)

## 目标

在 `typescript/` workspaces 中，以 effect-smol 的 Context/Layer 分层方式，先补齐 Rust 侧核心认知链路的模块“骨架”与默认装配点，优先确保以下链路在 TypeScript 侧不存在模块缺失：

Record → Belief → Concept → Causal → Policy

本阶段强调：

- Rust 1:1 命名对齐：文件名、模块名、类型名、函数名尽可能与 Rust 保持对应关系
- 先补齐 Context/DefaultLayer 骨架：实现可编译、可装配、可加载/保存的最小闭环
- 在 Layer 与未实现的行为处使用 TODO 注释明确后续对齐点，避免目标漂移
- 不做不必要的抽象/优化，优先维持 Rust 结构的直译可对照性

## 非目标

- 不在本阶段实现算法细节的完整 parity（Belief/Concept/Causal/Policy 内部 scoring、gate、surface 过滤等）
- 不在本阶段重构现有 `storage/recall/core` 的结构
- 不引入额外运行时（HTTP server 等）

## Rust 对齐基准（文件与落盘）

Rust 侧模块与持久化文件名（位于 brain 目录根目录）：

- `belief.rs` → `beliefs.cog`（JSON snapshot）
- `concept.rs` → `concepts.cog`（JSON snapshot）
- `causal.rs` → `causal.cog`（JSON snapshot）
- `policy.rs` → `policies.cog`（JSON snapshot）
- `epistemic_runtime.rs`（只读查询门面，不直接落盘）

TypeScript 侧需要使用相同文件名，保持与 Rust 数据互通。

## TypeScript 包结构（新增）

新增 packages（与 Rust module 对齐）：

- `@aura/belief`
- `@aura/concept`
- `@aura/causal`
- `@aura/policy`
- `@aura/epistemic-runtime`

新增包不改变现有包职责，但要求：

- 仅依赖 `@aura/contract` 与纯逻辑依赖
- 不允许 `import node:*`

## Contract：Context Tags（新增）

在 `@aura/contract` 新增以下 Tags（命名与 Rust 类型对齐）：

- `BeliefEngine`
- `BeliefStore`
- `ConceptEngine`
- `ConceptStore`
- `CausalEngine`
- `CausalStore`
- `PolicyEngine`
- `PolicyStore`
- `EpistemicRuntime`

Tag 命名规则：

- Tag 类名与 Rust struct 对齐（例如 Rust `CausalEngine` → TS `class CausalEngine extends Tag(...)`）
- 实现类型使用 `*Impl`（例如 `CausalEngineImpl`）
- 方法名使用 Rust snake_case 的等价 camelCase 或保留 snake_case（优先保留 Rust 词根，确保可一眼对应）

## Storage 约束（持久化接口）

Rust store 的 IO 行为由 std::fs 实现；TS 侧必须通过 `FileRead/FileWrite` 注入：

- `load(): Effect<Engine>`
- `save(engine): Effect<void>`

并使用 Rust 同名文件（`beliefs.cog` 等）读写 JSON（UTF-8）。

## DefaultLayer 组装（新增）

在 `@aura/core` 增加“默认装配层”入口（名称待实现阶段确定），核心原则：

- 复用现有 `RecallViewLive(dir)`，不重写
- 将 `BeliefStoreLive/BeliefEngineLive` 等 Layer 与现有 Layer merge，形成一个可作为基础运行环境的组合 Layer
- 该组合 Layer 只依赖 `@aura/contract` 的通用服务（`FileRead/FileWrite/Clock/Crypto` 等），平台实现由 `@aura/platform-node` 提供

## 最小可运行链路（本阶段验收口径）

本阶段“链路不缺失”的验收口径为：

1. `bun run typecheck` 通过
2. 新增包均可被导入并提供对应 Tag 与 Live Layer
3. 对任意 `brainDir`：
   - `BeliefStore.load` 等在文件缺失时有与 Rust 一致的 fallback（返回空 engine）
   - `save` 可写入对应 `*.cog` 文件
4. `EpistemicRuntime` 可以从引擎状态提供只读查询方法的占位实现（方法签名与 Rust 对齐，内部可 TODO）

## TODO 注释规范

仅在以下位置写 TODO（用于避免目标漂移）：

- `*Live(dir)` 的 Layer 装配处：说明“当前骨架提供了什么 / 还缺什么 / Rust 对照位置”
- `*Impl` 的关键方法体内：当实现尚未对齐 Rust 行为时，标注 TODO 与 Rust 文件/函数名

## 后续扩展方向（不在本 spec 内实现）

- 将 `@aura/recall` 的 TODO（belief/concept/causal/policy）逐步变为可选 service 注入点，并最终对齐 Rust `recall_service` 的 rerank 策略
- 引入 `MaintenanceService`（对齐 Rust `maintenance_service.rs`）完成周期性构建/更新引擎与落盘

