# TypeScript 维护流程（Belief → Concept → Causal → Policy）端到端对齐设计

## 背景

当前 TypeScript 侧的 `BeliefEngine / ConceptEngine / CausalEngine / PolicyEngine` 以及 `EpistemicRuntime` 仍为骨架；四个 `*.cog`（`beliefs.cog / concepts.cog / causal.cog / policies.cog`）已具备 JSON snapshot 读写能力，但 `engine` schema 仍为 `unknown`，且主写入路径（`Aura.store/update/delete/connect`）尚未触发维护流程，因此 TS 侧无法跑通 “构建/维护 → 落盘 → 召回侧使用（bounded rerank）” 的完整链路。

本设计的目标是在 TS 侧实现与 Rust 高度一致的构建/维护流程，并让 `Belief → Concept → Causal → Policy` 全流程端到端跑通（包含持久化与召回侧接入），同时按模块提供与 Rust 对齐的测试，以便持续发现偏差。

## 目标

- 在 `@aura/core` 增加 `MaintenanceService`：
  - 负责从 `brainDir` 加载 records（以 `brain.cog/brain.snap` 回放为准），计算并维护 beliefs/concepts/causal/policies。
  - 负责把四层 engine state 落盘到对应 `*.cog` JSON snapshot。
  - 支持 trace（简易实现：用 `Effect.log` 输出关键阶段与计数）。
- 实现 TS 版四大引擎核心算法，尽量 1:1 对齐 Rust 的行为、参数与状态机：
  - Belief：coarse key 分桶 → SDR 子聚类（union-find + threshold）→ hypotheses（supporting/opposing）→ resolve（winner/resolved/unresolved/singleton）。
  - Concept：以 belief seeds 构建 centroid/token sets → partition + similarity 聚类 → abstraction_score → state（Stable/Candidate/Rejected）。
  - Causal：record-level edge 提取（explicit + temporal）→ 聚合到 belief-level patterns → score + gates（支持度/重复窗口/反事实门控等）→ fingerprint 跳过重建。
  - Policy：从 causal patterns seeds（要求 lower-layer provenance 稳定）→ polarity → action mapping → hints → suppression 冲突处理 → state classify。
- 召回侧接入：
  - 实现 `BoundedRerankerLive`，按 Rust 逻辑提供 belief/concept/causal/policy 四阶段 bounded rerank（含 guardrails：score cap、pos shift cap、top_k、coverage 等）。
  - `recallPipeline` 已按可选依赖注入读取 `BoundedReranker`，因此 DefaultLayer 需要提供该 live 实现。
- 自动维护触发：
  - 在 `Aura.store/update/delete/connect` 完成写入与 flush 后自动触发维护（无定时维护）。
  - 允许通过配置关闭自动维护（默认开启），以便在批量写入或性能敏感场景手动控制。
- 每个算法模块提供与 Rust 高度一致的测试文件：
  - 测试顺序优先选择“不依赖其它模块”的模块先完成。
  - 对高度依赖下游模块的测试可延后，但必须在端到端用例中覆盖。

## 非目标

- 不在本轮把 TS 的 NGramIndex/LSH、brain.aura 的增量写入、index/ 的增量构建做到与 Rust 完全一致（可在后续 parity 任务推进）。
- 不引入数据库或新持久化格式；维持现有 `*.cog` JSON snapshot 策略。

## 总体架构

### 数据流（写入触发）

1. `Aura.store/update/delete/connect` 追加写入 `brain.cog` 并 `flush()`
2. 调用 `MaintenanceService.runAfterWrite()`（可配置开关）
3. `MaintenanceService`：
   - `CognitiveStoreFile.open(brainDir).loadAll()` 取得 records（快照 + log 回放）
   - 调用四层 engine 的 `discover/update`（按 Rust 依赖顺序）
   - 调用各自 store 落盘：`beliefs.cog / concepts.cog / causal.cog / policies.cog`

### 数据流（召回使用）

1. `RecallView` 仍负责 records + inverted index + aura headers（现状）
2. `BoundedRerankerLive` 在 rerank 时：
   - 从 stores 读取（或从 EpistemicRuntime 缓存读取）当前 engine state
   - 计算 membership / provenance 映射（record↔belief↔concept↔causal↔policy）
   - 按 Rust guardrails 对 scored 列表做 bounded 调整

