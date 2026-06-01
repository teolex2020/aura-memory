<!-- refreshed: 2026-06-01 -->
# 架构分析

**分析日期:** 2026-06-01

## 系统概述

AuraSDK 是一个认知架构库，为 AI Agent 提供记忆、信念形成和召回 (recall) 能力的脚手架。它采用**分层认知层级** (layered cognitive hierarchy) 架构，原始文本记录经过五层抽象递进：Record → Belief → Concept → Causal → Policy。整个 TypeScript 实现基于 Effect-TS (v4 beta.68) 生态系统，使用 Tag/Layer 依赖注入管理所有 I/O 边界，使系统具备可测试性、可组合性和跨运行时可移植性。

```text
+-------------------------------------------------------------+
|                   应用层 (Application)                        |
|  @aura/mcp (MCP Server)          @aura/code-extraction       |
|  @aura/platform-node (Node I/O)  (CodeGraph 代码知识图谱)     |
+---------------------+---------------------------------------+
                      |
+---------------------v---------------------------------------+
|               编排层 (Orchestration)                          |
|  @aura/core (Aura facade, DefaultLayer, Maintenance)         |
+-----+---------+--------+--------+--------+------------------+
      |         |        |        |        |
+-----v-+ +----v---+ +--v---+ +--v---+ +-v------------------+
| belief | |concept| |causal| |policy| | epistemic-runtime  |
| Engine | |Engine | |Engine| |Engine| | (Inspection/Trace) |
| Store  | |Store  | |Store | |Store | +--------------------+
+----+---+ +----+--+ +--+---+ +--+---+
     |          |        |        |
+----v----------v--------v--------v-----------------------------+
|             召回层 (Recall/Retrieval)                         |
|  @aura/recall (Pipeline, Signals, RRF, GraphWalk, SDR)       |
+-------+------------------------------------------------------+
        |
+-------v------------------------------------------------------+
|             存储层 (Storage/Persistence)                      |
|  @aura/storage (brain.cog, brain.aura, brain.snap)           |
|  @aura/indexing (InvertedIndex, RoaringBitmap, NGramIndex)   |
|  @aura/codec (Binary Reader/Writer, Crypto)                  |
|  @aura/utils (id12, crc32, hex, time)                        |
+-------+------------------------------------------------------+
        |
+-------v------------------------------------------------------+
|             合约层 (Contracts / Interfaces)                   |
|  @aura/contract (类型定义, Service Tags, 错误类型)            |
+--------------------------------------------------------------+
```

## 组件职责

| 组件 | 职责 | 文件 |
|------|------|------|
| `@aura/contract` | 定义所有服务接口 (Tag)、数据类型、错误类型、工具函数 | `packages/contract/src/` |
| `@aura/utils` | 基础工具函数：id12 生成、CRC32、Hex 编码、时间 | `packages/utils/src/` |
| `@aura/codec` | 二进制序列化/反序列化、加解密 | `packages/codec/src/` |
| `@aura/indexing` | 倒排索引、RoaringBitmap、NGram 索引、同义词环 | `packages/indexing/src/` |
| `@aura/storage` | 文件存储引擎：brain.cog(事件日志)、brain.aura(二进制记录)、brain.snap(快照) | `packages/storage/src/` |
| `@aura/belief` | 信念引擎：声明分组、假设解析、赢家选取 | `packages/belief/src/` |
| `@aura/concept` | 概念引擎：SDR 聚类、抽象评分、表层接口 | `packages/concept/src/` |
| `@aura/causal` | 因果模式发现引擎 (stub) | `packages/causal/src/` |
| `@aura/policy` | 策略提示和生命周期管理 (stub) | `packages/policy/src/` |
| `@aura/epistemic-runtime` | 认知检查接口、跟踪、Telemetry | `packages/epistemic-runtime/src/` |
| `@aura/recall` | 召回管线：信号收集、RRF 融合、GraphWalk、CausalWalk、SDR 解释器、Trust 排序 | `packages/recall/src/` |
| `@aura/core` | Aura 外观类、DefaultLayer 装配、MaintenanceService、Recall 编排 | `packages/core/src/` |
| `@aura/platform-node` | Node.js 平台实现：FileRead、FileWrite、Clock、Crypto | `packages/platform-node/src/` |
| `@aura/mcp` | MCP (Model Context Protocol) 服务器 | `packages/mcp/src/` |
| `@aura/code-extraction` | CodeGraph 代码知识图谱 (tree-sitter 解析, SQLite 存储) | `packages/code-extraction/src/` |

