# Agents.md（TypeScript 端工程说明）

本文档用于给后续的实现者/子代理提供“上下文基线”，并把本项目的硬性要求、注释规范、验证策略按优先级固化下来，减少偏离与返工。

---

## 1. 最高优先级原则（按顺序执行）

1) 对齐 Rust 行为与持久化格式：优先确保磁盘格式互通（必要时字节级一致），其次对齐算法语义与输出。  
2) 可验证性优先：任何改动必须可通过 `bun run --cwd typescript typecheck` 与相关测试；不允许“只凭肉眼”对齐。  
3) 不确定性先消除：Rust reference 若含随机性/非确定性，优先让 verifier/fixture 可复现，再做 TS 对齐。  
4) 依赖注入与分层边界必须守住：core/storage/codec/indexing/recall 禁止直接依赖 `node:*`。  
5) 注释与差异必须显式：保留 Rust 同位置注释并翻译为中文；差异要能全局搜索定位。  

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

- 测试框架：vitest + @effect/vitest（通过 `bun run --cwd typescript test` 执行）。
- 每个算法模块都应有与 Rust 高度一致的测试文件（优先不依赖其它模块者先写）。
- 跨语言对照：通过 `spawnSync("cargo", ["run", "--bin", ...])` 在测试中运行 Rust verifier/fixture。

---

## 3. workspace 结构（按职责分包）

`typescript/` 是一个 workspaces 仓库（见 `typescript/package.json`）。核心意图是把“纯逻辑”“二进制格式”“平台 IO”“门面编排”拆开，便于对齐 Rust 与测试。

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

### 5.1 NGram 相似检索算法不一致（高影响）

- Rust reference
  - `NGramIndex`：MinHash + LSH（`src/ngram.rs`）。
  - recall 使用：`collect_ngram`（`src/recall.rs`）。
- TS 当前实现
  - 在 `storage/RecallView` 内构建了一个 trigram Jaccard 的 `ngramIndex`（简单实现，用于召回先跑通）：
    - `packages/storage/src/RecallView.ts`
- 影响
  - 候选集合、相似度分布、排序稳定性与 Rust 不同；RRF 融合的最终排序会偏离 Rust。
- 后续对齐建议
  - 在 TS 侧实现一个与 Rust 相同的 MinHash+LSH NGramIndex，并通过 parity fixture 校验 query 输出一致。
  - 同时明确 seed/系数生成的确定性（用于测试可复现）。

### 5.2 InvertedIndex 搜索语义不一致（高影响）—— ✅ 已完成

- Rust reference
  - `InvertedIndex::search(query_indices, top_k, min_overlap)` 有一套性能与剪枝策略（`src/index.rs`）。
- TS 当前实现
  - `searchScored(bits, topK, minOverlap)`（`packages/indexing/src/InvertedIndex.ts`）已与 Rust 语义对齐：
    - max_bits 选择：top_k ≤ 10 → 128，≤ 50 → 256，else → 512
    - rarity sort：bitmaps 数量超过 max_bits 时按 bitmap 长度升序（最稀有的优先）
    - 只处理前 `min(bitmaps.length, max_bits)` 个 bitmaps
    - 结果截断到 `limit = min(top_k * 10, 500)` 后再 resolve external IDs
  - 并补充了 `InvertedIndex.searchScored.test.ts` 覆盖边界条件（含 rarity sort + max_bits 剪枝）。
- 影响（已消除）
  - 候选集合、topK 截断与 Rust 在大数据量下的差异已消除。

### 5.3 SDR collect_sdr 的细节差异（中-高影响）

- Rust reference
  - `collect_sdr`：倒排候选 → aura_id→record_id 映射 → 取 header.sdr_indices → tanimoto（`src/recall.rs`）。
- TS 当前实现
  - 同样走 aura_id→record_id + tanimoto，但明确写了简化：目前 invertedIndex 的 overlap 不参与权重，只用 tanimoto（`packages/recall/src/Signals.ts`）。
- 影响
  - 在同 tanimoto 情况下，Rust 可能会因为 overlap/候选策略出现不同排序或不同候选集合。
- 后续对齐建议
  - 把 overlap 引入打分/排序策略，或至少在 tie-break 中使用 overlap，确保对齐 Rust 行为。

### 5.4 Trust/Recency 计算公式不一致（高影响，且隐蔽）—— ✅ 已完成

- Rust reference
  - `compute_effective_trust`（`src/trust.rs`）：
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
  - `recallPipeline` 把 embedding/rerank/finalize 全部做成可选服务（Context 提供则执行，不提供则跳过）。
- 影响
  - 在未提供 `BoundedReranker` 与 `RecallFinalizer` 时，TS 输出与 Rust recall_core 的最终输出不一致（更接近 Rust 的 recall_raw）。
- 后续对齐建议
  - 提供默认的 Live Layer：在 core 层默认装配与 Rust 等价的 bounded rerank/finalize（或明确对外区分 recallRaw vs recallCore）。
  - 同时将副作用的落盘（更新 records / session tracker）后置到写入阶段对照测试中。

### 5.6 Record 模型与默认字段不一致（中影响）

- Rust reference
  - `Record` 字段较多，并有默认值/校验（`src/record.rs`、`src/levels.rs`）。
- TS 当前实现
  - `storage/CognitiveRecord.normalizeCognitiveRecord` 只做最小字段兜底（content_type/metadata/connections），其余字段保留 raw JSON（`packages/storage/src/CognitiveRecord.ts`）。
- 影响
  - tags/namespace/source_type/strength 等若缺失或类型不一致，TS 召回的过滤与打分会与 Rust 不一致。
- 后续对齐建议
  - 完整实现 Record schema 的默认值与校验逻辑，并在加载时标准化字段，确保后续 recall 不靠“松散 any”行为。

### 5.7 graph/causal 扩展的输入数据来源不一致（中影响）

- Rust reference
  - graph_walk 依赖 `Record.connections`（权重）；
  - causal_walk 依赖 `Record.caused_by_id`；
  - 并有 min_strength 与 namespace 限制（`src/recall.rs`）。
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
  - Rust 生成 fixture：`src/bin/aura-ts-recall-fixtures.rs`
  - Rust verifier：`src/bin/aura-ts-verify-recall.rs`
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

### 8.2 当前差异与风险（下一步优先级）

- 高优先级对齐项：NGramIndex（MinHash+LSH）。
- 中优先级对齐项：SDR overlap 权重/排序细节、Record schema 的默认值与校验、graph/causal 扩展所需字段的写入侧闭环。
- 低-中优先级对齐项：召回缓存与 trace/可观测性。

### 8.3 下一步建议（推进顺序）

1) 在 TS 侧实现 Rust 等价的 MinHash+LSH NGramIndex，再用 parity fixture 对齐 query 输出。  
2) 把 SDR overlap 权重/排序细节补齐（InvertedIndex 已返回 overlap count，需在 `collectSdr` 中引入权重参与排序）。  
3) 在 core 层补齐默认 bounded rerank/finalize 的 Live Layer（或明确区分 recallRaw/recallCore），再推进写入侧对照测试。  
4) 完整实现 Record schema 的默认值与校验逻辑。  