## 组件设计

### 1) MaintenanceService（新增，位于 @aura/core）

**接口建议**

- `MaintenanceService` 作为 `Context.Tag` 暴露，以便在 `Aura` 与测试中注入/替换：
  - `runFull(options?: { trace?: boolean }): Effect<MaintenanceResult, MaintenanceError, ...>`
  - `runAfterWrite(options?: { trace?: boolean }): Effect<void, MaintenanceError, ...>`
  - `loadOrEmptyStates(): Effect<...>`（用于冷启动时从 `*.cog` 加载 states）

**职责**

- 读取 records：以 `CognitiveStoreFile.loadAll()` 为准，确保与 Rust “log+snap 回放后维护” 的模型一致。
- 计算四层 states 并落盘：
  - beliefs/concepts/causal/policies 的 schema 固化为明确类型（不再用 `unknown`）。
  - 使用现有 `CogJsonSnapshotFile` 读写，保持与 Rust serde_json 快照的“覆盖写 + fsync”语义。
- 提供 trace：
  - `trace=true` 时在阶段边界输出 `Effect.log`，包含输入记录数、输出项计数、跳过重建（fingerprint hit）等。

**自动触发策略**

- `Aura` 默认开启：每次 store/update/delete/connect 完成写入后调用 `MaintenanceService.runAfterWrite({ trace: false })`。
- 配置入口：
  - `Aura.open` 接受可选参数（例如 `maintenance?: { auto?: boolean; trace?: boolean }`）。
  - 默认 `auto: true`，trace 默认 false。

### 2) 四大 Engine（完善实现，保持包名与 Rust 对齐）

现状：四大 engine 都是 `UnimplementedError` 骨架。

目标：实现与 Rust 高度一致的核心算法与状态结构，并把“配置项/阈值/模式”尽量暴露为结构化参数（以便测试与 parity 调参）。

#### BeliefEngine

- 输入：records（含 tags/namespace/semantic_type 等）、SDR interpreter（与现有 recall 包的 SDRInterpreter 协作或抽出共用层）。
- 输出：BeliefEngineState（包含 beliefs 列表、coarse grouping 统计、record↔belief provenance、可能的矛盾关系等）。
- 算法：coarse key → union-find → hypotheses → resolve（对齐 Rust）。

#### ConceptEngine

- 输入：BeliefEngineState（或 belief seeds + provenance）
- 输出：ConceptEngineState（concepts + membership + state）
- 算法：centroid/token sets → partition + similarity clustering → abstraction_score → state classify（对齐 Rust）。

#### CausalEngine

- 输入：records + BeliefEngineState（用于 belief-level pattern 聚合）
- 输出：CausalEngineState（patterns + evidence + fingerprint）
- 算法：edge extract → aggregate → score/gates → fingerprint skip（对齐 Rust）。

#### PolicyEngine

- 输入：CausalEngineState（含 provenance）
- 输出：PolicyEngineState（policy hints + suppression + state）
- 算法：seed patterns → polarity/action mapping → hints → suppression → state classify（对齐 Rust）。

### 3) EpistemicRuntime（完善实现）

现状：`EpistemicRuntimeImpl.get_*` 全为 `UnimplementedError`。

目标：提供“读取当前 states（prefer 内存缓存，fallback 文件加载）”的运行时接口，供：

- `BoundedRerankerLive` 获取 states
- `Aura` 后续 `explain_*`、graph digest 等接口落地时复用

建议策略：

- 以 `Ref`/`SynchronizedRef`（effect 提供）缓存 states（避免每次 rerank 都读文件）
- `MaintenanceService` 更新时同步刷新 runtime 的缓存

### 4) BoundedRerankerLive（完善实现，接入 recallPipeline）

现状：`recallPipeline` 已支持可选 `BoundedReranker`，但缺少 live 实现。

目标：提供与 Rust 一致的四阶段 bounded rerank：

- `apply_belief_rerank`
- `apply_concept_rerank`
- `apply_causal_rerank`
- `apply_policy_rerank`

包含 guardrails：

- score cap（每阶段分数增量上限）
- positional shift cap（名次最大前移）
- top_k 限制（只对前 N 项作用）
- coverage 条件（确保不是单簇/单模式“刷屏”）