## 模式概述

**总体架构:** 分层认知层级 + Effect-TS Tag/Layer 依赖注入

**关键特征:**
- **合约接口三段式**：每个引擎服务遵循 `contract 定义接口 → engine 实现 → Live Layer 装配` 的结构
- **依赖注入反转**：所有 I/O 边界 (FileRead, FileWrite, Clock, Crypto) 通过 `@aura/contract` 中的 Tag 定义，由 `@aura/platform-node` 提供 Node 实现，应用入口通过 `Layer.mergeAll` 装配
- **Effect 函数式编程**：使用 `Effect.gen` 编排副作用，使用 `Data.TaggedError` 定义类型安全的错误
- **命令查询分离**：存储层使用 append-only 日志 (`brain.cog`) + 快照 (`brain.snap`) 模式
- **测试友好**：测试文件与源码 co-located，通过 Layer 替换实现依赖 mock

## 层级详解

### 合约层 (Contract Layer)
- **用途:** 定义所有跨包的类型、服务接口 (Tag)、错误类型
- **位置:** `packages/contract/src/`
- **包含:** Context (Tag 工厂), Errors (Data.TaggedError), Record/Recall/Query 类型, 引擎接口 (BeliefEngine, ConceptEngine 等), 平台接口 (FileRead, FileWrite, Clock, Crypto)
- **依赖:** Effect
- **被使用:** 所有其他包

### 基础工具层 (Utilities Layer)
- **用途:** 提供基础工具函数
- **位置:** `packages/utils/src/`, `packages/codec/src/`
- **包含:** id12 生成、CRC32、Hex 编解码、时间、二进制序列化、Bincode、Crypto (加解密)
- **依赖:** `@aura/contract` (仅 codec)

### 索引层 (Indexing Layer)
- **用途:** 提供全文搜索和 SDR 索引支持
- **位置:** `packages/indexing/src/`
- **包含:** RoaringBitmap (基于 roaring-wasm), InvertedIndex, NGramIndex, SynonymRing
- **依赖:** `@aura/contract`, `@aura/utils`

### 存储层 (Storage Layer)
- **用途:** 持久化认知记录到文件系统
- **位置:** `packages/storage/src/`
- **包含:** CognitiveStoreFile (brain.cog), BrainAuraFile (brain.aura), CognitiveRecord, Versioning, Backup, View 构建
- **依赖:** `@aura/contract`, `@aura/codec`, `@aura/utils`, `@aura/indexing`

### 认知引擎层 (Cognitive Engine Layer)
- **用途:** 实现信念、概念、因果、策略四层认知推理
- **位置:** `packages/belief/src/`, `packages/concept/src/`, `packages/causal/src/`, `packages/policy/src/`
- **包含:** 各引擎的实现类 (XxxImpl implements Xxx.Interface) 以及对应的 Store 文件实现
- **依赖:** `@aura/contract`, `@aura/storage`

### 认知运行时层 (Epistemic Runtime Layer)
- **用途:** 提供认知状态的只读检查接口 (Inspection) 和事件追踪 (Trace)
- **位置:** `packages/epistemic-runtime/src/`
- **包含:** EpistemicRuntimeImpl, EpistemicTrace 实现, Telemetry 计数器
- **依赖:** `@aura/contract`, `@aura/concept`, `@aura/policy`

### 召回层 (Recall Layer)
- **用途:** 实现多信号召回管线
- **位置:** `packages/recall/src/`
- **包含:** Pipeline (召回管线编排), Signals (信号收集: tag, ngram, sdr, embedding), RRF (倒数排序融合), GraphWalk (图连接遍历), CausalWalk, Trust (信任评分), SDRInterpreter
- **依赖:** `@aura/contract`, `@aura/indexing`

### 编排层 (Orchestration Layer)
- **用途:** 作为 AuraSDK 的外观和装配器
- **位置:** `packages/core/src/`
- **包含:** Aura (主外观类), DefaultLayer (Layer 装配), Recall (召回编排), RecallFinalizer, RecallReranker, MaintenanceService
- **依赖:** 所有其他 `@aura/*` 包

