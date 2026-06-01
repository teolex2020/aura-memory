# Agents.md（TypeScript 端工程说明）

本文档用于给后续的实现者/子代理提供“上下文基线”，并把本项目的硬性要求、注释规范、验证策略按优先级固化下来，减少偏离与返工。

---

## 1. 最高优先级原则（按顺序执行）

1) 对齐 Rust 行为与持久化格式：优先确保磁盘格式互通（必要时字节级一致），其次对齐算法语义与输出。
2) 可验证性优先：任何改动必须可通过仓库根目录下的 `bun run typecheck` 与相关测试；不允许“只凭肉眼”对齐。
3) 不确定性先消除：Rust reference 若含随机性/非确定性，优先让 verifier/fixture 可复现，再做 TS 对齐。
4) 依赖注入与分层边界必须守住：core/storage/codec/indexing/recall 禁止直接依赖 `node:*`。
5) 注释与差异必须显式：保留 Rust 同位置注释并翻译为中文；差异要能全局搜索定位。同样的结构/类型/方法/函数名称如果在ts端进行了重命名（含大小写），则必须在注视中说明并保留原始命名。
6) Effect 代码遵循项目规范：写 Effect-TS 代码时自动应用 `effect-project-pattern` skill（合约接口、Layer 构建、错误处理、已知陷阱），通用 API 回退到 `effect-ts`，源码验证回退到 `effect`。

---

## 2. 项目级硬性要求（必须遵守）

### 2.1 目标范围

- 目标：在 `typescript/` 下实现 Rust 核心的 1:1 TypeScript 重写（学习/研究用途），运行时为 Bun。
- 范围：core + MCP（不做 HTTP server）。
- 兼容级别：磁盘格式兼容（TS 与 Rust 生成/读取的数据必须互通，必要时字节级一致）。

### 2.2 effect-smol 分层约束

- 分层：effect-smol 风格的 Context/Layer 依赖注入。
- core/storage/codec/indexing/recall 层不得直接 `import node:*`。
- 平台 IO 必须通过 `@aura/contract` 的服务接口注入，再由 `@aura/platform-node` 提供 Live 实现。

### 2.3 contract 与类型约束

- 必须有 `@aura/contract` 包，并对外导出 Context Tags。
- 文件系统服务必须拆分为：
  - `FileRead`：只读能力
  - `FileWrite`：写入能力（包含原子写所需的 rename/fsync 等）
- Rust enum 映射策略：本项目中 Rust 的枚举在 TS 侧统一用 TypeScript `enum`（string enum）表达，而非 string union type：
  - 目的：提供运行期值对象（如 `Level.Working`），便于跨包引用与测试断言。
  - 要求：枚举值必须与 Rust 侧字符串表示一致；发现不一致应以 Rust 为准修正（例如 `Level`）。
  - 校验：解析/归一化外部输入时，需先用 `Object.values(Enum).includes(x)` 验证再 cast，避免把任意字符串塞进 enum（示例见 `core/Aura.toRecordLike`）。
  - 测试：`packages/contract/src/Enums.test.ts` 断言枚举具备运行期值并与字符串一致。
- 错误通道必须可枚举且具体：
  - 不要在入参/返回值以及 `Effect.Effect<_, E, _>` 的 `E` 使用 `unknown/any`（除非确实就是 unknown）。
  - 正常错误使用 `Effect.fail(new Err)`，并采用 TaggedError 风格（现有 codebase 使用 `Data.TaggedError`）。
  - `UnimplementedError` 作为 defect：在非主流程占位时允许 `Effect.die(new UnimplementedError(...))`，避免污染正常 `E`；主写入/召回链路不要用 Unimplemented，优先提供可跑通的简单值/no-op。

### 2.4 注释规范（工程化 + Rust 对齐）

本项目允许且鼓励注释，但必须满足以下规范：

- Rust 注释对齐优先：在 TS 中尽量保留 Rust 同样位置的注释，并翻译为中文（必要时保留英文原句以便检索）。
- LSP 可提取：变量声明/函数/方法/类型注释使用块级 JSDoc：
  - `/** ... */`
- 差异与待办必须可全局搜索：保留英文头部前缀，后面用中文描述：
  - `SIMPLE IMPLEMENTATION:` 简化实现点 + 原因 + Rust reference
  - `NON-PARITY IMPLEMENTATION:` 非对齐点 + 原因 + Rust reference
  - `UNIMPLEMENTED:` 未实现点 + 原因 + Rust reference
  - `TODO:` 待办事项（必要时与 `NON-PARITY IMPLEMENTATION:` 组合）

### 2.5 代码组织与“不要新建包”约束

- 不允许跨包相对引用（应通过 `@aura/*` alias）。
- enum/type/record/struct/简单校验等集中放在 `packages/contract`（通过子目录区分模块/用途）与 `packages/utils`，不新建额外包。
- `.cog` JSON snapshot 的解析/写入应统一复用公共 helper（避免每个 store file 重复实现）。

