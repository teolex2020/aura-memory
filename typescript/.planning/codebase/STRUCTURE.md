# 代码库结构

**分析日期:** 2026-06-01

## 目录布局

```
aura-ts/
├── .claude/                    # Claude AI 辅助工具配置和技能
│   ├── agents/                 # Agent 配置文件
│   ├── commands/               # GSD 命令实现
│   │   └── gsd/               # /gsd-* 命令集
│   ├── get-shit-done/          # GSD 框架核心 (workflows, contexts, templates)
│   ├── hooks/                  # git hooks
│   └── skills/                 # 项目技能定义
│       ├── effect/             # Effect 基础编码规则
│       ├── effect-ts/          # Effect-TS 通用 API 参考
│       ├── effect-project-pattern/  # 本项目 Effect-TS 编码规范
│       ├── contract-interface-pattern/ # 合约接口模式
│       └── improve-codebase-architecture/ # 架构改进指南
├── docs/                       # 项目文档 (中英双语)
│   ├── ARCHITECTURE.md         # 英文架构文档
│   ├── CONFIGURATION.md        # 配置文档
│   ├── DEVELOPMENT.md          # 开发指南
│   ├── GETTING-STARTED.md      # 入门指南
│   ├── TESTING.md              # 测试指南
│   └── zh/                     # 中文翻译版文档
│       ├── ARCHITECTURE.zh.md
│       ├── CONFIGURATION.zh.md
│       ├── DEVELOPMENT.zh.md
│       ├── GETTING-STARTED.zh.md
│       └── TESTING.zh.md
├── packages/                   # 所有 npm workspace 包
│   ├── contract/               # @aura/contract — 合约接口层
│   ├── utils/                  # @aura/utils — 工具函数
│   ├── codec/                  # @aura/codec — 编解码
│   ├── indexing/               # @aura/indexing — 索引引擎
│   ├── storage/                # @aura/storage — 持久化存储
│   ├── belief/                 # @aura/belief — 信念引擎
│   ├── concept/                # @aura/concept — 概念引擎
│   ├── causal/                 # @aura/causal — 因果引擎 (stub)
│   ├── policy/                 # @aura/policy — 策略引擎 (stub)
│   ├── epistemic-runtime/      # @aura/epistemic-runtime — 认知运行时
│   ├── recall/                 # @aura/recall — 召回管线
│   ├── core/                   # @aura/core — 核心外观
│   ├── platform-node/          # @aura/platform-node — Node 平台实装
│   ├── mcp/                    # @aura/mcp — MCP 服务器
│   └── code-extraction/        # @aura/code-extraction — CodeGraph
├── recall_parity/              # Rust 与 TS 召回 parity 测试数据
│   └── index/                  # 索引测试数据集
├── test/                       # 集成测试夹具
│   └── fixtures/               # 测试数据
│       ├── epistemic_belief_v1/  # 信念引擎测试数据
│       ├── minimal_brain/        # 最小脑测试数据
│       ├── minimal_index/        # 最小索引测试数据
│       └── recall_parity/        # 召回 parity 测试夹具
├── .planning/                  # GSD 规划和追踪
│   ├── ROADMAP.md              # 路线图
│   ├── STATE.md                # 项目状态
│   └── phases/                 # 各阶段计划
├── .gsd/                       # GSD 运行时文件
│   ├── graphs/                 # 知识图谱
│   └── runtime/                # 运行时状态
├── .codegraph/                 # CodeGraph 数据库
├── package.json                # 根 package.json (workspaces)
├── tsconfig.json               # TypeScript 配置
├── vitest.config.ts            # Vitest 配置
├── vitest.setup.ts             # Vitest 全局设置
├── AGENTS.md                   # Agent 使用说明 (150KB+)
├── README.md                   # 项目说明 (英文)
├── README.zh.md                # 项目说明 (中文)
├── CLAUDE.md                   # Claude 项目级指令
└── bun.lock                    # Bun lockfile
```

## 目录用途

### 根目录

**`packages/contract/src/`:**
- 用途: 定义所有跨包共享的接口、类型、枚举和错误
- 包含: `*.ts` 文件分别对应各引擎接口 (Belief.ts, Concept.ts, Causal.ts, Policy.ts)、平台接口 (FileRead.ts, FileWrite.ts, Clock.ts, Crypto.ts)、核心类型 (Record.ts, Recall.ts, Sdr.ts, Level.ts)
- 关键文件: `Context.ts` (Tag 工厂), `Errors.ts` (所有 TaggedError), `index.ts` (re-export 所有)

