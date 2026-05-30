# AuraSDK TypeScript 审查报告

**审查日期:** 2026-05-30  
**审查对象:** `typescript/` workspace  
**读者:** 后续继续推进 TS 端与 Rust 对齐的工程实现者  
**读后应能完成的动作:** 判断当前项目真实完成度，识别最主要的 Rust 偏离点，并按优先级推进修复

---

## 1. 执行结论

当前 TypeScript 端不是早期骨架，而是一个已经完成大量核心迁移工作的多包工程；但它也还没有达到“整体已与 Rust 基本对齐”的状态。

更准确的判断是：

- `Belief / Concept / Causal / Policy` 四个引擎已经做了深入实现，并且存在明确的 parity 审计与阶段化计划资产。
- `core / recall / maintenance / 验证基线 / 文档状态` 仍存在显著断点。
- 因此，项目当前最贴切的标签是：**核心引擎成型，整体验证与主流程闭环未完成**。

---

## 2. 当前项目状态

### 2.1 工程成熟度

项目资产密度较高，已经超出“实验代码”范畴：

- 14 个 workspace 包
- 236 个文件
- 41 个测试文件
- 双语文档集
- 完整的 `.planning/` phase / plan / summary / learnings 资产
- 与 Rust 同仓，便于直接做源码级对照
- 已有多组 fixture，包括 `minimal_brain`、`minimal_index`、`recall_parity`

从包结构看，分层方向是清晰的：

- `@aura/contract` 负责契约与 Tag
- `@aura/platform-node` 负责平台实现
- `@aura/storage` / `@aura/indexing` / `@aura/recall` 负责读取、索引、召回
- `@aura/core` 负责门面与编排
- `@aura/belief` / `@aura/concept` / `@aura/causal` / `@aura/policy` 负责维护链路四层引擎

### 2.2 真实可验证状态

本次审查得到的验证结果如下：

- `bun run typecheck` 当前失败。
  - 直接原因是 `@aura/code-extraction` 使用了 `picomatch`，但包依赖与类型声明未补齐。
- `bun run test` 在当前 Windows 环境下默认配置会 OOM。
  - 问题更像是默认并发/内存配置问题，而不是所有测试逻辑本身错误。
- 限制为单 worker 后，关键局部测试可通过：
  - `MaintenanceService.test.ts`: 20/20
  - `Aura.test.ts`: 2/2
  - `InvertedIndex.searchScored.test.ts`: 7/7
- `Recall.parity.test.ts` 本次未能重新确认。
  - 失败原因不是 TS 断言本身，而是 Rust 侧在当前机器上因页文件/内存限制无法完成编译。

结论：**“工程结构已成型”是真的，但“验证基线稳定可复用”还不是真的。**

---

## 3. 与 Rust 的主要偏离

本节只列高影响、会改变行为判断的偏离点。

### 3.1 MaintenanceService 仍是编排骨架，不是 Rust 等价实现

这是当前最大的系统级偏离。

TypeScript 侧的维护编排虽然已经存在完整文件与测试，但大量关键依赖仍是占位：

- `SDRInterpreter = unknown`
- `TagTaxonomy = unknown`
- `NGramIndex = unknown`
- `CognitiveStore = unknown`
- `BackgroundBrain = unknown`

同时，大量阶段函数仍保留 `Full algorithm deferred per D-07` 标记，尤其包括：

- `runInitialPhases`
- `buildSdrLookup`
- `runPostDiscoveryPhases`
- `buildReflectionSummary`
- `apply_layer_feedback`

而在 Rust 侧，这些依赖和阶段并不是占位，而是维护链路的真实输入。

影响：

- 当前 TS `runMaintenance()` 可以返回结构化报告，但并不代表它已经复刻 Rust 的维护行为。
- 目前更接近“维护编排接口已经存在”，而不是“维护算法已经落地”。

### 3.2 Aura 写路径仍是简化版

`Aura.store/update/delete/connect` 当前可以工作，但仍不是 Rust 全链路行为。

关键差异：

- `store()` 当前只追加写入 `brain.cog`
- 尚未同步维护 `brain.aura` 与 `index/`
- record id 仍使用随机 `id12()`，而不是 Rust 对齐的稳定生成策略

影响：

- 写入后的读取与召回可以在最小 happy path 上运行
- 但长期状态、索引一致性、跨语言持久化闭环仍不完整

### 3.3 Recall 只有部分 parity，而非完整 parity

#### NGram 信号仍未对齐

TS 目前使用 trigram Jaccard 的内存实现。  
Rust 使用的是 MinHash + LSH 的 `NGramIndex`，并且有 `with_seed()` 支持可重复验证。

影响：

- 候选集合不同
- 相似度分布不同
- 排序稳定性不同

这是 recall parity 中最应该优先消除的算法偏差。

#### SDR 信号细节仍未对齐