### 2.6 测试策略（Rust parity 优先）

- 测试框架：vitest + @effect/vitest（在 `typescript/` 根目录通过 `bun run test` 执行）。
- 单测/定向回归优先直接传文件路径，例如：`bun run test packages/core/src/Aura.test.ts`。
- 不要依赖 `bun run test --filter ...`；当前仓库实际工作流以文件路径选择测试目标。
- 每个算法模块都应有与 Rust 高度一致的测试文件（优先不依赖其它模块者先写）。
- 跨语言对照：通过 `spawnSync("cargo", ["run", "--bin", ...])` 在测试中运行 Rust verifier/fixture。

---

## 3. workspace 结构（按职责分包）

`typescript/` 是一个 workspaces 仓库（见 `package.json`）。核心意图是把“纯逻辑”“二进制格式”“平台 IO”“门面编排”拆开，便于对齐 Rust 与测试。

- `packages/contract`
  - 只放“契约”：Effect Context/Tag 定义与领域类型。
  - 不放实现细节，不直接依赖 node:*。
- `packages/platform-node`
  - 平台实现层：Bun/Node 的文件系统、时钟、crypto 等 Live Layer。
  - 所有 node:* 仅允许出现在这里。
- `packages/utils`
  - 纯函数工具（bytes/hex/crc32 等），无 IO、无 Effect 依赖（或极少）。
  - 约定：秒级时间戳获取统一用 `nowSecs()`（`packages/utils/src/Time.ts`），避免散落 `Date.now() / 1000`。
- `packages/codec`
  - 二进制编解码与 crypto 原语（Binary/Bincode/Crypto）。
  - 目标是字节级对齐 Rust（磁盘格式互通）。
- `packages/storage`
  - 各类持久化文件的格式解析/写入（read-first）。
  - 以及为召回构建 read model（RecallView）。
- `packages/indexing`
  - SDR 倒排索引（manifest + sdr.idx）与 Roaring 序列化。
- `packages/recall`
  - 召回流水线算法（signals → RRF → graph/causal → trust/recency → optional rerank/finalize）。
  - 只依赖 `contract`（取 services）与纯逻辑模块；不做 IO。
- `packages/core`
  - 门面层（Aura.open / Aura.recall* 等），负责把 storage view + recall pipeline 串起来。
- `packages/belief` / `packages/concept` / `packages/causal` / `packages/policy`
  - 四层维护引擎与各自 store 的读写/发现逻辑。
- `packages/epistemic-runtime`
  - inspection / trace 运行时，只读聚合各层状态，不承载写侧维护编排。
- `packages/mcp`
  - Mastra-based MCP stdio server；transport 保持 thin，业务组合继续落在 `@aura/core`。
- `packages/code-extraction`
  - 独立代码分析/知识图谱实验包；不属于 Aura core + MCP 主链路。

---

## 4. 关键决策记录（避免静默偏离）

### 4.1 典型例子：NGram 随机性导致 parity 不稳定

Rust 的 `NGramIndex::new` 会生成随机 hash 函数系数，导致同样数据每次 query 的候选排序可能不同，从而 TS 无法稳定对齐。处理方式：

- 先明确“难点属于不确定性，而非 TS 写错”。
- 为 parity/verifier 引入可确定构造：新增 `NGramIndex::with_seed(...)` 供 verifier 用固定 seed 构造，保证 Rust 输出稳定，再进行 TS 对齐。

这一类改动属于“为了验证对齐而让 reference 稳定”，并且不改变 Rust 主流程默认行为。

### 4.2 典型例子：可选服务（Context 注入）导致的行为分叉

embedding/rerank/finalize 可作为可选 Context 提供：若不提供则不执行。处理方式：

- TS 的 `recallPipeline` 使用 `serviceOption(Tag)` 获取可选服务。
- 缺失时不报错、直接跳过该分支，但必须通过测试覆盖“缺失/提供”的两种路径。

---

## 5. 当前与 Rust 版本的不一致点（对齐清单）

本节以“后续对齐任务列表”的形式记录差异点。每一项都说明 Rust reference、TS 现状、影响与后续建议。

### 5.1 NGram 相似检索算法不一致（高影响）—— ✅ 已完成（核心算法）

- Rust reference
  - `NGramIndex`：MinHash + LSH（`../src/ngram.rs`）。
  - recall 使用：`collect_ngram`（`../src/recall.rs`）。
- TS 当前实现
  - `packages/indexing/src/NGramIndex.ts` 已实现 Rust 等价的 MinHash + LSH NGramIndex：
    - 文本规范化：lowercase + alphanumeric 保留 + whitespace join；
    - tokenization：UTF-8 byte trigram；
    - hash：`xxh3_64 & 0x7FFFFFFF` 的 0..3 byte 路径；
    - MinHash：使用 Rust `StdRng::seed_from_u64(0)` 生成的 128 组系数；
    - query/jaccard/remove/contains/find_similar_pairs 语义投影。
  - `packages/storage/src/RecallView.ts` 与 `packages/core/src/MaintenanceService.ts` 已改为复用该实现，不再使用 trigram Jaccard shim。
  - Rust verifier：`../src/bin/aura-ts-verify-ngram.rs`；TS 测试：`packages/indexing/src/NGramIndex.test.ts`。
