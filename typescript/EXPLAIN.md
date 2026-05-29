# Aura 认知引擎算法详解

本文档全面拆解 Aura TypeScript 端四个核心引擎（Belief / Concept / Causal / Policy）的算法原理，包括数学公式、数据结构、状态机和它们在认知层次中的协同关系。

---

## 总览：五层认知层次结构

```
Record（原始记录）
    ↓ 提取、分桶、聚类
Belief（信念：对 claim 的聚合立场）
    ↓ 抽象、聚类、术语提取
Concept（概念：稳定的抽象）
    ↓ 共现挖掘
Causal Pattern（因果模式：概念间的关联规则）
    ↓ 规则提取
Policy（策略：可操作建议）
```

整个链条由 `MaintenanceService` 在维护周期中**串行+并行**编排，由 `EpistemicRuntime` 提供可观测接口。

---

## 一、BeliefEngine — 信念引擎

BeliefEngine 的目标：把一堆原始 records（可能互相矛盾、互相支持）组织成**对某个 claim 的聚合认识立场**。

### 1.1 核心数据结构

| 结构 | 含义 |
|-----|------|
| **Belief** | 一个"争论话题"，包含多个 competing hypotheses |
| **Hypothesis** | 对该话题的一种可能"真相版本"，由一簇 records 支撑 |
| **BeliefState** | `Resolved` / `Unresolved` / `Singleton` / `Empty` |

### 1.2 算法步骤

#### 步骤 A：Coarse Key 分桶（claim 识别）

把 records 按 `namespace + tags + semantic_type` 分组成"粗桶"，每个桶代表一个**待讨论的 claim**。

提供 **12 种分桶策略**（`CoarseKeyMode`）：

| 模式 | 算法 | 适用场景 |
|-----|------|---------|
| `Standard` | `ns:tag1,tag2:semantic_type` | 默认，精确匹配 |
| `TopOneTag` | 只用第一个 tag | tag 噪声大时 |
| `SemanticOnly` | 只用 `ns:semantic_type` | 忽略 tag 差异 |
| `TagFamily` | 提取 tag 的 family 前缀（`/` 或 `_` 前） | 同族 tag 归一 |
| `TagFamilyAdaptive` | 动态 family 选择 | 自适应密度 |
| `TagFamilyBackoff` | 带回退的 family | 稀疏 tag 回退 |
| `TagFamilyPairBackoff` | 配对 family 回退 | 成对组合 |
| `TagFamilyDenseBackoff` | 密集 family 回退 | 高密度场景 |
| `DualKey` | 全 tags 精确匹配 | 高区分度场景 |
| `NeighborhoodPool` | 前 3 个 tags | 局部上下文 |
| `BridgeKey` | 首 tag + bridge 标记 | 跨域桥接 |
| `SdrTagPool` | tags 按 SDR 排序 | 语义向量驱动 |

```typescript
// Standard 模式示例
claim_key("project-alpha", ["rust", "memory"], "fact")
// → "project-alpha:rust,memory:fact"
```

#### 步骤 B：SDR 子簇拆分（Union-Find）

同一个 coarse bucket 内的 records 可能**在讨论不同子话题**。用 SDR（Sparse Distributed Representation）Tanimoto 相似度进一步拆分：

```
Tanimoto(A, B) = |A ∩ B| / |A ∪ B|
```

- 阈值 `SDR_TANIMOTO_THRESHOLD = 0.6`
- 相似度 ≥ 0.6 的 records 用 **并查集（Union-Find）** 合并到同一子簇
- 每个子簇成为一个独立的 **Hypothesis**

> **为什么用并查集？** records 的相似关系具有传递性，Union-Find 能高效处理 O(n²) 的 pairwise 比较，路径压缩后接近 O(α(n))。

#### 步骤 C：Hypothesis 评分

每个 Hypothesis 从支撑它的 records 中提取 5 个维度，计算综合得分：

| 维度 | 计算方式 | 含义 |
|-----|---------|------|
| **confidence** | records 置信度的平均值 | 来源可靠性 |
| **support_mass** | records strength 之和 | 证据总量 |
| **conflict_mass** | 显式冲突质量之和 | 反对证据 |
| **recency** | `0.5^(age / 7天)` | 指数衰减新近度 |
| **consistency** | `1 / (1 + stddev(confidences))` | 内部一致性 |