**`packages/core/src/`:**
- 用途: AuraSDK 主入口和编排逻辑
- 包含: `Aura.ts` (主外观类), `Graph.ts` (Rust `graph.rs` 对齐骨架), `DefaultLayer.ts` (Layer 装配), `Recall.ts` (召回编排), `RecallFinalizer.ts`, `RecallReranker.ts`, `MaintenanceService.ts` (~900+ 行)
- 关键文件: `Aura.ts`, `DefaultLayer.ts`

**`packages/mcp/src/`:**
- 用途: MCP (Model Context Protocol) 服务器
- 包含: `server.ts` (MCP 服务器创建), `tools.ts` (工具定义 ~25+ 工具), `runtime.ts` (运行时装配), `inventory.ts` (工具 schema 和 inventory), `bin.ts` (CLI 入口)
- 关键文件: `runtime.ts` (AuraMcpRuntime 和 Layer 装配), `tools.ts` (所有工具注册)

**`packages/recall/src/`:**
- 用途: 多信号召回管线
- 包含: `Pipeline.ts` (管线编排), `Signals.ts` (tag/ngram/sdr/embedding 信号), `RRF.ts` (倒数排序融合), `GraphWalk.ts` (连接图遍历), `CausalWalk.ts` (因果链遍历), `Trust.ts` (信任评分), `SDRInterpreter.ts` (SDR 解释器), `BoundedReranker.ts`, `Trace.ts`, `Types.ts`
- 关键文件: `Pipeline.ts`, `Signals.ts`, `SDRInterpreter.ts`

**`packages/storage/src/`:**
- 用途: 文件系统持久化
- 包含: `CognitiveStoreFile.ts` (brain.cog 日志), `BrainAuraFile.ts` (brain.aura 二进制), `RecallView.ts` (内存视图构建), `BeliefStoreFile.ts`, `ConceptStoreFile.ts`, `CausalStoreFile.ts`, `PolicyStoreFile.ts`, `CognitiveRecord.ts`, `Versioning.ts`, `Backup.ts`, `PersistenceManifest.ts`
- 关键文件: `BrainAuraFile.ts`, `CognitiveStoreFile.ts`, `RecallView.ts`

**`packages/contract/src/`:**
- 子目录: `belief/`, `concept/`, `causal/`, `policy/` (引擎专属类型), `levels/`, `record/`, `relation/`, `sdr/`
- 关键文件: `Context.ts` (Tag 工厂函数), `Errors.ts` (所有 TaggedError), `index.ts` (总出口)

**`packages/code-extraction/src/`:**
- 用途: CodeGraph — 代码知识图谱引擎
- 包含: `extraction/` (tree-sitter 解析), `resolution/` (引用解析 + 20+ 框架), `db/` (SQLite 数据库), `graph/` (图查询), `search/` (搜索), `context/` (上下文构建)
- 这是独立的子系统，与 Aura 核心引擎最小耦合

### 工具目录

**`packages/utils/src/`:**
- 文件: `Bytes.ts`, `Crc32.ts`, `Hex.ts`, `Id12.ts`, `Time.ts`, `path.ts`

**`packages/codec/src/`:**
- 文件: `Binary.ts` (BinaryReader/BinaryWriter), `Bincode.ts`, `Crypto.ts`

**`packages/indexing/src/`:**
- 文件: `Roaring.ts` (RoaringBitmap 封装), `InvertedIndex.ts`, `NGramIndex.ts`, `SynonymRing.ts`

## 关键文件位置

**入口点:**
- `packages/mcp/src/bin.ts`: MCP 服务器 CLI 入口 (`aura-mcp` 命令)
- `packages/core/src/Aura.ts`: Aura SDK 编程入口 (`Aura.open()`, `Aura.store()` 等)
- `packages/core/src/DefaultLayer.ts`: 所有引擎和存储服务的默认 Layer 装配
- `packages/code-extraction/src/index.ts`: CodeGraph 子系统入口

**配置:**
- `package.json`: 根配置 (workspaces, scripts, 共享依赖)
- `tsconfig.json`: TypeScript 编译配置 (paths alias 映射 @aura/* → packages/*/src/index.ts)
- `vitest.config.ts`: Vitest 配置 (resolve.alias 映射)
- `vitest.setup.ts`: 测试全局设置

**核心逻辑:**
- `packages/core/src/Aura.ts`: 主外观类 (~600+ 行) — store, recall, search, explain, maintain
- `packages/core/src/MaintenanceService.ts`: 认知维护管线 (~900+ 行) — 信念/概念/因果/策略各层维护
- `packages/recall/src/Pipeline.ts`: 召回管线编排
- `packages/storage/src/BrainAuraFile.ts`: brain.aura 二进制格式读写
- `packages/mcp/src/tools.ts`: MCP 工具定义 (25+ tools)