- 影响（核心召回差异已消除）
  - `collect_ngram` 参与 RRF 的候选集合与相似度已通过固定 seed verifier 对齐。
- 剩余 caveat
  - Rust 的 `SynonymRing` 扩展尚未在 TS 接入；`NGramIndex.random()` 使用 JS `Math.random`，生产随机系数不追求与 Rust `thread_rng` 字节级一致。对照测试统一使用固定 seed。

### 5.2 InvertedIndex 搜索语义不一致（高影响）—— ✅ 已完成

- Rust reference
  - `InvertedIndex::search(query_indices, top_k, min_overlap)` 有一套性能与剪枝策略（`../src/index.rs`）。
- TS 当前实现
  - `searchScored(bits, topK, minOverlap)`（`packages/indexing/src/InvertedIndex.ts`）已与 Rust 语义对齐：
    - max_bits 选择：top_k ≤ 10 → 128，≤ 50 → 256，else → 512
    - rarity sort：bitmaps 数量超过 max_bits 时按 bitmap 长度升序（最稀有的优先）
    - 只处理前 `min(bitmaps.length, max_bits)` 个 bitmaps
    - 结果截断到 `limit = min(top_k * 10, 500)` 后再 resolve external IDs
  - 并补充了 `InvertedIndex.searchScored.test.ts` 覆盖边界条件（含 rarity sort + max_bits 剪枝）。
- 影响（已消除）
  - 候选集合、topK 截断与 Rust 在大数据量下的差异已消除。

### 5.3 SDR collect_sdr 的细节差异（中-高影响）—— ✅ 已确认对齐

- Rust reference
  - `collect_sdr`：倒排候选 → aura_id→record_id 映射 → 取 header.sdr_indices → tanimoto（`../src/recall.rs`）。
- TS 当前实现
  - `collectSdr` 同样走 aura_id→record_id + header.sdr_indices + Tanimoto（`packages/recall/src/Signals.ts`）。
  - `InvertedIndex.searchScored` 已在候选阶段按 overlap 计数排序/截断；`collectSdr` 与 Rust 一样忽略返回的 `_overlap`，最终按 Tanimoto 排序。
  - 回归测试：`packages/recall/src/Signals.test.ts` 锁定“overlap 不覆盖最终 Tanimoto 排序”的 Rust 行为。
- 影响（已消除）
  - SDR 候选召回、aura_id 映射、header 取值、Tanimoto 打分与最终截断路径已对齐。

### 5.4 Trust/Recency 计算公式不一致（高影响，且隐蔽）—— ✅ 已完成

- Rust reference
  - `compute_effective_trust`（`../src/trust.rs`）：
    - recency_boost = max * (1 - age_days/half_life_days)，下限 0
    - effective = (trust + recency_boost) * authority * source_type_factor，clamp(0.05, 1.0)
- TS 当前实现
  - `computeEffectiveTrust`（`packages/recall/src/Trust.ts`）已改为线性衰减：
    - `recencyBoost = max * max(0, 1 - ageDays / halfLifeDays)`
    - 移除旧代码中多余的 `0.0001` 除零防护（JS 浮点除零行为与 Rust f32 一致，均自然回落到 0）
  - 补充了 `Trust.test.ts`（10 个测试），覆盖边界条件：age=0、age=halfLife、age>halfLife、timestamp 缺失/不可解析回退 14 天、source_type factor、clamp、默认值等。
- 影响（已消除）
  - recency 曲线已与 Rust 一致。

### 5.5 可选服务导致的行为差异（中影响）

- Rust reference
  - `Aura::recall_core` 会在 raw baseline 之后进行 bounded reranking，并执行 finalize 副作用（activate/strengthen/session/audit）。
- TS 当前实现
  - `recallPipeline` 仍把 embedding/rerank/finalize 做成可选服务（Context 提供则执行，不提供则跳过）。
  - `packages/core/src/RecallFinalizer.ts` 已提供文件持久化 `RecallFinalizerFileLive`，由 `DefaultLayer` 与 core recall facade 默认装配：
    - top-10 activate：对齐 Rust `Record::activate()` 的 strength、activation_count、last_activated、activation_velocity 更新；
    - co-recall strengthening：对齐 Rust `activate_and_strengthen` 的双向连接增强 `current + 0.05 * (1 - current)`；
    - Aura 实例级 `recall*` 会在 recall 后重载 `searchRecords`，避免打开中的 TS Aura 视图滞后。
  - `packages/core/src/RecallReranker.ts` 已提供文件持久化 `BoundedRerankerFileLive`，由 `DefaultLayer` 与 core recall facade 默认装配：
    - 从 `beliefs.cog` / `concepts.cog` / `causal.cog` / `policies.cog` 加载快照；
    - 按 Rust `AuraRuntimeState::new()` 默认执行 belief=Limited、concept=Inspect、causal=Limited、policy=Limited；
    - 复用 `packages/recall/src/BoundedReranker.ts` 中的 Rust guardrails：min results=4、top_k≤20、score cap（belief 5% / concept 4% / causal 3% / policy 2%）、position shift≤2。
  - `packages/recall/src/BoundedReranker.ts` 同时暴露纯算法与 engine-backed `BoundedRerankerLive`，通过 Belief/Concept/Causal/Policy engine stats 运行同一套 Rust guardrails。
    - `computeShadowBeliefScores` 已对齐 Rust `compute_shadow_belief_scores`，支持 Shadow observe-only report（不改变输入排序）。
