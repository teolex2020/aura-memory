<!-- generated-by: gsd-doc-writer -->

# 架构

## 系统概览

AuraSDK 是一个认知架构库，将记忆、信念形成和召回建模为分层管道。它摄入原始文本记录到文件支持的事件日志（`brain.cog`）中，在 `brain.aura` 中导出 SDR（稀疏分布式表示）神经签名，构建用于快速检索的倒排索引，并运行多层认知推理 —— 从信念聚类到概念发现，再到因果分析和策略形成。TypeScript 实现面向 Effect-TS 生态，使用 Tag/Layer 依赖注入管理所有 I/O 边界，使其可测试、可组合、可跨运行时移植。

主要的架构风格是**分层认知层次**配合**Effect 管理的依赖注入**。每个涉及文件系统、时钟或加密的操作都通过 `@aura/contract` 中定义的服务接口（Tag），由 `@aura/platform-node`（Node.js）提供具体实现，并通过 `@aura/core` 组装在一起。

## 认知层次

记录流经五个逐步升高的抽象层级：

```
原始文本  --->  Record  --->  Belief  --->  Concept  --->  Causal Pattern  --->  Policy
                 |               |              |                |                   |
           brain.cog       belief engine    concept engine    causal engine     policy engine
          (追加日志)    (声明分组,        (SDR 聚类,       (存根 --          (存根 --
                          假设消解)         抽象评分)        未实现)            未实现)
```

| 层级 | 包 | 数据模型 | 成熟度 |
|------|---------|-----------|----------|
| 1. Record | `@aura/contract` | `Record`（id、content、tags、connections、SDR bits） | 完整 |
| 2. Belief | `@aura/belief` | `Belief` / `Hypothesis`（声明分组、优胜者消解） | 完整 |
| 3. Concept | `@aura/concept` | `ConceptCandidate`（对信念的稳定抽象） | 完整 |
| 4. Causal | `@aura/causal` | 因果模式发现 | 存根（未实现） |
| 5. Policy | `@aura/policy` | 策略提示和生命周期管理 | 存根（未实现） |

## 包依赖图

```
                    +------------------+
                    |  @aura/contract  |  <-- 类型、服务标签、错误
                    +--------+---------+
                             |
          +------------------+-------------------+
          |                  |                   |
  +-------v--------+  +-----v------+  +---------v----------+
  |  @aura/utils   |  | @aura/codec|  | @aura/epistemic-   |
  |  id12, crc32,  |  | 二进制     |  | runtime (trace +    |
  |  hex, time     |  | Reader/    |  | runtime 存根)       |
  +----------------+  | Writer,    |  +--------------------+
                      | 加密       |
                      +-----+------+
                            |
          +-----------------+-----------------+
          |                                   |
  +-------v--------+                 +--------v--------+
  | @aura/indexing |                 | @aura/storage   |
  | InvertedIndex  |                 | brain.cog,      |
  | RoaringBitmap  |                 | brain.aura,     |
  +-------+--------+                 | brain.snap,     |
          |                          | 引擎清单        |
          |                          +--------+--------+
          |                                   |
          +-----------------+-----------------+
                            |
             +--------------+--------------+
             |              |              |
     +-------v------+ +----v-----+ +-----v------+
     | @aura/belief  | |@aura/    | |@aura/causal|
     | BeliefEngine  | |concept   | |CausalEngine|
     | BeliefStore   | |Concept   | |CausalStore |
     +-------+-------+ |Engine    | +-----+------+
             |         |Concept   |       |
             |         |Store     |       |
     +-------v------+ +----+-----+ +-----v------+
     | @aura/recall  |           | @aura/policy |
     | Pipeline,     |           | PolicyEngine |
     | Signals, RRF, |           | PolicyStore  |
     | GraphWalk     |           +-------------+
     +-------+------+
             |
     +-------v------+
     | @aura/core   |
     | Aura 外观,   |
     | DefaultLayer |
     +-------+------+
             |
     +-------v----------+
     | @aura/platform-  |
     | node             |
     | NodeFileRead,    |
     | NodeFileWrite,   |
     | NodeClock,       |
     | NodeCrypto       |
     +------------------+
```

依赖方向：箭头从依赖者指向被依赖者。`@aura/contract` 是所有包的基础。`@aura/core` 是顶层外观，通过 `DefaultLayer` 将所有组件组装在一起。`@aura/platform-node` 提供具体 I/O 实现，仅在应用入口点被依赖。