**综合得分公式**：

```typescript
supportScore = 1.0 + ln(1.0 + support_mass)
conflictPenalty = ln(1.0 + conflict_mass)
beliefScore = supportScore × confidence × recency × consistency
score = max(beliefScore - λ × conflictPenalty, 0)
// λ = 0.35（冲突惩罚权重）
```

> **设计动机**：对数压缩防止少数高 strength record 主导；冲突惩罚用对数保证惩罚增长放缓；recency 用指数半衰期模拟"记忆消退"。

#### 步骤 D：Belief 状态决议（Winner 选举）

一个 Belief 内的多个 Hypotheses 竞争产生 winner：

```typescript
sorted = hypotheses.sort((a, b) => b.score - a.score)
top1 = sorted[0]
top2 = sorted[1]

ratio = top1.score / top2.score

if (ratio < 1.15 && |top1.score - top2.score| < 0.1) {
    state = Unresolved      // 证据太接近，无法裁决
    winner = null
} else {
    state = Resolved        // top1 胜出
    winner = top1.id
}
```

| 状态 | 条件 |
|-----|------|
| **Empty** | 无 hypotheses |
| **Singleton** | 仅 1 个 hypothesis |
| **Resolved** | 有明确 winner（ratio ≥ 1.15 或分差 ≥ 0.1） |
| **Unresolved** | top2 与 top1 太接近，进入"悬而未决" |

**稳定性（stability）**：winner 连续保持的周期数。每轮维护如果 winner 不变，`stability++`；否则重置为 1。

---

## 二、ConceptEngine — 概念引擎

ConceptEngine 的目标：从**已裁决的稳定 beliefs** 中抽象出更高层的**概念**（concept），类似"从具体案例中提取通用规律"。

### 2.1 核心数据结构

| 结构 | 含义 |
|-----|------|
| **ConceptCandidate** | 一个 concept 候选，包含 core/shell 术语、支撑 beliefs、抽象评分 |
| **ConceptState** | `Stable` / `Candidate` / `Rejected` |

### 2.2 算法步骤

#### 步骤 A：Seed 选择（信念筛选）

从 BeliefEngine 状态中筛选有资格参与概念形成的 beliefs：

```typescript
筛选条件：
  - state === Resolved || Singleton
  - stability >= 2.0      (标准模式)
  - confidence >= 0.55
```

三种 Seed 模式：
- `Standard`：严格阈值（stability ≥ 2.0, confidence ≥ 0.55）
- `Warmup`：宽松稳定性（stability ≥ 1.0）
- `Relaxed`：低置信度门槛（confidence ≥ 0.4）

> **为什么排除 Unresolved beliefs？** 未裁决的信念表示系统对 claim 尚无明确立场，不适合作为概念的基础。

#### 步骤 B：Centroid 构建（SDR 聚合）

对每个 seed belief，收集其所有 hypothesis 下的 prototype records，提取它们的 SDR bits，去重排序后形成该 belief 的**质心向量**：

```typescript
centroid(belief) = dedupSort(
  unionAll(
    belief.hypotheses.map(h => 
      h.prototype_records.map(rid => sdr_lookup.get(rid))
    )
  )
)
```

#### 步骤 C：分区（Partition）

按 `namespace:semantic_type`（或仅 `namespace`）对 seeds 分区，**避免跨域概念混杂**。

分区大小上限 `MAX_PARTITION_SIZE = 80`，超限则按 stability 降序截断。防止 O(n²) 比较爆炸。

#### 步骤 D：Tanimoto 聚类（Union-Find）

在每个分区内，计算 seeds 之间 centroid 的 Tanimoto 相似度：

```typescript
if (tanimoto(centroid_i, centroid_j) >= 0.1) {
    union(i, j)  // 并查集聚类
}
```

阈值 `CONCEPT_SIMILARITY_THRESHOLD = 0.1` 故意设得较低，因为 concept 应该包容一定语义变体。

#### 步骤 E：Core-Shell 术语提取

对每个 belief 簇（cluster），提取支撑 records 的内容中的**高频术语**：

```typescript
core_terms  = terms where doc_frequency >= 0.7   // 核心术语
shell_terms = terms where 0.2 <= doc_frequency < 0.7  // 外围术语
```