- 影响
  - finalize 的 records 落盘副作用已对齐；session-scoped co-activation tracking 已通过 `RecallSessionTracker` / `endRecallSession` 接入，但 AuditLog 风格持久化仍未补齐。
  - 默认 bounded rerank 已从旧的非对齐位置 boost 改为 Rust runtime 默认的 file-backed Limited/Inspect 组合；Shadow report 计算已具备，但运行期开关 API 与 trace/report 对外表面尚未补齐。
- 后续对齐建议
  - 继续评估是否需要补齐更 Rust-shaped 的 audit/report 持久化表面。
  - 补齐 bounded rerank 的运行期开关 API 与 report/trace 对外表面。

### 5.6 Record 模型与默认字段不一致（中影响）—— ✅ 已完成

- Rust reference
  - `Record` 字段较多，并有默认值/校验（`../src/record.rs`、`../src/levels.rs`）。
- TS 当前实现
  - `packages/contract/src/record/Record.ts` 已补齐 Rust 默认字段、valid source/semantic 常量、`defaultConfidenceForSource` 与 store/update validation helper。
  - `packages/storage/src/CognitiveRecord.ts` 已在读取 brain.cog / brain.snap 时标准化 tags/connections/metadata 与默认字段：`source_type=recorded`、`semantic_type=fact`、`activation_velocity/salience/volatility=0`、`confidence=0.90`、`support_mass/conflict_mass=0`。
  - `packages/core/src/Aura.ts` 已在 store/update/connect/delete 边界使用 Rust 对齐校验，并在 `Aura.open` 迁移 legacy confidence：非 recorded source 若从 serde 默认 `0.90` 读入，会按 source_type 改写并追加 update。
  - salience 已接入 `recordImportance`、structured recall explanation、`memory_health` summary 与 high-salience review issue。
- 影响（已消除）
  - 新写入与旧持久化读取路径不再依赖松散 `any`/缺省字段；source/semantic/namespace 校验和 Rust store/update 边界一致。

### 5.7 graph/causal 扩展的输入数据来源不一致（中影响）

- Rust reference
  - graph_walk 依赖 `Record.connections`（权重）；
  - causal_walk 依赖 `Record.caused_by_id`；
  - 并有 min_strength 与 namespace 限制（`../src/recall.rs`）。
- TS 当前实现
  - 算法已对齐 Rust 的公式与阈值（`packages/recall/src/GraphWalk.ts`、`CausalWalk.ts`），但 records 的 connections/caused_by_id 目前取自 cognitive JSON 的 raw 字段（若数据源未写入这两类字段，则扩展效果与 Rust 环境不同）。
- 影响
  - 真实数据中如果 TS 的写入/归一化未补齐 connections/caused_by_id，召回扩展会弱于 Rust。
- 后续对齐建议
  - 写入阶段实现 finalize/strengthen 的持久化后，graph 扩展才能完全对齐 Rust 的“长期运行状态”。

### 5.8 召回缓存与可观测性缺失（低-中影响）

- Rust reference
  - `Aura::recall` / `recall_structured` 有缓存（`runtime.recall_cache` 等）。
  - 有 trace 版本用于解释性输出（`recall_with_trace`）。
- TS 当前实现
  - 暂无缓存与 trace 结构化输出。
- 影响
  - 性能与可解释性不一致；功能层面输出仍可对齐，但调试能力弱。
- 后续对齐建议
  - 在 contract 中定义可选 `RecallTraceSink` 或 `RecallCache` 服务，并在 core 层装配默认实现。

---

## 6. 当前已存在的对齐基线（减少后续返工）

- `brain.aura` / `index/` / `brain.cog+snap` 的最小读取已具备，且可构建 `RecallView`（TS）。
- TS/Rust parity 测试已建立（覆盖 SDR + tags + ngram 参与 RRF）：
  - Rust 生成 fixture：`../src/bin/aura-ts-recall-fixtures.rs`
  - Rust verifier：`../src/bin/aura-ts-verify-recall.rs`
  - TS parity：`packages/core/src/Recall.parity.test.ts`

后续对齐工作建议都先通过扩展 parity fixture/断言来推进，而不是仅靠肉眼比对。

---