## 合约与持久化 schema

### contract 新增/完善的类型（建议按子目录组织）

为避免 `unknown`，需要在 `@aura/contract` 中定义并导出：

- `belief/`：
  - `BeliefId`、`Belief`、`BeliefState`、`BeliefEngineState`、`CoarseKey`、`Hypothesis`、`BeliefConfig` 等
- `concept/`：
  - `ConceptId`、`Concept`、`ConceptState`、`ConceptEngineState`、`ConceptConfig`
- `causal/`：
  - `CausalPatternId`、`CausalPattern`、`Evidence`、`CausalEngineState`、`CausalConfig`、`CorpusFingerprint`
- `policy/`：
  - `PolicyHintId`、`PolicyHint`、`PolicyEngineState`、`PolicyConfig`

并将四个 Store 的 `engine` 类型从 `unknown` 替换为对应的 `*EngineState`。

### `*.cog` 文件内容

继续使用 JSON snapshot：

- `beliefs.cog`：`BeliefEngineState`
- `concepts.cog`：`ConceptEngineState`
- `causal.cog`：`CausalEngineState`（含 fingerprint）
- `policies.cog`：`PolicyEngineState`

版本策略：

- state 顶层对象带 `version` 字段（数字或字符串），用于未来迁移；初版以 `1` 起步。
- `PersistenceManifest` 可记录这些文件的存在与版本（如需），但不强制阻塞 `Aura.open()`。

## Trace 设计（简易日志）

- 以 `Effect.log` 为主，不引入复杂 trace 系统。
- 在以下阶段输出结构化文本（JSON 风格字符串即可）：
  - maintenance start/end、records count
  - belief discover：group count / belief count / resolved/unresolved count
  - concept discover：concept count、stable/candidate/rejected
  - causal discover：pattern count、fingerprint hit/miss
  - policy discover：hint count、suppressed count、stable/candidate/rejected
  - rerank：每阶段生效数量、平均提升、命中 coverage

## 测试策略（与 Rust 高度一致）

原则：

- 每个算法模块都要有独立测试文件，尽量复刻 Rust 侧的测试用例（输入与断言逻辑保持一致）。
- 开发顺序优先“不依赖其它模块”的部分：
  1. BeliefEngine 单测（可用最小 records + SDR fixtures）
  2. ConceptEngine 单测（可用手工构造的 BeliefEngineState fixture）
  3. CausalEngine 单测（records + BeliefEngineState fixture）
  4. PolicyEngine 单测（CausalEngineState fixture）
  5. BoundedReranker 单测（使用固定 scored list + states fixtures）
  6. MaintenanceService 端到端测试（从写入 records → 自动维护 → 落盘 → rerank 生效）

具体落地方式：

- 在各 package 的 `src/*.test.ts` 中新增与 Rust 命名对应的测试文件（例如 `BeliefEngine.test.ts`）。
- 引入集中 fixtures：`/workspace/typescript/test/fixtures/epistemic_*`（沿用现有 `test/fixtures/*` 约定，测试里通过 `path.join(process.cwd(), "test/fixtures/...")` 读取）：
  - `records.json`：最小记录集
  - `expected_beliefs.json / expected_concepts.json / expected_causal.json / expected_policies.json`
- “高度一致”的含义：
  - 对可稳定确定的结构，做 deepEqual
  - 对存在浮点/排序不稳定的部分，做容差断言或排序归一（与 Rust 侧测试策略一致）

## 兼容性与迁移

- 旧的 `beliefs.cog` 等文件若为空或不存在，按 `empty_engine()` 初始化为 version=1 的空 state。
- 若发现未知 `version`，返回结构化错误（TaggedError），并在维护流程中明确 fail（避免 silent corruption）。

## 风险与缓解

- **算法细节 parity 风险**：通过“复刻 Rust 测试用例 + fixtures”尽早发现偏差。
- **性能风险（自动维护）**：提供 `auto` 开关；后续可加入 debounce / fingerprint skip；初期优先正确性与一致性。
- **数据依赖风险（SDR interpreter）**：优先复用现有 `recall/SDRInterpreter`；若 belief 侧需要不同配置，抽出共享包或 contract 接口（保持名字与 Rust 对齐）。