过滤条件：
- 长度 ≥ 3
- 去除停用词（the, and, for, with... 等 60+ 英文停用词）
- 小写归一、去除标点

> **Core-Shell 模型**：core 是概念的"必要特征"（几乎所有 records 都有），shell 是"常见但不必要特征"。

#### 步骤 F：抽象评分（Abstraction Score）

每个 concept 候选的综合质量得分：

```typescript
supportNorm = ln(1 + support_mass)
confidence  = avg(belief.confidences)
stability   = avg(belief.stabilities) / (avg_stability + 3.0)  // Sigmoid-like 压缩
cohesion    = avg_pairwise_tanimoto(cluster_centroids)

abstraction_score =
  0.35 × min(supportNorm, 1.0) +
  0.25 × confidence +
  0.20 × stability +
  0.20 × cohesion
```

| 维度 | 权重 | 含义 |
|-----|------|------|
| support | 0.35 | 证据量（对数压缩） |
| confidence | 0.25 | 来源可靠性 |
| stability | 0.20 | 信念稳定性（压缩到 [0,1)） |
| cohesion | 0.20 | 簇内语义紧密度 |

**状态判定**：
```typescript
if (abstraction_score >= 0.75)  state = Stable
else if (score >= 0.50)         state = Candidate
else                            state = Rejected
```

#### 步骤 G：Deterministic ID 生成

使用 `xxhash-wasm` 对 concept key 做哈希，保证相同输入总是产生相同 ID：

```typescript
id = `c-${xxh64(key).toHex().slice(-12)}`
```

---

## 三、CausalEngine — 因果引擎

CausalEngine 的目标：从 concepts 的**共现关系**中挖掘**关联规则**（类似 Apriori / 关联规则挖掘），发现"如果概念 A 出现，概念 B 也倾向于出现"的模式。

### 3.1 核心数据结构

| 结构 | 含义 |
|-----|------|
| **CausalPattern** | 前件概念 → 后件概念的关联规则 |
| **CausalState** | `Candidate` / `Stable` / `Rejected` / `Invalidated` |

### 3.2 算法步骤

#### 步骤 A：构建反向索引

```
record_id → [concept_id_1, concept_id_2, ...]
```

遍历所有 concepts，把每个 concept 覆盖的 record_ids 填入索引。

#### 步骤 B：共现 Pair 挖掘

对每个 record，如果它关联 ≥2 个 concepts，生成所有无序 pair：

```typescript
for record in records:
    concepts = record_to_concepts[record.id]
    if (concepts.length < 2) continue
    for i in 0..concepts.length:
        for j in i+1..concepts.length:
            pair = sort(concepts[i], concepts[j])
            pair_shared_records[pair].add(record.id)
```

#### 步骤 C：Confidence & Lift 计算

对每个共现 pair (A, B)：

```typescript
support = |records where both A and B appear|
confidence = min(1.0, support / |A's records|)
           = P(B | A)  // 看到 A 时看到 B 的条件概率

bProb = |B's records| / avg_records_per_concept
lift = confidence / min(bProb, 1.0)
```

| 指标 | 含义 |
|-----|------|
| **support** | 共现次数（绝对支持度） |
| **confidence** | 条件概率 P(B\|A)，衡量规则可靠性 |
| **lift** | 提升度，>1 表示正相关，=1 表示独立，<1 表示负相关 |

#### 步骤 D：状态判定

```typescript
if (confidence > 0.7)  state = Stable
else                   state = Candidate
```

> **注意**：当前实现是简化版，只处理单前件→单后件（A→B）。Rust 侧可能支持多前件/多后件。

---

## 四、PolicyEngine — 策略引擎

PolicyEngine 的目标：把抽象的因果模式翻译成**可操作的策略提示**（actionable hints），供上层 MCP（Model Context Protocol）消费。

### 4.1 核心数据结构

| 结构 | 含义 |
|-----|------|
| **PolicyHint** | 一个策略提示：条件 → 动作 → 优先级 |
| **PolicyState** | `Candidate` / `Stable` / `Suppressed` / `Rejected` |
| **PolicyActionKind** | `Prefer` / `Recommend` / `VerifyFirst` / `Avoid` / `Warn` |

### 4.2 算法步骤

#### 步骤 A：模式 → 提示映射

对每个 causal pattern：