## 7. 相关文档索引（spec/plan）

### 6.1 Specs

- [2026-05-20-aura-typescript-port-design.md](../docs/superpowers/specs/2026-05-20-aura-typescript-port-design.md)：TS 1:1 重写的总体设计与兼容目标（磁盘格式互通、包结构与里程碑）。
- [2026-05-20-aura-typescript-effect-layering-design.md](../docs/superpowers/specs/2026-05-20-aura-typescript-effect-layering-design.md)：effect-smol 分层约束与依赖注入规范（Context/Layer、platform-node 边界、可测性）。
- [2026-05-20-aura-typescript-recall-first-design.md](../docs/superpowers/specs/2026-05-20-aura-typescript-recall-first-design.md)：召回优先的 read model/可选服务设计与 Rust 对齐策略（RecallView、Embedding/Rerank/Finalize 可选）。

### 6.2 Plans

- [2026-05-20-aura-typescript-port-m1.md](../docs/superpowers/plans/2026-05-20-aura-typescript-port-m1.md)：M1 计划（初始迁移/骨架搭建）。
- [2026-05-20-aura-typescript-port-m2.md](../docs/superpowers/plans/2026-05-20-aura-typescript-port-m2.md)：M2 计划（分层纠偏、契约与工具包拆分）。
- [2026-05-20-aura-typescript-port-m3-1.md](../docs/superpowers/plans/2026-05-20-aura-typescript-port-m3-1.md)：M3-1 计划（索引+认知写入优先阶段）。
- [2026-05-20-aura-typescript-effect-layering-plan.md](../docs/superpowers/plans/2026-05-20-aura-typescript-effect-layering-plan.md)：effect-smol 分层落地任务拆解与检查点。
- [2026-05-20-aura-typescript-recall-first.md](../docs/superpowers/plans/2026-05-20-aura-typescript-recall-first.md)：召回优先执行计划（Task1~Task7）。
- [2026-05-20-core-recall-facade.md](../docs/superpowers/plans/2026-05-20-core-recall-facade.md)：core 层召回门面 API 的取舍与最终选择（recallScored/recallRecords 双层）。
- [2026-05-20-rust-ts-recall-parity.md](../docs/superpowers/plans/2026-05-20-rust-ts-recall-parity.md)：Rust/TS parity fixture + verifier 的设计与扩展策略。
- [2026-05-20-platform-node-task3.md](../docs/superpowers/plans/2026-05-20-platform-node-task3.md)：platform-node Layer 落地任务（文件系统/rename/原子写等）。
- [2026-05-20-typescript-codec-crypto.md](../docs/superpowers/plans/2026-05-20-typescript-codec-crypto.md)：codec/crypto 的字节级对齐计划与测试策略。

---

## 8. 工作记忆（当前状态）

### 8.1 已完成（以可验证为准）

- 已按包分层完成召回主链路：`storage/RecallView` → `recall/Pipeline` → `core/Recall` → `Aura.recall*`。
- 已实现并接入可选服务：EmbeddingStore / BoundedReranker / RecallFinalizer / TrustConfig（缺失即跳过），并由测试覆盖缺失/存在两种路径。
- 已建立 Rust/TS parity 测试与确定性 reference：Rust verifier 使用固定 seed 的 NGramIndex 构造，TS 侧对齐输出 ids。
- 已完成维护链路 Phase 1/2 的核心骨架与实现：Record → Belief → Concept（含 EpistemicTrace、BeliefEngine/Store、ConceptEngine/Store），并通过全量测试回归。
- 已将 Rust 枚举在 TS 侧从 string union type 统一迁移为 TypeScript string enum，并同步修复字面量赋值/比较/默认值；提供运行期枚举值测试。
- 已将 `nowSecs()` 抽取到 `packages/utils` 并替换代码库内同算法表达式，避免时间戳计算分散与不一致。
- 已完成维护链路 Phase 3/4 的完整实现：CausalEngine（edge 提取 → pattern 聚合 → score/gates → corpus fingerprint → discover）、PolicyEngine（seed 选择 6 gates → polarity 分类 → action mapping → 强度评分 → suppression → discover），含 CausalStore/PolicyStore 持久化。
- 已完成 EpistemicRuntime 完整实现（694 行，18+ inspection 方法覆盖 Belief/Concept/Causal/Policy 四层），含 telemetry 计数与 EpistemicRuntimeLive Layer。
- 已补齐 Record schema 默认字段、source/semantic/namespace 校验、store/update/delete/connect 写入边界语义，并接入 salience 到重要性与 memory_health 表面。
- 已补齐 recall finalize 的 records 落盘副作用：`RecallFinalizerFileLive` 默认装配，top-10 activate 与 co-recall strengthening 按 Rust `activate_and_strengthen` 更新 `brain.cog`。
- 已补齐 file-backed bounded rerank 默认链路：`BoundedRerankerFileLive` 默认装配，按 Rust runtime 默认执行 belief/causal/policy Limited 与 concept Inspect，移除旧的非对齐位置 boost。
- 已完成 `@aura/mcp`：Mastra stdio server、canonical `TOOL_INVENTORY`、Inventory/MastraCompat/StdioSmoke/Parity 测试已落地；当前 inventory 为 20 个 implemented tools + 1 个显式 unsupported `consolidate`。

