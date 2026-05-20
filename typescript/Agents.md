# Agents.md（TypeScript 端工程说明）

本文档用于给后续的实现者/子代理提供“上下文基线”，避免重复调查与反复返工。内容包含：

- `typescript/` 目录用途与结构
- 用户对本项目提出的关键要求（必须遵守）
- 遇到问题时的决策/思考方式（避免静默偏离目标）
- 当前 TypeScript 版本与 Rust 版本的不一致点（详细，作为后续对齐清单）

---

## 1. 目录用途与结构

### 1.1 目标

在 `typescript/` 下实现 Rust 核心的 1:1 TypeScript 重写（学习/研究用途），并以 Bun 作为运行时。

### 1.2 workspace 结构

`typescript/` 是一个 workspaces 仓库（见 `typescript/package.json`），所有代码按包划分，核心意图是把“纯逻辑”“二进制格式”“平台 IO”“门面编排”拆开，便于对齐 Rust 与测试。

- `packages/contract`
  - 只放“契约”：Effect Context/Tag 定义（例如 FileRead/FileWrite/Clock/Crypto/Recall 相关 tags）。
  - 不放实现细节，不直接依赖 node:*。
- `packages/platform-node`
  - 平台实现层：Bun/Node 的文件系统、时钟、crypto 等 Live Layer。
  - 所有 node:* 仅允许出现在这里。
- `packages/utils`
  - 纯函数工具（bytes/hex/crc32 等），无 IO、无 Effect 依赖（或极少）。
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

### 1.3 测试与验证策略（当前）

- TypeScript 侧测试框架：vitest + @effect/vitest（通过 `bun run test` 执行）。
- 跨语言对照：通过 `spawnSync("cargo", ["run", "--bin", ...])` 在测试中运行 Rust verifier/fixture。

---

## 2. 用户提出的关键要求（必须遵守）

### 2.1 兼容级别与范围

- 兼容级别：磁盘格式兼容（TS 与 Rust 生成/读取的数据必须互通，必要时字节级一致）。
- 范围：core + MCP（不做 HTTP server）。
- 落盘兼容范围选择为“覆盖全部持久化文件”（后续逐步补齐）。

### 2.2 运行时与分层

- 运行时：Bun。
- 分层：effect-smol 风格的 Context/Layer 依赖注入。
  - core/storage/codec/indexing/recall 层不得直接 `import node:*`。
  - 平台 IO 必须通过 `@aura/contract` 的服务接口注入，再由 `@aura/platform-node` 提供 Live 实现。
- 分层强度：中度分层。

### 2.3 contract 约束

- 必须有 `@aura/contract` 包，并对外导出 Context Tags。
- 文件系统服务必须拆分为：
  - `FileRead`：只读能力
  - `FileWrite`：写入能力（包含原子写所需的 rename 等）

### 2.4 代码规范（项目级）

- 不允许跨包相对引用（应通过 `@aura/*` alias）。
- 在需要“先简化后对齐”的模块中，必须在代码内写清楚两类标记：
  - `SIMPLE IMPLEMENTATION:` 当前简化点是什么、为什么能先这么做
  - `FULL IMPLEMENTATION:` Rust 等价行为是什么、后续要怎么对齐（最好附 Rust 文件位置）
- 遇到对齐困难点必须显式说明并向用户征询意见，不能静默改变目标。

---

## 3. 遇到问题时的思考过程（决策记录）

这一节用于说明：当“对齐目标”与“工程可推进性/可验证性”冲突时，我们如何做决策，避免走偏。

### 3.1 优先级原则

1) 功能对齐优先：先把 Rust 主链路在 TS 侧跑通，并能用测试证明行为一致或差异明确。  
2) 可验证优先：任何实现变更必须能通过 `bun run typecheck` 与至少相关测试用例。  
3) 不确定性必须消除：如果 Rust 侧算法含随机性/非确定性，必须先让验证具备确定性，否则 parity 测试无意义。  

### 3.2 典型例子：NGram 随机性导致 parity 不稳定

Rust 的 `NGramIndex::new` 会生成随机 hash 函数系数，导致同样数据每次 query 的候选排序可能不同，从而 TS 无法稳定对齐。  
处理方式：

- 先明确“难点属于不确定性，而非 TS 写错”。
- 为 parity/verifier 引入可确定构造：新增 `NGramIndex::with_seed(...)` 供 verifier 用固定 seed 构造，保证 Rust 输出稳定，再进行 TS 对齐。

这一类改动属于“为了验证对齐而让 reference 稳定”，并且不改变 Rust 主流程默认行为。

### 3.3 典型例子：可选服务（Context 注入）导致的行为分叉

用户要求 embedding/rerank/finalize 可作为可选 Context 提供：若不提供则不执行。  
处理方式：

- TS 的 `recallPipeline` 使用 `serviceOption(Tag)` 获取可选服务。
- 缺失时不报错、直接跳过该分支，但必须通过测试覆盖“缺失/提供”的两种路径。

---

## 4. 当前与 Rust 版本的不一致点（详细清单）

本节以“后续对齐任务列表”的形式记录差异点。每一项都说明：

- Rust reference 是什么
- TS 当前做了什么
- 差异会导致什么影响
- 后续对齐建议