### 平台层 (Platform Layer)
- **用途:** 提供 Node.js 平台的 I/O 实现
- **位置:** `packages/platform-node/src/`
- **包含:** NodeFileRead, NodeFileWrite, NodeClock, NodeCrypto
- **依赖:** `@aura/contract`

### 应用/集成层 (Application/Integration Layer)
- **用途:** 对外提供 AI Agent 集成接口
- **位置:** `packages/mcp/src/`, `packages/code-extraction/src/`
- **包含:** MCP 服务器 (stdio), CodeGraph 代码知识图谱引擎
- **依赖:** `@aura/core`, `@aura/contract` (mcp 还依赖 @mastra/mcp)

## 数据流

### 主要请求路径 — 存储记录 (Store Record)

1. 外部调用 `Aura.store(content, options)` (`packages/core/src/Aura.ts`)
2. Aura 外观类验证记录并调用 `storeRawRecordsWithConnections`
3. 记录写入 `CognitiveStoreFile.appendStore` 到 `brain.cog`（append-only 日志）
4. 记录同时也写入 `BrainAuraFile.appendRecord` 到 `brain.aura`（二进制格式，含 SDR 位图索引）
5. 返回 Record 对象

### 主要请求路径 — 召回记录 (Recall)

1. 外部调用 `Aura.recall(query, options)` (`packages/core/src/Aura.ts`)
2. `Recall.recallScored` (`packages/core/src/Recall.ts`) 基于 `RecallView`（内存视图）构建
3. `RecallViewLive` (`packages/storage/src/RecallView.ts`) 从 `brain.cog`/`brain.snap` 加载所有记录到内存
4. 召回管线 (`packages/recall/src/Pipeline.ts`) 执行：
   - **信号收集** (Signals): tag 匹配 → ngram 相似度 → SDR 稀疏匹配 → embedding 查询
   - **RRF 融合** (Reciprocal Rank Fusion): 将多信号结果融合为单一排序
   - **GraphWalk**: 通过记录间的 connections 扩展上下文
   - **CausalWalk**: 因果链扩展
   - **Trust 加权**: 基于来源权威度、新鲜度、基础信任分加权
   - **可选 BoundedRerank**: belief/concept/causal/policy 重排序
5. 可选 `RecallFinalizer` 持久化召回元数据

### MCP 服务器入口

1. `packages/mcp/src/bin.ts` → `startStdio(env)` → `openAuraRuntime(env)` (`packages/mcp/src/runtime.ts`)
2. `openAuraRuntime` 解析环境变量（`AURA_BRAIN_PATH`, `AURA_PASSWORD`）
3. 构建 `nodeLayer(brainPath)` = `NodeFileReadLive + NodeFileWriteLive + NodeClockLive + NodeCryptoLive`
4. 装配 `Aura.open(brainPath)` 或 `Aura.open_with_password(brainPath, password)`
5. 创建 `MCPServer` (`packages/mcp/src/server.ts`) 并注册工具 (`createAuraTools`)
6. 通过 stdio 监听 MCP 协议请求

### CodeGraph 子系统

1. `packages/code-extraction/src/index.ts` 的 `CodeGraph` 类提供独立的知识图谱功能
2. 使用 tree-sitter 解析源代码 → SQLite 存储节点和边 → 提供图查询 API
3. 包含多语言支持 (20+ 种语言) 和框架感知的引用解析 (React, Express, Laravel, NestJS 等)
4. 这是独立的子系统，与 Aura 认知引擎通过 `@aura/contract` 的最小类型共享连接

## 关键抽象

### 合约接口模式 (Contract Interface Pattern)
- **用途:** 将 Tag class 与接口类型合并到同一个命名空间下
- **示例:**
  - `packages/contract/src/Belief.ts` → `namespace Belief { interface Interface }` + `class Belief extends Tag(...)`
  - `packages/contract/src/Concept.ts`, `Causal.ts`, `Policy.ts` 同理
- **实现方:**
  - `packages/belief/src/BeliefEngine.ts` → `class BeliefEngineImpl implements Belief.Interface`
- **文档规则:** JSDoc 写在 contract 侧（对 LSP 可见），实现侧只保留实现标记
- **详细规范:** 见 `.claude/skills/contract-interface-pattern/SKILL.md`

### 可选服务注入 (serviceOption)
- **用途:** 横切关注点（trace, rerank, finalize）使用可选注入，核心依赖使用强制注入
- **定义:** `packages/contract/src/Optional.ts`
- **行为:** 服务未提供时静默跳过，不影响主流程