### 8.2 当前差异与风险（下一步优先级）

- 当前主线已从 Phase 7 切到 backlog `999.3`：优先做 engine/tooling 公共工具去重，避免继续在各包复制 Effect wrapper / hash / polarity / 并查集一类 helper。
- 高优先级对齐项：bounded rerank 的运行期开关、report/trace 对外表面；`consolidate` 仍保持 explicit unsupported，不能伪造成功。
- 中优先级对齐项：graph/causal 扩展所需字段的写入侧闭环、NGramIndex 的 SynonymRing 可选扩展。
- 低-中优先级对齐项：召回缓存与 trace/可观测性；Rust MCP 若本地不可构建，parity artifact 必须继续诚实标记 `skipped_no_rust_or_golden`，不能写成 parity passed。

## 9. Phase Learnings（跨 phase 经验沉淀）

每个 phase 完成后由 `/gsd:extract-learnings` 生成对应 phase 的 learnings 文档（例如 `.planning/phases/06-maintenance-pipeline-completion/06-LEARNINGS.md`），记录该 phase 的 decisions、lessons、patterns、surprises。以下文件是必读上下文：

| Phase | File | 关键教训数 |
|-------|------|-----------|
| 06 | `.planning/phases/06-maintenance-pipeline-completion/06-LEARNINGS.md` | 7D + 5L + 5P + 4S |
| 06.1 | `.planning/phases/06.1-/06.1-LEARNINGS.md` | 1D + 2L + 1P + 1S |
| 06.2 | `.planning/phases/06.2-epistemicruntime-maintain-maintenanceservice-rust/06.2-LEARNINGS.md` | 12D + 7L + 6P + 6S |
| 06.3 | `.planning/phases/06.3-engine-algorithm-parity/06.3-LEARNINGS.md` | 5D + 5L + 4P + 4S |
| 07 | `.planning/phases/07-mcp-polish/07-LEARNINGS.md` | 14D + 9L + 9P + 6S |

### 9.1 浓缩关键教训（新 phase 讨论/规划前必须过一遍）

| # | 教训 | 来源 |
|---|------|------|
| 1 | **PLAN 是假设，不是规格** — 公式/常量/阈值必须在实现时 grep Rust 源码验证，不能盲信 PLAN | 06.3-L5 |
| 2 | **规划前检查依赖是否已实现** — 别只看目标代码，要扫一遍是否有已存在但被标成 TODO/unknown 的依赖（如 MaintenanceService 5 个 `type X = unknown`） | 06.3-L2 |
| 3 | **Code review fix 可能引入垃圾代码** — review 修一个问题时可能引入废弃接口+无用适配器（如 `policyEngineFromState`），修完后检查是否引入了零调用者的代码 | 06.3-L5 |
| 4 | **测试全绿不代表架构正确** — 06.2 的 GAP-01/02 都是在 104 tests pass 的情况下发现的（Surface.ts 用本地类型而非 contract import、Aura.runMaintenance 是 Effect.die stub） | 06.2-S4 |
| 5 | **Type cascade 需要协调多文件同时更新** — 加一个 contract 字段可能波及 9+ 文件的 test mock/factory，大部分 breakage 在测试代码而非实现代码 | 06.3-S2, 06-L2 |
| 6 | **可选服务模式会掩盖缺失实现** — `serviceOption()` 让 pipeline 静默跳过未注册服务，BoundedReranker/RecallFinalizer 因此零实现跑了多个 phase 才被发现 | 06-S2 |
| 7 | **Worktree 并发执行脆弱** — agent 完成后 worktree 锁可能残留，`gsd-tools phase.complete` 可能覆盖手动修复的 STATE.md | 06.3-L3, L4 |
| 8 | **Windows: Edit 工具可能引入智能引号** — 编辑含中文注释的文件时可能把 `"` 变成 `"` `"`，导致 TS1127 错误。恢复方法是 `git checkout` 后用 Write 重写 | 06.1-L2 |
| 9 | **Effect 版本 API 差异** — beta.68 的 `Effect.gen` 不支持 `$` 参数模式、没有 `Effect.dieMessage`、`satisfies` 不缩窄返回类型、Ref 类型是 `Ref.Ref` 不是 `Effect.Ref.Ref` | 06.2-L1, 06.1-S1 |
| 10 | **遵循已有 engine 模式可大幅加速实现** — ConceptEngine 模式被 CausalEngine/PolicyEngine 复用，减少设计开销到几乎为零 | 06-L1 |
| 11 | **Vitest 2.1.9 不支持 --filter** — `bun run test --filter "@aura/pkg"` 会报 Unknown option，必须用文件级路径 `bun run test packages/pkg/src/file.test.ts` 替代 | 07-L1 |
| 12 | **Layer 合并顺序决定服务可见性** — `Layer.mergeAll` 并排合并不建立 provide 关系；子 Layer 需要的服务必须由父 Layer provide，否则静默缺失并以不透明的 Effect.die 报错 | 07-L4 |
| 13 | **删除导出前必须跨包 grep 调用者** — 移除 `packages/policy` 的 adapter 导致 `packages/epistemic-runtime` 编译失败；跨包依赖在 typecheck 通过时不明显，但删除即刻暴露 | 07-L5 |
| 14 | **Zod ref schema 会让 MCP tool 从 inventory 中静默消失** — Mastra MCP client 无法解析 JSON Schema $ref，导致 tools/list 少返回 tool；必须用 per-field factory 生成 inline schema | 07-L3 |