## 核心抽象

### Effect-TS Tag / Layer 模式

所有 I/O 边界和引擎服务在 `@aura/contract` 中定义为 Effect-TS `Tag` 实例。Tag 将服务接口声明为类型化形状；具体实现通过 `Layer` 在应用边界提供。

```typescript
// 合约层：定义服务形状 (packages/contract/src/FileRead.ts)
export class FileRead extends Tag("aura.contract.FileRead")<
  FileRead,
  {
    readFile: (path: string) => Effect.Effect<Uint8Array, FileReadError>
    exists: (path: string) => Effect.Effect<boolean, FileReadError>
    stat: (path: string) => Effect.Effect<FileStat, FileReadError>
  }
>() {}

// 平台层：提供实现 (packages/platform-node/src/NodeFileRead.ts)
export const NodeFileReadLive = Layer.succeed(FileRead, {
  readFile: (p) => Effect.tryPromise(() => fs.readFile(p).then(b => new Uint8Array(b))),
  exists: (p) => Effect.tryPromise(() => fs.stat(p).then(() => true).catch(() => false)),
  stat: (p) => Effect.tryPromise(() => fs.stat(p).then(s => ({ size: s.size })))
})
```

此模式用于：`FileRead`、`FileWrite`、`Clock`、`Crypto`、`BeliefEngine`、`BeliefStore`、`ConceptEngine`、`ConceptStore`、`CausalEngine`、`CausalStore`、`PolicyEngine`、`PolicyStore`、`RecallViewTag`、`EmbeddingStore`、`BoundedReranker`、`RecallFinalizer`、`TrustConfigTag`、`EpistemicRuntime`、`EpistemicTrace`。

`serviceOption` 工具函数（`packages/contract/src/Optional.ts`）允许可选服务解析 —— 下游代码可以检查 `Option.isSome(service)` 来根据服务是否可用来分支处理，召回管道即用此模式处理可选的嵌入、重排序和信任配置服务。

### Aura 外观（`packages/core/src/Aura.ts`）

主要的公开 API。提供 `Aura.open(path)` 和 `Aura.open_with_password(path, password?)` 从 brain 目录实例化系统。所有操作返回 `Effect` 值，使其惰性、可组合、可测试：

- `store(content, options?)` —— 追加新记录到认知日志
- `update(recordId, patch)` —— 将部分更新作为追加事件写入
- `delete(recordId)` —— 追加删除墓碑
- `connect(fromId, toId, weight?)` —— 用带权重的连接链接两条记录
- `recall(query, options?)` —— 运行多信号召回管道
- `explain_recall(...)` / `explain_record(...)` —— 可解释性存根
- `get_entity_digest(...)` / `link_entities(...)` —— 实体/关系图谱存根

### Engine / Store 对

每个认知层级遵循一致的 Engine + Store 模式：

| 层级 | Engine（Tag） | Store（Tag） | 实现 | 存储文件 |
|------|-------------|------------|----------------|-------------|
| Belief | `BeliefEngine` | `BeliefStore` | `packages/belief/src/BeliefEngine.ts` | `beliefs.cog` |
| Concept | `ConceptEngine` | `ConceptStore` | `packages/concept/src/ConceptEngine.ts` | `concepts.cog` |
| Causal | `CausalEngine` | `CausalStore` | `packages/causal/src/CausalEngine.ts` | `causal.cog` |
| Policy | `PolicyEngine` | `PolicyStore` | `packages/policy/src/PolicyEngine.ts` | `policy.cog` |

Engine 包含业务逻辑（聚类、发现、消解）。Store 使用 `@aura/storage` 中的 `CogJsonSnapshotFile` 工具处理序列化/反序列化，该工具通过临时文件 + rename 模式原子地写入 JSON。

### DefaultLayer（`packages/core/src/DefaultLayer.ts`）

将所有 engine 和 store 组装成一个合并的 Layer。接收 `brainDir` 字符串并实例化：