TS `collectSdr()` 已经做了 `aura_id -> record_id` 映射与 Tanimoto 打分，但仍明确未把 inverted index 返回的 overlap 融入权重。

影响：

- 候选排序可能与 Rust 不一致
- RRF 融合后的最终结果也可能偏移

#### structured / full / explainability 表面仍未到 Rust 面

当前 TS：

- `recall()` 返回的是简化的 scored IDs
- `recall_structured()` 近似为 records 结果
- `recall_full()` 仍退化到 structured
- `explain_recall()` / `explain_record()` 仍是 defect

影响：

- 对外 API 名称已存在
- 但能力表面并未达到 Rust 的说明性与解释性输出

### 3.4 BoundedReranker 与 RecallFinalizer 仍是简化实现

当前 `BoundedReranker`：

- 只是对 top 20 做一个位置 boost

当前 `RecallFinalizer`：

- 只是内存内累加 activation
- 尚未把 finalize 副作用接回存储层

影响：

- recall pipeline 已支持可插拔接口
- 但默认 live 行为仍不是 Rust 语义

---

## 4. 已有成果，不应低估

虽然存在上述偏离，但已有成果是实质性的，不应把项目误判为“只有计划没有实现”。

### 4.1 引擎层已经做了深度迁移

`AUDIT-DIFF.md` 记录了针对四个引擎的系统性偏离审计，并将状态更新为 `14/14 complete`。

这份结论不等于“整个 TS 端已完成”，但它说明：

- 引擎算法对齐不是空谈
- 相关阶段确实执行过较深入的 grep-verified parity 工作
- 维护链路的核心 domain 实现不是 stub 状态

### 4.2 索引语义部分已经对齐

`InvertedIndex.searchScored` 已经有独立测试覆盖，且单 worker 下本次验证通过。

这说明索引层至少有一部分已经从“概念正确”进展到了“边界条件有明确回归”。

### 4.3 contract / layer / Effect 约束已经形成项目风格

从 `contract`、`platform-node`、`DefaultLayer`、`Optional.serviceOption` 的使用可以看出，这个项目已经不是随手写的 TS port，而是有明确工程规范的移植工程。

---

## 5. 项目资产盘点

### 5.1 强资产

- Rust 源码同仓
  - 可直接 grep `aura.rs`、`recall.rs`、`maintenance_service.rs`、`ngram.rs`
- Phase 规划和 learnings 完整
  - 适合新 agent 快速接手
- fixture 已建立
  - `minimal_brain`
  - `minimal_index`
  - `recall_parity`
- `Agents.md` 约束明确
  - 对分层、注释、Effect 约束、Rust 对齐优先级都写得很清楚

### 5.2 弱资产

- 根级验证基线不稳定
  - `typecheck` 当前不是绿色
  - `test` 默认模式会 OOM
- 文档状态漂移
  - 架构文档仍把某些引擎写成 stub
  - 规划状态又把整体完成度写得偏乐观
- 本地工作区偏脏
  - 当前存在本地 skill、debug 目录、parity 目录等未清理资产

---

## 6. 文档与状态的一致性问题

这部分风险不影响运行时行为，但会持续误导后续实现者。

### 6.1 架构文档落后于代码

当前架构文档仍把：

- Causal engine
- Policy engine
- Epistemic runtime

描述为 stub 或 unimplemented。

这已经不符合代码现实。

### 6.2 状态文档过于乐观

`.planning/STATE.md` 当前宣称：

- Phase 6 complete
- 90% progress

但同一份状态资产也承认：

- MaintenanceService 仍有 zombie types 和 D-07 延期标记
- cross-engine non-parity 仍在 backlog
- discovery full algorithm 仍 deferred

更关键的是，根级 `typecheck` 仍红。

### 6.3 审计文档覆盖范围容易被误读

`AUDIT-DIFF.md` 的“14/14 fixed”只覆盖四个引擎，不覆盖：

- `@aura/core`
- `@aura/recall`
- `@aura/storage` 的所有写路径闭环
- 整体验证环境

因此这份文档是有效的，但其结论不能外推到整个 TS 端。

---

## 7. 项目内 skill 的适配性评估

### 7.1 明显有帮助的 skill

#### `effect-project-pattern`

这是本项目最有价值的本地 skill。

原因：

- 直接贴合本项目 `Effect v4 beta.68`
- 约束了 `namespace.Interface`、`Layer.effect`、`serviceOption`、`Ref.Ref`
- 还固化了本项目已经踩过的坑

它不只是“介绍 Effect”，而是在替项目保存工程记忆。

#### `contract-interface-pattern`

与当前 contract 层的演进方向高度一致，适合继续用于统一服务接口模式。

#### `effect-ts`

作为通用 API 速查有帮助，但应当次于项目特有约束。

#### `improve-codebase-architecture`

对后续清理 `MaintenanceService`、压缩简化实现与真实 seam 之间的摩擦有帮助。

### 7.2 需要修正的 skill

#### `effect`

这个 skill 内容里提到：