### 9.2 已确立的模式（新 engine/模块应遵循）

| # | 模式 | 何时使用 |
|---|------|---------|
| P1 | `namespace.Interface` + `implements X.Interface` + `Context.Tag` | 所有 Effect 服务 |
| P2 | `Layer.effect(Tag, Effect.gen(...))` | 服务构造需要 Effect 操作（如 Ref.make） |
| P3 | `Effect.gen` + `yield*` 顺序编排 | 组合多个 Effect 操作 |
| P4 | `serviceOption(Tag)` 可选服务 | 可插拔的横切关注点（trace、rerank、finalize） |
| P5 | Surface 管线：filter → sort → limit → map | 引擎内部状态 → 公开视图类型转换 |
| P6 | TypeScript string enum（非 string union） | 跨包类型对齐 Rust enum |
| P7 | grep-verified constant parity | 常量/阈值/公式对齐 Rust（比运行时 E2E 快） |
| P8 | TDD RED-GREEN commit pairs | 所有行为添加型任务 |
| P9 | 两层收敛架构：core facade + thin transport | MCP/HTTP transport 层只做参数映射和序列化，业务逻辑全部在 core facade |
| P10 | Canonical inventory ledger — 单一数组驱动注册+测试+验证 | 10+ tool 的 MCP server，防止注册/测试/parity 三处 drift |
| P11 | Rust-shaped DTO with Mcp* prefix for clashing exports | MCP 对外的 snake_case DTO 与内部 camelCase 类型同名时，用 Mcp* 前缀区分 |
| P12 | Typed unsupported error with Rust reference | Rust-facing surface 暂未实现时，返回 TaggedError 含 surface/rust_reference/missing_prerequisites，不用 Effect.die |

### 8.3 下一步建议（推进顺序）

1) 推进 backlog `999.3`：把已重复出现的 Effect wrappers / hash / polarity signals / UnionFind 收敛到 `@aura/utils` 或现有公共层，先消除跨包复制，再动行为语义。
2) 补齐 bounded rerank 运行期开关 API 与 report/trace 对外表面，并扩展 verifier/trace 断言。
3) 审计 graph/causal 扩展所需字段的写入侧闭环（connections / caused_by_id / finalize-strengthen）。
4) 对照 Rust store_with_channel 继续收敛 dedup / guard / provenance / surprise promotion 等剩余写入语义。
5) 后续如启用 Rust `SynonymRing`，在 TS `NGramIndex` 内接入同义词扩展并补 verifier。

### 8.4 维护流程分阶段状态（Phase 3+）

本项目的维护链路按 `Record → Belief → Concept → Causal → Policy` 推进；为避免上下文漂移，本节固定记录 Phase 3 及之后的”实现现状 + 缺口”。

#### Phase 3：Causal（已完成）

- contract 状态：`CausalEngine.Interface` 定义了完整的 `discover()` / `invalidate_pattern()` / `retract_pattern()` / `stats()` 契约；`CausalStore.Interface` 定义了 `load()` / `save()` 持久化契约。`CausalEngineImpl` 与 `CausalStoreImpl` 为指向对应 Interface 的 deprecated type alias：
  - `packages/contract/src/Causal.ts`
  - `packages/contract/src/causal/CausalTypes.ts`（`CausalPattern`、`CausalEngineState`、`CausalReport`、`CausalEdgeKind`、`CausalState`、`CausalDiscoveryMode`、`TemporalBudgetMode`、`EvidenceMode` 等类型定义）
- storage 状态：`CausalStoreFile` 完整实现 `causal.cog` 的 load/save，通过 `CogJsonSnapshotFile` 统一读写：
  - `packages/storage/src/CausalStoreFile.ts`
- engine 状态：`CausalEngineImpl`（1175 行）完整实现，含：
  - `extractEdges()`：从 records 的显式链接与时间接近性中提取 record-level causal edges
  - `aggregateToPatterns()`：将 record-level edges 聚合为 belief-level `CausalPattern`（含 support/confidence/lift/transition_lift/temporal_consistency/causal_strength 等 20+ 字段）
  - `scorePattern()`：计算 causal_strength 综合得分
  - `computeCorpusFingerprint()`：corpus 指纹用于 skip detection
  - Gates：`meetsSupportGate` / `meetsEvidenceGate` / `meetsCounterfactualGate`
  - `discover()`：完整四阶段发现流程（extract → aggregate → score → gate → persist）
  - `CausalEngineLive` Layer
  - `packages/causal/src/CausalEngine.ts`
  - `packages/causal/src/CausalStore.ts`（`CausalStoreImpl` + `CausalStoreLive`）