```
RecallViewLive(brainDir)    -- 构建 RecallView（记录 + 索引 + aura 头）
BeliefStoreLive(brainDir)   -- 信念持久化
BeliefEngineLive             -- 信念引擎（内存中）
ConceptStoreLive(brainDir)  -- 概念持久化
ConceptEngineLive            -- 概念引擎（内存中）
CausalStoreLive(brainDir)   -- 因果持久化（存根）
CausalEngineLive             -- 因果引擎（存根）
PolicyStoreLive(brainDir)   -- 策略持久化（存根）
PolicyEngineLive             -- 策略引擎（存根）
EpistemicRuntimeLive         -- 认知运行时（存根）
EpistemicTraceLive           -- 通过 Effect.log 进行 trace/日志
```

### InvertedIndex（`packages/indexing/src/InvertedIndex.ts`）

核心搜索数据结构。将 SDR 位索引（u16）映射到 Roaring Bitmap 文档集合。实现了与 Rust 参考对齐的稀有度排序搜索算法：

1. 对每个查询 SDR 位，查找其文档 bitmap
2. 按 bitmap 大小升序排列（最稀有位优先，最具选择性）
3. 最多处理 `maxBits` 个 bitmap（128/256/512，取决于 `topK`）
4. 统计每个文档在已处理 bitmap 中的重叠数量
5. 按 `minOverlap` 过滤，按计数值降序排列，截断到 `topK * 10`

持久化为两个文件：`index_manifest.json`（ID 映射）和 `sdr.idx`（二进制位到 bitmap 索引）。

### 召回管道（`packages/recall/src/Pipeline.ts`）

多信号召回系统，融合来自独立检索信号的结果：

1. **SDR 信号**（`Signals.collectSdr`）：通过 `SDRInterpreter` 将文本转换为 SDR，然后用 Tanimoto 相似度评分进行倒排索引搜索
2. **N-Gram 信号**（`Signals.collectNgram`）：对记录内容进行三元组 Jaccard 模糊匹配
3. **标签信号**（`Signals.collectTags`）：对标签集合进行 Jaccard 相似度计算
4. **嵌入信号**（`Signals.collectEmbedding`）：可选的外部嵌入服务
5. **RRF 融合**（`RRF.rrfFuse`）：倒数排序融合（K=60），合并排序列表并归一化
6. **图遍历**（`GraphWalk.graphWalk`）：2 跳连接图扩展，阻尼因子 0.6，最小分数 0.05
7. **因果遍历**（`CausalWalk.causalWalk`）：沿 `caused_by_id` 链表追踪，最大深度 3，衰减权重
8. **信任评分**：从 `TrustConfig` 应用来源信任度、新近度提升和半衰期衰减
9. **可选重排序器**（`BoundedReranker`）：可插拔重排序服务
10. **可选终结器**（`RecallFinalizer`）：召回后钩子（如日志记录、会话跟踪）

### 二进制编解码器（`packages/codec`）

提供用于读写二进制文件格式（`brain.cog`、`brain.snap`、`brain.aura`、`sdr.idx`）的 `BinaryReader` 和 `BinaryWriter`。还包含加密原语：基于 `@noble/ciphers` 和 `argon2-wasm-edge` 的 `encryptData`、`decryptData`、`deriveKeyFromPassword`、`computeHmac`。

## 数据流：记录创建

```
1. 应用调用 Aura.store("内容文本", { tags: [...], namespace: "default" })
2. Aura.store:
   a. 调用 Clock.nowSeconds() 获取时间戳
   b. 通过 @aura/utils id12() 生成 12 字符 ID
   c. 构造完整的 Record 对象及默认值
   d. 在 brainDir 打开 CognitiveStoreFile
   e. 追加 OP_STORE (0x01) 条目到 brain.cog:
      [op: u8][payload_len: u32le][crc32: u32le][JSON payload]
   f. 刷新（fsync）brain.cog
3. brain.aura 不更新（简化实现）
4. index/ 不更新（索引在维护周期中进行）
```

## 数据流：召回