**测试:**
- 测试文件 co-located 在 `packages/*/src/*.test.ts` 同目录下
- 集成测试夹具在 `test/fixtures/`
- Parity 测试数据在 `recall_parity/`

## 命名约定

**文件:**
- PascalCase 组件/类: `Aura.ts`, `BeliefEngine.ts`, `BrainAuraFile.ts`, `CognitiveStoreFile.ts`, `SDRInterpreter.ts`
- camelCase 工具/函数: `bytes.ts` 中的 `fixedBytes`, `hex.ts` 中的 `hexEncode`
- 全部测试文件使用 `.test.ts` 后缀 (非 `.spec.ts`)
- Parity 测试文件使用 `.parity.test.ts` 后缀 (如 `Recall.parity.test.ts`)
- 中文测试文件使用 `.zh.test.ts` 后缀 (如 `BeliefEngine.zh.test.ts`)
- 夹具文件使用 `.fixture.test.ts` 后缀 (如 `InvertedIndex.fixture.test.ts`)

**目录:**
- 所有包名 kebab-case: `platform-node`, `epistemic-runtime`, `code-extraction`
- 源文件目录统一用 `src/`
- 子目录使用 camelCase: `contract/src/belief/`, `contract/src/record/`, `extraction/languages/`

**包名 (npm):**
- `@aura/` scope 下: `@aura/contract`, `@aura/core`, `@aura/belief`, `@aura/mcp` 等
- exports 固定为 `"./src/index.ts"` 且 `"type": "module"`

## 新增代码的位置

**新包 (Package):**
- 创建 `packages/<name>/package.json` 并加入根 workspace
- 在 `tsconfig.json` 的 `paths` 和 `vitest.config.ts` 的 `resolve.alias` 添加映射
- 源码放入 `packages/<name>/src/index.ts` 作为出口

**新引擎 (Engine Service):**
- 合约接口: `packages/contract/src/<Name>.ts` (namespace.Interface + Tag)
- 引擎类型: `packages/contract/src/<name>/<Name>Types.ts` (若需要)
- 引擎实现: `packages/<name>/src/<Name>Engine.ts` (implements Interface)
- 存储实现: `packages/storage/src/<Name>StoreFile.ts` (若需要文件持久化)
- Layer 装配: 在 `packages/core/src/DefaultLayer.ts` 中加入 `Layer.mergeAll`
- 测试: `packages/<name>/src/<Name>Engine.test.ts` (co-located)

**新工具函数:**
- 共享工具: `packages/utils/src/<Name>.ts`
- 编解码工具: `packages/codec/src/<Name>.ts`
- 索引工具: `packages/indexing/src/<Name>.ts`
- 更新对应包的 `src/index.ts` 中的 re-export

**新 MCP 工具:**
- Schema 定义和注册: `packages/mcp/src/inventory.ts`
- 工具实现: `packages/mcp/src/tools.ts` (使用 `createTool` 和 zod schema)
- Server 自动通过 `createAuraTools(runtime)` 注册新工具
- 测试: `packages/mcp/src/Invocation.test.ts` 或新 `.test.ts` 文件

**新测试:**
- 单元测试: 放在被测试文件同目录 `*.test.ts`
- 集成测试: `test/` 或 `test/fixtures/`
- Parity 测试: 使用 `*.parity.test.ts` 后缀
- 中文测试: 使用 `*.zh.test.ts` 后缀 (内容为中文，测试相同逻辑)

## 特殊目录

**`node_modules/`:**
- 用途: npm 依赖 (根和子包都有)
- 生成: bun install
- 提交: No

**`.codegraph/`:**
- 用途: CodeGraph SQLite 数据库
- 生成: `codegraph init` 命令
- 提交: No

**`.planning/`:**
- 用途: GSD 规划和追踪文件
- 生成: `/gsd-plan-phase` 和 `/gsd-discuss-phase` 命令
- 提交: Yes (团队可见)

**`.gsd/`:**
- 用途: GSD 运行时状态 (图谱、缓存)
- 生成: GSD 框架自动管理
- 提交: No

**`recall_parity/`:**
- 用途: Rust → TS 召回 parity 测试的索引数据和参考输出
- 生成: Rust 端导出
- 提交: Yes (验证跨语言一致性)

**`test/fixtures/`:**
- 用途: 集成测试用的认知数据快照和夹具
- 生成: 手动创建或测试生成
- 提交: Yes

---

*结构分析: 2026-06-01*