- `.opencode/references/effect-smol`
- `packages/opencode/test/lib/effect.ts`

这些都不是当前仓库的真实上下文。

结论：

- 这个 skill 不是完全没价值
- 但它包含明显跨项目残留，容易把后续 agent 引到错误路径
- 需要修订，至少去掉与本仓库无关的引用

---

## 8. 推荐修复计划

以下排序按“阻塞面 + 影响范围 + 返工收益”确定。

### 优先级 1：先修验证基线

目标：让“能验证”重新成为真实状态，而不是文档承诺。

应做事项：

- 修复 `@aura/code-extraction` 的 `picomatch` 依赖与类型问题
- 恢复根级 `bun run typecheck`
- 调整默认 Vitest 并发/worker 配置，避免当前 Windows 环境下默认 OOM
- 把单 worker 成功路径整理成项目认可的回退方案

为什么先做：

- 没有稳定验证基线，后续所有 parity 修复都会退化为“局部感觉正确”
- 这是所有后续工作的地基

完成标准：

- `bun run typecheck` 绿色
- `bun run test` 至少在默认受支持配置下可稳定运行

### 优先级 2：把 MaintenanceService 从骨架补成真实实现

目标：消除当前最大的系统级 Rust 偏离。

应做事项：

- 替换 `unknown` 占位类型
- 去掉 `undefined as never` 注入
- 逐步落地 `runInitialPhases`
- 落地 `buildSdrLookup`
- 落地 `runPostDiscoveryPhases`
- 接入真实 `apply_layer_feedback`

为什么先做：

- 这是 TS 端最明显的“看起来完成，实际上没闭环”的区域
- 它直接影响 maintenance、长期状态和四层引擎如何真正串起来

完成标准：

- `runMaintenance()` 不再依赖 stub 注入
- 所有核心 phase 使用真实依赖运行

### 优先级 3：实现 Rust 等价的 NGramIndex

目标：消除 recall 中最高影响的算法偏差。

应做事项：

- 在 TS 侧实现 MinHash + LSH 版本的 `NGramIndex`
- 明确测试用 seed 策略
- 用 fixture / verifier 重新做 query 输出对照

为什么先做：

- 当前 trigram Jaccard 与 Rust 的 NGram 行为不在一个级别上
- 这会持续污染 recall parity 结论

完成标准：

- TS NGram 查询行为与 Rust verifier 在固定 seed 下可对照

### 优先级 4：补齐 recall 剩余非对齐细节

目标：把 recall 从“主要流程可跑”推进到“与 Rust 同行为”。

应做事项：

- 把 overlap 引入 `collectSdr` 排序/权重
- 对齐 `collectNgram` 的排序与 tie-break
- 对齐 `collectTags` 的候选聚合与性能语义
- 把 `BoundedReranker` 从 demo 版升级为 Rust 语义版
- 把 `RecallFinalizer` 接回真实持久化路径

为什么排在 NGram 之后：

- NGram 偏差更粗、更基础
- 先修大偏差，再修细部排序差异更高效

完成标准：

- recall parity 测试可以稳定运行
- 偏差从“候选集不同”下降为“少量边界排序差异”或完全消除

### 优先级 5：清理文档与状态漂移

目标：让项目叙述与项目现实重新一致。

应做事项：

- 更新架构文档中的 stub 描述
- 收敛 README 对“已完成能力”的措辞
- 调整 `.planning/STATE.md` 的进度表达，使之反映真实验证状态
- 明确 `AUDIT-DIFF.md` 的覆盖边界

为什么不能一直拖：

- 文档漂移会误导下一个实现者
- 会反复制造错误优先级和错误完成判断

完成标准：

- 文档、状态、代码三者不再互相矛盾

---

## 9. 建议的推进顺序

建议按以下顺序执行，不建议跳步：

1. 修复验证基线
2. 补实 MaintenanceService
3. 落地 Rust 等价 NGramIndex
4. 收敛 recall 剩余非对齐点
5. 回写文档和状态资产

这个顺序的核心逻辑是：

- 先恢复“能验证”
- 再修最大的系统级偏离
- 再修最大的算法级偏离
- 最后收敛叙述层资产

---

## 10. 最终判断

如果只看代码量和包结构，这个项目已经很成熟。  
如果只看 README 和部分 phase 状态，又会误以为几乎收尾。  
如果只看 `MaintenanceService` 和 recall 的若干关键点，又会误以为还停留在 stub 期。

这三种看法都不完整。

最准确的判断是：

**AuraSDK TypeScript 端已经完成了大量核心迁移，尤其是四层引擎与分层约束；但它距离“Rust 等价实现完成”仍差一段关键闭环，主要缺口集中在验证基线、MaintenanceService、NGram parity、recall 细节和文档状态一致性。**

这意味着下一阶段不需要“重做架构”，而需要：

- 修正完成度判断
- 恢复稳定验证
- 对准剩余高影响偏离点做收口