```
1. 应用调用 Aura.recall("查询文本", { topK: 10, namespaces: ["default"] })
2. 从 Layer 解析 RecallViewTag：
   a. loadCognitiveRecords(dir) -- 读取 brain.cog + brain.snap 构建 Map<string, CognitiveRecord>
   b. readBrainAuraFile(dir) -- 读取 brain.aura 获取 SDR 头（每个 aura_id 的 sdr_indices）
   c. InvertedIndex.load(dir/index/) -- 加载 index_manifest.json + sdr.idx
   d. 构建 ngramIndex、tagIndex、auraIndex
3. recallPipeline(query, options):
   a. collectSdr(view, sdr, query, topK, namespaces):
      - SDRInterpreter.textToSdr(query) 将文本转换为 SDR 位数组
      - InvertedIndex.searchScored(bits, topK*2, 1) 查找匹配的文档 ID
      - auraIndex 将 aura ID 映射到 record ID
      - auraHeaders 提供 sdr_indices 用于 Tanimoto 相似度评分
   b. collectNgram(view, query, topK, namespaces):
      - 对查询文本计算三元组
      - 与预构建的记录内容三元组签名匹配
      - 按 Jaccard 相似度返回 topK 条记录
   c. collectTags(view, query, topK, namespaces):
      - 将查询分词为小写标签
      - 按 Jaccard（标签交集 / 标签并集）评分记录
   d. （可选）collectEmbedding(view, EmbeddingStore, query, topK, namespaces):
      - 委托给外部嵌入服务
   e. rrfFuse([sdrRanked, ngramRanked, tagRanked, embeddingRanked?]):
      - 倒数排序融合：score = sum(1 / (K + rank_i)) 每个结果列表
      - 对理论最大值进行归一化
4. filterByStrengthAndNamespace(view, fused, minStrength, namespaces)
5. graphWalk(view, matched, minStrength, namespaces):
   - 从匹配记录连接进行 2 跳扩展
   - 每跳阻尼因子 0.6，最低分数阈值 0.05
   - 最多 30 条扩展记录
6. causalWalk(view, matched, minStrength, namespaces):
   - 沿 caused_by_id 链表追踪，最大深度 3
   - 衰减公式：score * 0.8 * 0.9^depth
7. applyRecencyScoring(view, scored, topK, nowSec, trustConfig):
   - 每个分数乘以 record.strength * computeEffectiveTrust()
   - 按最终分数排序，截断到 topK
8. （可选）BoundedReranker.rerank(scored, query)
9. （可选）RecallFinalizer.finalize(scored, sessionId)
10. 返回 RecallScored: Array<[score: number, recordId: string]>
```

## 目录结构

