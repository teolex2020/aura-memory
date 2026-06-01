# 外部集成分析 (External Integrations)

**分析日期:** 2026-06-01

## APIs 与外部服务 (APIs & External Services)

**外部 API / SaaS 服务:**
- 未检测到任何外部 HTTP API、REST 服务、或第三方 SaaS 集成
- 项目为纯本地运行，无外部网络依赖

**SDK/Client 依赖:**
- 所有依赖均为本地计算库，无云服务 SDK
- 加密和哈希使用 WASM 库（argon2-wasm-edge、@noble/ciphers、@noble/hashes、xxhash-wasm）
- 代码解析使用本地 Tree-sitter WASM (`web-tree-sitter` + `tree-sitter-wasms`)
- MCP 协议使用 `@mastra/mcp` 实现本地 stdio 传输

## 数据存储 (Data Storage)

**数据库:**
- 无外部数据库（无 PostgreSQL、SQLite、Redis、MongoDB 等）
- 所有持久化基于本地文件系统

**文件存储:**
- 纯本地文件系统
- 数据存储路径: `AURA_BRAIN_PATH` 环境变量指定（默认 `./aura_brain`）
- 存储层: `packages/storage/src/CognitiveStoreFile.ts`（自定义二进制日志结构）

**数据文件格式:**
| 文件 | 路径 | 格式 | 用途 |
|------|------|------|------|
| brain.aura | `{brainPath}/brain.aura` | 自定义二进制 | 核心 Aura 记录（固定结构） |
| brain.cog | `{brainPath}/brain.cog` | 自定义二进制 (COG1) | Cognitive 操作日志（append-only） |
| brain.snap | `{brainPath}/brain.snap` | 自定义二进制 (CSN1) | 快照（压缩日志） |
| beliefs.cog | `{brainPath}/beliefs.cog` | JSON | 信念状态 |
| concepts.cog | `{brainPath}/concepts.cog` | JSON | 概念状态 |
| causal.cog | `{brainPath}/causal.cog` | JSON | 因果模式 |
| policies.cog | `{brainPath}/policies.cog` | JSON | 策略 |
| maintenance_trends.json | `{brainPath}/maintenance_trends.json` | JSON | 维护趋势快照 |
| reflection_summaries.json | `{brainPath}/reflection_summaries.json` | JSON | 反思总结 |

**持久化模式:**
- brain.cog: WAL (Write-Ahead Log) 模式，append-only 写入，支持快照压缩
- JSON 文件: 直接读写完整状态
- 使用 CRC32 校验 (`packages/utils/src/Crc32.ts`)
- 可选加密支持（ChaCha20-Poly1305 认证加密）

**缓存:**
- 无独立缓存服务（如 Redis、Memcached）
- 内存中维护 `searchRecords` Map 作为记录缓存
- Rust 参考实现有 recall cache，TS 侧尚未实现 (`packages/core/src/Aura.ts` 中的 NON-PARITY 标记）

## 认证与身份 (Authentication & Identity)

**身份认证:**
- 无外部身份提供商（无 OAuth、JWT、SSO 等）
- 仅支持可选的密码加密（`AURA_PASSWORD` 环境变量）
- 加密实现位于 `packages/codec/src/Crypto.ts`（Argon2id 密钥派生 + ChaCha20-Poly1305）
- 当前 TS 实现的密码加密尚未完整接入（返回 UnsupportedSurfaceError，见 `packages/core/src/Aura.ts` 的 `open_with_password` 方法）

## 监控与可观测性 (Monitoring & Observability)

**错误追踪:**
- 无外部错误追踪服务（无 Sentry、DataDog 等）
- 错误通过 Effect-TS 类型系统管理 (`Data.TaggedError` 模式）
- MCP 层错误统一序列化为 `McpErrorPayload` 格式 (`packages/mcp/src/runtime.ts`）

**日志:**
- 使用 `console.warn`（语法解析失败相关, `packages/code-extraction/src/extraction/grammars.ts`）
- Effect-TS 内置 `Effect.log` 可用但未广泛使用
- 无结构化日志框架

**指标:**
- 无外部 metrics 收集
- 基本统计通过 `Aura.stats()` / `Aura.insights()` 方法暴露

## CI/CD 与部署 (CI/CD & Deployment)

**托管:**
- 当前为 SDK/库项目，无特定托管平台
- MCP 服务器设计为 stdio 子进程运行，嵌入在 AI 代理进程内

**CI Pipeline:**
- 未检测到 GitHub Actions、CircleCI 等 CI 配置

**部署:**
- 作为 npm workspace 包使用
- MCP 服务器入口: `packages/mcp/src/bin.ts`（Bun/Node.js 均可）

## 环境配置 (Environment Configuration)

**所需环境变量:**
- `AURA_BRAIN_PATH` — 可选的 brain 目录路径，默认值 `./aura_brain`
- `AURA_PASSWORD` — 可选的加密密码（当前 TS 实现未完整支持）

**Secrets 位置:**
- 密码通过环境变量 `AURA_PASSWORD` 注入
- 无 secrets 文件（无 `.env` 文件）
- 加密密钥在内存中派生使用，不持久化

## Webhooks 与回调 (Webhooks & Callbacks)

**入站 Webhook:**
- 未检测到 HTTP webhook 端点

**出站 Webhook:**
- 未检测到出站 webhook 调用

**MCP 协议:**
- 使用 stdio 传输（非 SSE/HTTP 传输）
- 通过 `@mastra/mcp` 实现 `MCPServer.startStdio()` (`packages/mcp/src/server.ts`)
- 标准化 IO: 输入 schema 使用 Zod 定义 (`packages/mcp/src/inventory.ts`)
- 工具列表: 22 个 MCP tools（21 个已实现，1 个 consolidate 标记为 unsupported）

## 代码分析集成 (Code Analysis Integration)

**Tree-sitter 语法支持:**
- 20+ 编程语言 WASM 语法文件
- 支持语言: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, PHP, Ruby, Swift, Kotlin, Dart, Lua/Luau, Scala, Pascal, Objective-C 等
- 文件类型映射: `packages/code-extraction/src/extraction/grammars.ts` 中的 `EXTENSION_MAP`
- 自定义 WASM: Pascal、Scala、Lua、Luau 使用 vendor 版 WASM（避开了 `tree-sitter-wasms` 的 ABI 兼容性问题）

**忽略规则:**
- 使用 `ignore` 包 (^7.0.5) 解析 `.gitignore` 风格规则
- 位置: `packages/code-extraction/src/extraction/index.ts`

---

*集成审计: 2026-06-01*