- 目标 spec：
  - `../docs/superpowers/specs/2026-05-22-typescript-maintenance-belief-concept-causal-policy-design.md`

#### Phase 4：Policy（已完成）

- contract 状态：`PolicyEngine.Interface` 定义了完整的 `discover()` / `retract_hint()` / `stats()` 契约（依赖 CausalEngine + ConceptEngine + BeliefEngine）；`PolicyStore.Interface` 定义了 `load()` / `save()` 持久化契约。`PolicyEngineImpl` 与 `PolicyStoreImpl` 为指向对应 Interface 的 deprecated type alias：
  - `packages/contract/src/Policy.ts`
  - `packages/contract/src/policy/PolicyTypes.ts`（`PolicyHint`、`PolicyEngineState`、`PolicyReport`、`PolicyState`、`PolicyActionKind`、`Polarity` 等类型定义）
- storage 状态：`PolicyStoreFile` 完整实现 `policies.cog` 的 load/save，通过 `CogJsonSnapshotFile` 统一读写：
  - `packages/storage/src/PolicyStoreFile.ts`
- engine 状态：`PolicyEngineImpl`（777 行）完整实现，含：
  - `selectSeeds()`：从 causal patterns 中筛选种子（6 gates：Strength / Support / Evidence / Counterevidence / Counterfactual / Belief）
  - `buildHints()`：从 seeds 构建 `PolicyHint`（含 condition/action/priority/confidence/riskScore/polarity/recommendation 等字段）
  - `classifyPolarity()`：基于 effect-side record 信号计数分类为 Positive/Negative/Neutral
  - `mapActionKind()`：映射为 Avoid/VerifyFirst/Prefer/Recommend/Warn 五种 action kind
  - `computePolicyStrength()`：计算 policy 强度分数（0–1）
  - `generateRecommendation()`：基于模板生成推荐文本
  - `applySuppression()`：冲突检测与抑制
  - `discover()`：完整发现流程（seed → hint → score → suppress → persist）
  - `PolicyEngineLive` Layer
  - `packages/policy/src/PolicyEngine.ts`
  - `packages/policy/src/PolicyStore.ts`（`PolicyStoreImpl` + `PolicyStoreLive`）

#### Phase 5：端到端维护编排（部分完成）

- EpistemicRuntime：已完成（694 行），`EpistemicRuntimeImpl` 实现 `EpistemicRuntime.Interface`，提供 18+ inspection 方法：
  - Belief 层（6 方法）：`getBeliefs()` / `getBeliefForRecord()` / `getHighVolatilityBeliefs()` / `getLowStabilityBeliefs()` / `getBeliefInstabilitySummary()` / `getContradictionClusters()`
  - Concept 层（4 方法）：`getConcepts()` / `getSurfacedConcepts()` / `getSurfacedConceptsForNamespace()` / `getSurfacedConceptsForRecord()`
  - Causal 层（1 方法）：`getCausalPatterns()`
  - Policy 层（7 方法）：`getPolicyHints()` / `getSuppressedPolicyHints()` / `getRejectedPolicyHints()` / `getPolicyLifecycleSummary()` / `getPolicyPressureReport()` / `getSurfacedPolicyHints()` / `getSurfacedPolicyHintsForNamespace()`
  - 含 telemetry 计数（global/namespace/record 调用次数、concepts/hints 返回量）
  - `EpistemicRuntimeLive` Layer
  - `packages/contract/src/EpistemicRuntime.ts`
  - `packages/epistemic-runtime/src/EpistemicRuntime.ts`
  - `packages/epistemic-runtime/src/EpistemicTrace.ts`（`EpistemicTraceImpl` + `EpistemicTraceLive`）
- MaintenanceService：已在 `@aura/core` 中实现完整维护编排，`Aura.runMaintenance()` 已接到该 pipeline；当前剩余缺口不是“没有入口”，而是写侧是否自动触发维护、以及若干 Phase 8/非 parity-grade 算法仍保持显式简化实现。
- BoundedReranker：`@aura/recall` 暴露 Rust guardrail 纯算法、Shadow observe-only report 与 engine-backed `BoundedRerankerLive`；`@aura/core` 的 `BoundedRerankerFileLive` 已默认接入 Rust runtime Limited/Inspect guardrails；仍缺少运行期开关 API 与 report/trace 对外表面。
- Aura 写入触发：`Aura.store/update/delete/connect` 目前只负责写入 `brain.cog`（以及 snapshot），尚未触发维护服务（Phase 5 完成后应默认开启，可配置关闭）。