```
typescript/
├── packages/
│   ├── contract/          # 类型定义、服务 Tags、错误类、枚举
│   │   └── src/
│   │       ├── Belief.ts          # BeliefEngine/BeliefStore Tag + 实现类型
│   │       ├── belief/BeliefTypes.ts  # Belief、Hypothesis、BeliefState 类型
│   │       ├── Causal.ts          # CausalEngine/CausalStore Tag + 实现类型
│   │       ├── Clock.ts           # Clock 服务（nowSeconds）
│   │       ├── Concept.ts         # ConceptEngine/ConceptStore Tag + 实现类型
│   │       ├── concept/ConceptTypes.ts  # ConceptCandidate、ConceptState
│   │       ├── Context.ts         # Effect-TS Tag 辅助
│   │       ├── Crypto.ts          # Crypto 服务 Tag（加解密/hmac）
│   │       ├── EpistemicRuntime.ts # EpistemicRuntime Tag
│   │       ├── EpistemicTrace.ts  # EpistemicTrace Tag（event/span）
│   │       ├── Errors.ts          # 统一错误类型（TaggedError）
│   │       ├── FileRead.ts        # FileRead 服务 Tag
│   │       ├── FileWrite.ts       # FileWrite 服务 Tag
│   │       ├── Optional.ts        # serviceOption 辅助
│   │       ├── Policy.ts          # PolicyEngine/PolicyStore Tag + 实现类型
│   │       ├── Recall.ts          # RecallViewTag、EmbeddingStore、BoundedReranker
│   │       ├── record/Record.ts   # Record、StoreOptions、UpdateOptions 类型
│   │       ├── relation/Relation.ts # RelationEdge、EntityDigest
│   │       └── sdr/Sdr.ts         # Sdr、SdrLookup 类型
│   │
│   ├── utils/             # 零依赖工具函数
│   │   └── src/
│   │       ├── Bytes.ts           # Buffer 工具（fixedBytes）
│   │       ├── Crc32.ts           # CRC32 校验和，用于日志完整性
│   │       ├── Hex.ts             # 十六进制编解码
│   │       ├── Id12.ts            # 12 字符 nanoid 风格 ID 生成器
│   │       ├── Time.ts            # nowSecs() 辅助
│   │       └── path.ts            # 路径工具
│   │
│   ├── codec/             # 二进制序列化和加密原语
│   │   └── src/
│   │       ├── Binary.ts          # BinaryReader / BinaryWriter
│   │       ├── Bincode.ts         # Bincode 序列化
│   │       └── Crypto.ts          # 加解密/密钥派生/hmac
│   │
│   ├── indexing/          # 基于 Roaring Bitmap 的倒排索引
│   │   └── src/
│   │       ├── InvertedIndex.ts   # SDR 位 → 文档集索引
│   │       └── Roaring.ts         # Roaring Bitmap 封装（roaring-wasm）
│   │
│   ├── storage/           # 基于文件的持久化层
│   │   └── src/
│   │       ├── Backup.ts                   # 备份工具
│   │       ├── BeliefStoreFile.ts          # 信念状态持久化（beliefs.cog）
│   │       ├── BrainAura.ts                # brain.aura 文件读取器
│   │       ├── BrainAuraFile.ts            # brain.aura 二进制格式
│   │       ├── CausalStoreFile.ts          # 因果状态持久化
│   │       ├── CogJsonSnapshotFile.ts      # 原子 JSON 快照辅助
│   │       ├── Cognitive.ts                # brain.cog 二进制格式解码器
│   │       ├── CognitiveRecord.ts          # 记录加载器（cog + snap）
│   │       ├── CognitiveStoreFile.ts       # brain.cog 追加日志写入器
│   │       ├── ConceptStoreFile.ts         # 概念状态持久化
│   │       ├── PersistenceManifest.ts      # Schema 版本清单
│   │       ├── PolicyStoreFile.ts          # 策略状态持久化
│   │       ├── RecallView.ts               # RecallView 构建器（记录 + 索引）
│   │       ├── Temporal.ts                 # 时间工具
│   │       └── Versioning.ts               # 数据版本管理逻辑
│   │
│   ├── belief/            # 信念引擎（认知层级第 2 层）
│   │   └── src/
│   │       ├── BeliefEngine.ts    # 声明分组、假设形成、信念消解
│   │       └── BeliefStore.ts     # 持久化适配器，封装 BeliefStoreFile
│   │
│   ├── concept/           # 概念引擎（认知层级第 3 层）
│   │   └── src/
│   │       ├── ConceptEngine.ts   # 从信念聚类中发现概念
│   │       └── ConceptStore.ts    # 持久化适配器，封装 ConceptStoreFile
│   │
│   ├── causal/            # 因果引擎（第 4 层 -- 存根）
│   │   └── src/
│   │       ├── CausalEngine.ts    # 存根（所有方法返回 UnimplementedError）
│   │       └── CausalStore.ts     # 持久化适配器
│   │
│   ├── policy/            # 策略引擎（第 5 层 -- 存根）
│   │   └── src/
│   │       ├── PolicyEngine.ts    # 存根（所有方法返回 UnimplementedError）
│   │       └── PolicyStore.ts     # 持久化适配器
│   │
│   ├── recall/            # 召回管道（多信号检索）
│   │   └── src/
│   │       ├── Pipeline.ts        # 主 recallPipeline 编排器
│   │       ├── Signals.ts         # SDR、N-Gram、标签、嵌入信号收集器
│   │       ├── RRF.ts             # 倒数排序融合
│   │       ├── GraphWalk.ts       # 连接图扩展（2 跳，带阻尼）
│   │       ├── CausalWalk.ts      # 因果链遍历（caused_by_id）
│   │       ├── SDRInterpreter.ts  # 文本到 SDR 编码
│   │       ├── Trust.ts           # 带新近度衰减的信任评分
│   │       ├── Types.ts           # RecallPipelineOptions、Scored、RankedList
│   │       └── Errors.ts          # SdrInterpreterError
│   │
│   ├── core/              # 顶层外观和组装
│   │   └── src/
│   │       ├── Aura.ts            # Aura 主类（open、store、update、delete、recall、connect）
│   │       ├── Recall.ts          # recallScored / recallRecords Effect 封装
│   │       └── DefaultLayer.ts    # 所有 engine/store layer 的 Layer.mergeAll
│   │
│   ├── platform-node/     # Node.js 平台实现
│   │   └── src/
│   │       ├── NodeFileRead.ts    # 通过 Effect.tryPromise 调用 fs.readFile / fs.stat
│   │       ├── NodeFileWrite.ts   # fs.writeFile / fs.appendFile / fs.mkdir / fs.sync
│   │       ├── NodeClock.ts       # nowSecs 委托给 @aura/utils
│   │       └── NodeCrypto.ts      # Crypto 委托给 @aura/codec 原语
│   │
│   ├── epistemic-runtime/ # 认知运行时和追踪
│   │   └── src/
│   │       ├── EpistemicRuntime.ts # 存根（所有方法返回 UnimplementedError）
│   │       ├── EpistemicTrace.ts   # 基于 Effect.log 的结构化追踪输出
│   │       └── index.ts
│   │
│   └── code-extraction/   # 独立代码分析工具（不在核心认知管道中）
│       └── src/
│           ├── extraction/        # 基于 Tree-sitter 的代码提取（20+ 语言）
│           ├── resolution/        # 导入解析和框架检测
│           ├── graph/             # 代码图谱遍历
│           ├── db/                # SQLite 存储适配器
│           ├── search/            # 查询解析
│           └── context/           # 上下文格式化器
│
├── package.json           # 根工作区配置（pnpm workspaces）
├── pnpm-workspace.yaml    # pnpm 工作区定义
├── tsconfig.json          # TypeScript 配置
└── vitest.config.ts       # Vitest 测试运行配置（隐含）
```

