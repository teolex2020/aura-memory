---
title: Aura 核心 TypeScript 1:1 重写（全量磁盘格式兼容）设计
date: 2026-05-20
status: draft
scope:
  - rust-core-only
  - typescript-port
  - bun-runtime
  - effect-smol
deliverables:
  - typescript/core
  - typescript/mcp
  - byte-level-disk-compat
---

# 目标

在 `typescript/` 目录下用 TypeScript 1:1 重写 Rust 端核心能力，用于学习与研究，并满足以下约束：

- 忽略 `python/` 与 `ui/` 目录
- 仅覆盖：核心库 + MCP stdio server（不实现 HTTP server/dashboard）
- 运行环境：Bun
- 框架偏好：使用 effect-smol 的开发方式完成模块封装、依赖注入、IO 操作与缓存
- 兼容级别：全量磁盘格式兼容（Rust 与 TS 对同一 brain 目录读写互通，字节级一致为准）

# 非目标

- 不追求性能超过 Rust；优先可读、可验证、可对照
- 不在第一阶段实现跨平台（浏览器/Worker）运行
- 不改变 Rust 数据格式或升级版本号（TS 必须跟随现有格式）

# 范围与模块映射

Rust 核心入口结构为 `Aura`，以及其依赖的存储、索引、召回、epistemic stack 与辅助设施。TS 侧将保持同样的边界，但用 effect-smol 进行依赖注入。

## Rust→TS 关键映射

- `Aura`：对外唯一门面（open/store/recall/search/update/delete/maintain/insights 等）→ `typescript/packages/core/src/Aura.ts`
- `Record`：核心数据模型 → `typescript/packages/core/src/model/Record.ts`
- 存储（磁盘格式兼容的最高优先级）：
  - `brain.aura` / `temporal.bin` → `typescript/packages/storage/src/brainAura/*`
  - `brain.cog` / `brain.snap` → `typescript/packages/storage/src/cognitive/*`
  - 备份容器（含整体加密） → `typescript/packages/storage/src/backup/*`
  - 版本化快照与索引 → `typescript/packages/storage/src/versioning/*`
  - 引擎状态文件（beliefs/concepts/causal/policies）→ `typescript/packages/storage/src/engineState/*`
  - canonical/learner 产物（`.aura.syn` / `.aura.learned`）→ `typescript/packages/storage/src/semanticArtifacts/*`
  - `persistence_manifest.json` / maintenance/reflection histories / snapshot files → `typescript/packages/storage/src/misc/*`
- 索引：
  - Roaring 倒排索引：`index_manifest.json` + `sdr.idx` → `typescript/packages/indexing/src/InvertedIndex.ts`
  - NGram/SDR：对齐 Rust 行为 → `typescript/packages/indexing/src/*`
- MCP：
  - `AURA_BRAIN_PATH` / `AURA_PASSWORD` 环境变量解析
  - tools 形状与语义对齐 Rust `mcp.rs` → `typescript/packages/mcp/src/*`

# TypeScript 代码布局（单仓库多 package）

以 workspace 方式组织，确保分层清晰、便于单测与 fixture 对照。

- `typescript/packages/codec`
  - 目标：提供字节级编解码能力（LittleEndian、CRC32、bincode、Roaring 序列化适配、加密封装）
  - 提供统一的 `BinaryReader/BinaryWriter` 抽象
- `typescript/packages/storage`
  - 目标：实现所有落盘文件的读/写/迁移兼容（严格对齐 Rust）
  - 只做“格式与 IO”，不实现上层算法
- `typescript/packages/indexing`
  - 目标：倒排索引（含 roaring bitmap 的 load/save/search）与 SDR/NGram 等索引组件
- `typescript/packages/core`
  - 目标：复刻 Rust 的核心算法与 API surface（Aura/recall/epistemic/maintenance 等）
  - 通过 effect-smol 注入存储、索引、缓存、时间源、随机源、加密实现等
- `typescript/packages/mcp`
  - 目标：stdio MCP server（与 Rust `mcp.rs` 同名 tools、同样参数默认值、同样的输出结构）

# effect-smol 分层设计

目标：让“核心逻辑”对 IO/缓存/时间/随机/加密等依赖保持透明；同时让测试可替换依赖实现以进行字节对照与故障注入。

## 关键 Service/Layer

- `FileSystem`：抽象 `readFile/writeFile/open/seek/flush/syncAll/rename`
- `Clock`：抽象 `now()`（对齐 Rust 的 `SystemTime`/UNIX_EPOCH）
- `Random`：用于 nonce/salt 等（由 crypto 实现内部处理也可）
- `Crypto`：
  - `deriveKeyFromPassword(password, salt16)`
  - `encryptData(plaintext, key32) -> nonce12 + ciphertext+tag`
  - `decryptData(encrypted, key32)`
  - `hmacSha256(data, key32)`
- `Cache`：对齐 Aura 的 recall cache/其他缓存策略（接口先行）
- `Storage`：提供面向 Aura 的高层操作（append/read/list/flush/close）
- `Index`：倒排索引/NGram/SDR 等统一接口

核心 `AuraService` 只依赖这些接口；实现细节由对应 package 提供 Layer。

# 全量磁盘格式兼容清单（必须互通）

本清单以 Rust `src/` 代码检索为准，TS 必须实现同样的序列化/反序列化与文件名规则。

## 主存储与附属文件

- `brain.aura`：Magic `AURA` + `FORMAT_VERSION` + count/created/padding 头部 + 追加记录（LittleEndian）
- `temporal.bin`：`TPL1` + `u8 version=1` + bincode `HashMap<String,String>`，并遵循临时文件原子替换
- `brain.cog`：`COG1` + `u8 version` + `[op u8 | payload_len u32 | crc32 u32 | payload]...`，payload 为 `Record` 的 JSON bytes
- `brain.snap`：`CSN1` + `u8 version` + `log_position u64` + `record_count u32` + repeated `[payload_len u32 | payload]`