### 4.1 NGram 相似检索算法不一致（高影响）

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

### 4.2 InvertedIndex 搜索语义不一致（高影响）

- Rust reference
  - `InvertedIndex::search(query_indices, top_k, min_overlap)` 有一套性能与剪枝策略（`src/index.rs`）。
- TS 当前实现
  - TS 原 `search(bits)` 返回交集后的外部 id，不包含 overlap。
  - 为 recall 对齐，新增了 `searchScored(bits, topK, minOverlap)`，当前是“简单计数 overlap 并按 overlap 排序”的实现：
    - `packages/indexing/src/InvertedIndex.ts`
  - 并在 `storage/RecallView` 把 contract 的 `invertedIndex.search` 映射到 `searchScored`。
- 影响
  - 候选集合、topK 截断与 Rust 在大数据量下会明显不同（Rust 有 rarity-based pruning 与计数 buffer 优化）。
- 后续对齐建议
  - 在 TS 侧实现与 Rust 同语义的 search（包含 rarity sort、max_bits 选择、计数 buffer 的稀疏清理策略），并增加数据量较大的性能/正确性对照测试。

### 4.3 SDR collect_sdr 的细节差异（中-高影响）

- Rust reference
  - `collect_sdr`：倒排候选 → aura_id→record_id 映射 → 取 header.sdr_indices → tanimoto（`src/recall.rs`）。
- TS 当前实现
  - 同样走 aura_id→record_id + tanimoto，但明确写了简化：目前 invertedIndex 的 overlap 不参与权重，只用 tanimoto（`packages/recall/src/Signals.ts`）。
- 影响
  - 在同 tanimoto 情况下，Rust 可能会因为 overlap/候选策略出现不同排序或不同候选集合。
- 后续对齐建议
  - 把 overlap 引入打分/排序策略，或至少在 tie-break 中使用 overlap，确保对齐 Rust 行为。

### 4.4 Trust/Recency 计算公式不一致（高影响，且隐蔽）

- Rust reference
  - `compute_effective_trust`（`src/trust.rs`）：
    - recency_boost = max * (1 - age_days/half_life_days)，下限 0
    - effective = (trust + recency_boost) * authority * source_type_factor，clamp(0.05, 1.0)
- TS 当前实现
  - `computeEffectiveTrust`（`packages/recall/src/Trust.ts`）：
    - 使用指数衰减：recency_boost = max * 0.5^(age_days/half_life_days)
    - 其余结构保持类似
- 影响
  - 时间越久远，TS/Rust 的 recency 曲线差异越大，最终 recall score 会偏离；当候选分数接近时会改变排序。
- 后续对齐建议
  - 将 TS 公式改为与 Rust 相同的线性衰减版本，并对 timestamp 解析规则做一致化（Rust 用 rfc3339 解析，失败则当作 14 天前）。

### 4.5 可选服务导致的行为差异（中影响）

- Rust reference
  - `Aura::recall_core` 会在 raw baseline 之后进行 bounded reranking，并执行 finalize 副作用（activate/strengthen/session/audit）。
- TS 当前实现
  - `recallPipeline` 把 embedding/rerank/finalize 全部做成可选服务（Context 提供则执行，不提供则跳过）。
- 影响
  - 在未提供 `BoundedReranker` 与 `RecallFinalizer` 时，TS 输出与 Rust recall_core 的最终输出不一致（更接近 Rust 的 recall_raw）。
- 后续对齐建议
  - 提供默认的 Live Layer：在 core 层默认装配与 Rust 等价的 bounded rerank/finalize（或明确对外区分 recallRaw vs recallCore）。
  - 同时将副作用的落盘（更新 records / session tracker）后置到写入阶段对照测试中。

### 4.6 Record 模型与默认字段不一致（中影响）

- Rust reference
  - `Record` 字段较多，并有默认值/校验（`src/record.rs`、`src/levels.rs`）。
- TS 当前实现
  - `storage/CognitiveRecord.normalizeCognitiveRecord` 只做最小字段兜底（content_type/metadata/connections），其余字段保留 raw JSON（`packages/storage/src/CognitiveRecord.ts`）。
- 影响
  - tags/namespace/source_type/strength 等若缺失或类型不一致，TS 召回的过滤与打分会与 Rust 不一致。
- 后续对齐建议
  - 完整实现 Record schema 的默认值与校验逻辑，并在加载时标准化字段，确保后续 recall 不靠“松散 any”行为。

### 4.7 graph/causal 扩展的输入数据来源不一致（中影响）

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

### 4.8 召回缓存与可观测性缺失（低-中影响）

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

## 5. 当前已存在的对齐基线（减少后续返工）

- `brain.aura` / `index/` / `brain.cog+snap` 的最小读取已具备，且可构建 `RecallView`（TS）。
- TS/Rust parity 测试已建立（覆盖 SDR + tags + ngram 参与 RRF）：
  - Rust 生成 fixture：`src/bin/aura-ts-recall-fixtures.rs`
  - Rust verifier：`src/bin/aura-ts-verify-recall.rs`
  - TS parity：`packages/core/src/Recall.parity.test.ts`

后续对齐工作建议都先通过扩展 parity fixture/断言来推进，而不是仅靠肉眼比对。