## 文件格式

### brain.cog（认知事件日志）

```
[Magic: "COG1" (4 bytes)]
[Version: u8 (2)]
-- 每个条目重复 --
[Opcode: u8]     -- 0x01 = Store, 0x02 = Update, 0x03 = Delete
[PayloadLen: u32le]
[CRC32: u32le]   -- payload 的 CRC32
[Payload: bytes] -- Store/Update 为 JSON，Delete 为 12 字节定长字符串 ID
```

### brain.snap（认知快照）

```
[Magic: "CSN1" (4 bytes)]
[Version: u8 (2)]
[LogPosition: u64le]  -- 快照时刻 brain.cog 中的字节偏移
[RecordCount: u32le]
-- 重复 RecordCount 次 --
[Length: u32le]
[JSON payload: bytes]
```

### brain.aura（SDR 神经签名）

```
[Magic: "AURA" (4 bytes)]
[Version: u32le]
[Count: u64le]
[Created: f64le]  -- Unix 时间戳
[Reserved: 40 bytes]
-- 重复 Count 次 --
[Id: 32 bytes, 定长字符串]
[DNA: 16 bytes, 定长字符串]
[Timestamp: f64le]
[Intensity: f32le]
[Stability: f32le]
[DecayVelocity: f32le]
[Entropy: f32le]
[SdrCount: u16le]
[TextLen: u32le]
[EncryptedFlag: u8]
[SDR indices: u16le * SdrCount]
[Text: bytes * TextLen]
```

### sdr.idx（倒排索引二进制）

```
-- 每个 SDR 位重复 --
[BitIndex: u16le]
[PayloadSize: u64le]
[Roaring Bitmap 序列化: bytes * PayloadSize]
```

## 架构决策

**追加式事件溯源。** 所有记录的变更（store、update、delete）都作为有序事件追加到 `brain.cog`。当前状态通过从上次快照位置重放日志重建。每个条目上的 CRC32 校验和确保完整性。

**基于 SDR 的索引。** 记录通过 `brain.aura` 中存储的稀疏分布式表示位索引进行索引，并通过 Roaring Bitmap 倒排索引映射。这实现了通过 Tanimoto（Jaccard）相似度的快速近似搜索，而无需密集嵌入作为硬性要求。

**Effect-TS 用于依赖注入。** Effect-TS Tag/Layer 系统将业务逻辑与平台 I/O 解耦。`Aura` 类在 effect 类型中要求 `FileRead | FileWrite`，但绝不直接导入 `node:fs`。测试提供 mock 层；生产使用 `@aura/platform-node`。这使得未来可移植到 Deno、Bun 或浏览器环境（配合相应的存储后端）。

**带 Rust 对等标注的简化实现。** 许多方法标记为 `SIMPLE IMPLEMENTATION` 并引用相应的 Rust 源码行。这些实现提供了正常路径上的功能行为，同时将边缘情况的完整对等推迟（加密、高级索引、可解释性）。存根引擎（`CausalEngine`、`PolicyEngine`、`EpistemicRuntime`）返回 `UnimplementedError`，使缺失的能力明确可见而非静默成功。