### Aura 外观类 (Aura Facade)
- **用途:** 对外暴露的 main API，封装所有内部复杂度
- **位置:** `packages/core/src/Aura.ts`
- **模式:** 通过 Effect 进行静态方法调用，内部使用 `DefaultLayer` 装配所有依赖
- **入口方法:** `open()`, `open_with_password()`, `store()`, `recall()`, `search()`, `explain()`, `maintain()`

### DefaultLayer
- **用途:** 装配所有认知引擎和存储服务的默认实现
- **位置:** `packages/core/src/DefaultLayer.ts`
- **模式:** `Layer.mergeAll(RecallViewLive(brainDir), BeliefStoreLive(brainDir), BeliefEngineLive, ...)` 
- **职责:** 使用 `Layer.provide(platform)` 将 Node 平台实现注入

### 主要错误类型
- **定义:** `packages/contract/src/Errors.ts`
- **模式:** `Data.TaggedError("ErrorName")<{ readonly field: type }>`
- **关键错误:** FileReadError, FileWriteError, JsonParseError, CryptoError, FileFormatError, EmbeddingQueryError, RerankError, FinalizeError, RecordValidationError, RecordNotFoundError

## 入口点

**MCP 服务器入口:**
- 位置: `packages/mcp/src/bin.ts`
- 触发: CLI 执行 `aura-mcp`
- 职责: 启动 MCP stdio 服务器，监听 AI Agent 请求

**Aura SDK 编程入口:**
- 位置: `packages/core/src/Aura.ts` (Aura 类)
- 触发: 第三方代码 `import { Aura } from "@aura/core"`
- 职责: 提供 store/recall/search/explain/maintain 等主要 API

**Test 入口:**
- 位置: `vitest.config.ts` (根目录)
- 触发: `bun run test` / `vitest`
- 配置: globals, node environ, alias 映射

## 架构约束

- **依赖注入:** 所有 I/O 必须通过 Tag/Layer 注入，不得直接使用 Node API
- **单线程:** Effect-TS 运行在单线程事件循环上，无工作线程
- **合约不可变:** `@aura/contract` 的公开类型一旦发布不应破坏性修改
- **Record 类型约束:** `content` 最大 100KB，`tags` 最多 50 个
- **Level 枚举只读:** `Level.Working / Decisions / Domain / Identity` 四层，严格按升序使用

## 反模式

### 实现侧重复 JSDoc

**表现:** 在 engine 实现类中重复合约接口的 JSDoc
**问题:** JSDoc 维护两个副本，容易过期，且 LSP 已从 contract 侧提供文档
**正确做法:** 实现侧只保留 `SIMPLE IMPLEMENTATION` / `NON-PARITY` / `UNIMPLEMENTED` / `TODO` 标记

### Effect.gen 内使用 this

**表现:** 在 `Effect.gen(function* () { this.method() })` 中直接使用 `this`
**问题:** generator 函数中 `this` 不指向实例，导致运行时错误
**正确做法:** 在 generator 外 `const self = this` 捕获引用

### 未标记的 API 差异

**表现:** Rust 参考代码和 TS 实现之间的行为差异未标记
**问题:** 导致 parity 测试失败时难以定位根因
**正确做法:** 使用 `// NON-PARITY` 注释标记已知差异，并在测试中使用 `parity.skip` 组

## 错误处理

**策略:** 使用 Effect-TS 的类型安全错误通道 (E channel) + `Data.TaggedError` 标签错误

**模式:**
- 可恢复业务错误 → `Effect.fail(new XxxError({ ... }))` (类型安全)
- 不可恢复缺陷 → `Effect.die(new Error("..."))` (不污染 E 通道)
- 外部异常 → `Effect.try({ try: () => ..., catch: (cause) => new XxxError({ cause }) })`
- 精确捕获 → `Effect.catchTag("FileReadError", err => ...)`

## 横切关注点

**日志:** 使用 Effect-TS 的 `Effect.log` 和 `Effect.logDebug`，无第三方日志库
**验证:** `packages/contract/src/record/Record.ts` 中的 `validateRecordStoreInput` 函数
**追踪:** `@aura/epistemic-runtime` 的 `EpistemicTrace` 可选服务，记录召回和检修事件
**认证:** 无身份认证层 (MCP 服务器依赖外部身份验证)
---

*架构分析: 2026-06-01*