```typescript
if (pattern.state === "Rejected")     skip
if (pattern.state === "Invalidated")  hint_state = Suppressed
else if (pattern.confidence > 0.7)    hint_state = Stable
else                                  hint_state = Candidate
```

#### 步骤 B：提示构造

```typescript
hint = {
    id:           deterministic_id,
    pattern_id:   pattern.id,
    condition:    `pattern:${pattern.id}`,
    action:       "boost:consequent",      // 默认动作：提升后件
    priority:     round(pattern.confidence × 10),
    confidence:   pattern.confidence,
    state:        hint_state,
}
```

> **当前简化**：所有 hint 的 action 都是 `"boost:consequent"`（当条件满足时提升后件概念的权重）。Rust 侧可能有更丰富的 action 映射。

---

## 五、EpistemicRuntime — 可观测层

EpistemicRuntime 不是"发现引擎"，而是**查询和遥测接口**，让外部系统能 inspection 内部认知状态：

| 方法 | 返回 |
|-----|------|
| `getBeliefs(stateFilter?)` | 所有 beliefs（可按状态过滤） |
| `getBeliefInstabilitySummary()` | 波动率分布（低/中/高三个 band） |
| `findContradictionClusters()` | 矛盾簇（图连通分量） |
| `getConcepts()` / `surfaceConcepts()` | 概念列表 / 表面化概念 |
| `getCausalPatterns()` | 因果模式列表 |
| `getPolicyHints()` / `getPolicyPressureAreas()` | 策略提示 / 压力区域 |
| `getPolicyLifecycleSummary()` | 策略生命周期统计 |

**遥测机制**：内部维护 `Ref.Ref<number>` 计数器，每次查询调用自动更新全局/命名空间/记录级统计。

---

## 六、MaintenanceService — 编排引擎

MaintenanceService 把这四个引擎**串联成一个维护周期**：

```
┌─────────────────────────────────────────────────────────┐
│  Initial Phase: 热点检测、层级稳定性评估、流失分析            │
├─────────────────────────────────────────────────────────┤
│  Decay Phase:   信任衰减、陈旧记录降级                       │
├─────────────────────────────────────────────────────────┤
│  Reflect Phase: 生成反思摘要、发现模式、关键洞察              │
├─────────────────────────────────────────────────────────┤
│  Belief Phase:  update_with_sdr(records, sdr_lookup)     │
│                 → 粗分桶 → SDR子簇 → Hypothesis评分       │
│                 → Belief决议                               │
├─────────────────────────────────────────────────────────┤
│  Concept Phase: discover(belief_state, records, sdr)     │
│                 (与 Causal Phase 并行 via Effect.all)     │
│  Causal Phase:  discover(concept_state, records, sdr)    │
├─────────────────────────────────────────────────────────┤
│  Policy Phase:  discover(causal_state, records)          │
├─────────────────────────────────────────────────────────┤
│  Feedback Audit: 反馈审计、异常检测                        │
├─────────────────────────────────────────────────────────┤
│  Consolidation: 记录合并、簇压缩                           │
├─────────────────────────────────────────────────────────┤
│  Synthesis:     生成趋势快照、维护报告                     │
└─────────────────────────────────────────────────────────┘
```

**关键设计**：
- Concept 与 Causal **并行**执行（`Effect.all`），节省维护周期时间
- 每轮维护**全量重建** belief/concept/causal/policy（不增量累积），保证一致性
- 所有阶段都支持 `EpistemicTrace` 可选追踪，便于调试和审计

---

## 七、算法设计哲学总结

| 设计选择 | 理由 |
|---------|------|
| **Union-Find 聚类** | 处理传递性相似关系，O(α(n)) 近乎常数 |
| **对数压缩** | `ln(1+x)` 防止少数极端值主导，平滑长尾分布 |
| **指数衰减 recency** | 模拟生物记忆的"遗忘曲线"，半衰期 7 天 |
| **Sigmoid-like stability** | `s/(s+3)` 压缩高稳定性值，防止无限增长 |
| **Core-Shell 术语模型** | 区分概念的"必要特征"和"常见特征"，类似经典概念理论 |
| **Confidence/Lift 关联规则** | 直接借用数据挖掘经典算法，可解释性强 |
| **全量重建** | 牺牲效率换取一致性，避免增量更新的状态漂移 |

---

*本文档对应代码版本：`trae/solo-agent-URhtte`（fa8e283）*