## 索引

- `index_manifest.json`：JSON（next_doc_id + id_map）
- `sdr.idx`：重复写入：`u16 bit` + `u64 buf_len` + `roaring bitmap bytes`，其中 bitmap bytes 必须与 Rust roaring crate 的 `serialize_into`/`deserialize_from` 对齐

## 引擎状态与运行时辅助

- `beliefs.cog` / `concepts.cog` / `causal.cog` / `policies.cog`：JSON bytes（`to_vec`/`from_slice`）
- `maintenance_trends.json` / `reflection_summaries.json`：Pretty JSON
- `persistence_manifest.json`：Pretty JSON（需要按 Rust 的归一化逻辑进行读入、校验、必要时回写）
- `*_snapshot_<label>.json`：Aura 快照/回滚文件，命名规则必须一致

## 版本化

- `versions/index.json`：Pretty JSON
- `versions/<id>.snap`：JSON bytes

## 语义工件与学习产物

- `.aura.learned`：`LRN1` + bincode `LearnedCanonicalMap`（临时文件原子替换）
- `.aura.syn`：bincode `HashMap<String,String>`
- `*.toml`：SynonymRing 输入格式（TOML 解析 + `[[groups]] words=[...]`）

## 备份容器

- 备份文件（用户指定 output_path）：
  - `BACKUP_MAGIC(4)` + `version(1)` + `enc_flag(1)` + payload
  - payload：`header_len u32 + header(JSON bytes) + data_len u64 + brain.aura bytes + index_len u64 + brain.idx bytes`
  - 支持整体加密与未加密两种模式，enc_flag 与解密失败策略对齐 Rust

# 依赖策略（允许使用成熟 npm 包）

原则：只要能做到“与 Rust 字节输出一致”，允许使用依赖；否则改为最小自研实现。

优先级与 fallback：

- `crc32fast` → TS 侧使用成熟 CRC32 实现（确保与 Rust crc32fast 输出一致）
- `serde_json` → TS 侧 JSON 需严格确保字段名与数值精度；Record 等结构的 JSON 序列化必须与 Rust 的 serde_json 输出一致（包括可选字段缺省行为）
- `bincode 1.3` → 若找不到与 Rust bincode 1.3 完全兼容的库，则在 `codec` 自研“项目所需类型子集”的 bincode 编解码（覆盖 LearnedCanonicalMap/HashMap/String 等实际落盘结构）
- Roaring bitmap → 优先选能提供 Rust roaring 同款序列化格式的实现；若库的序列化格式不同，则需要实现 Rust roaring 的序列化协议或引入兼容层
- 加密/Argon2/ChaCha20-Poly1305/HMAC-SHA256 → 使用成熟 crypto 库，并通过 fixture 做字节级对照（nonce 前缀、tag 位置、salt 长度等必须一致）

# MCP 设计（core + MCP）

TS MCP server 必须对齐 Rust `mcp.rs`：

- transport：stdio
- 环境变量：
  - `AURA_BRAIN_PATH`（默认 `./aura_brain`）
  - `AURA_PASSWORD`（可选；用于打开加密 brain）
- tools：
  - 至少覆盖 `mcp.json` 中列出的工具：recall/recall_structured/store/store_code/store_decision/search/insights/consolidate/delete/get/maintain
  - 语义与默认值与 Rust 保持一致；返回值结构（JSON 文本）保持一致或可被客户端同等解析

# 兼容性验证策略（强制字节对照）

## Fixture 生成

建立“黄金样本”脑库目录（包括加密与未加密两套），由 Rust 生成：

- 最小集：写入若干 record + 建索引 + 写 temporal + 写 cognitive + 触发一次维护
- 覆盖集：包含 versions、backup、synonym、learner/canonical 等所有落盘路径

## 读兼容测试

- TS 打开 Rust 生成的 brain 目录，逐文件验证：
  - magic/version/header/count 一致
  - 记录总数、关键字段、索引搜索结果一致
  - temporal 链路一致
  - 各引擎状态文件可反序列化且字段一致

## 写兼容测试

- TS 写入/更新/删除若干 record + flush
- Rust 重新打开同目录，验证：
  - 可读、count 变化一致
  - recall/search 结果一致（允许明确约束的非关键排序差异则需在测试中固定）

## MCP 行为对照

同一份 brain 目录下，对同一组 tool 调用：

- Rust MCP 与 TS MCP 的响应可解析且字段一致
- 对文本型输出（recall）可允许“空白/排序/格式”差异，但必须在规格中显式定义容忍度

# 里程碑（阶段性交付）

为降低风险，按“先可读后可写”的节奏交付，但最终目标是全量互通。

- M1：Typescript workspace + effect-smol 分层骨架 + 读取主链路文件（brain.aura / sdr.idx / cognitive / temporal）跑通
- M2：实现写入主链路文件并通过 Rust 回读验证
- M3：补齐全量持久化格式（versions/backup/learner/canonical/persistence_manifest 等）并通过互通测试
- M4：实现 MCP stdio server（tools 覆盖与对照测试）

# 风险与决策

- Roaring 序列化与 bincode 兼容是最高风险点：必须以 fixture 对照来驱动实现
- JSON 字段缺省与数值精度可能导致细微不一致：需要在 TS 侧做严格的序列化策略控制
- 加密部分必须对齐 nonce 前缀与输出结构：以跨语言解密/回读作为唯一验收标准

