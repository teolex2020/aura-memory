# 技术栈分析 (Technology Stack)

**分析日期:** 2026-06-01

## 语言 (Languages)

**主要语言:**
- TypeScript 5.6+ — 全项目使用，目标 ES2022，模块系统 ESNext
- 配置位置: `tsconfig.json`

**次要语言:**
- 未检测到其他编程语言（纯 TypeScript monorepo）

## 运行时 (Runtime)

**环境:**
- Node.js 22+ (@types/node ^22.0.0)
- 同时支持 Bun 运行时（`packages/mcp/src/bin.ts` 使用 `#!/usr/bin/env bun` shebang）

**包管理器:**
- npm Workspaces (monorepo)
- Lockfile: `package-lock.json`

## 框架 (Frameworks)

**核心:**
- Effect-TS v4 (beta.68) — 函数式编程、依赖注入 (Context/Tag/Layer)、错误处理、并发模型 (Fiber/Stream/Schedule)
  - 依赖: `effect@4.0.0-beta.68`
  - 配置: `package.json` 根依赖
  - 编码规范: `.claude/skills/effect/SKILL.md`, `.claude/skills/effect-ts/SKILL.md`

**测试:**
- Vitest 2.x — 测试运行器，配置 `vitest.config.ts`，全局模式 (`globals: true`)，Node 环境
- `@effect/vitest@4.0.0-beta.68` — Effect-TS 集成，提供 `it.effect(...)` / `it.layer(...)` / `it.live(...)` 测试辅助
- 配置位置: `vitest.config.ts`

**构建/开发:**
- TypeScript Compiler (tsc) — 类型检查 (`tsc -p tsconfig.json --noEmit`)
- Vitest 内置 — 开发和测试运行 (无 bundler，直接导入 TS 源码)
- `roaring-wasm` 为预编译 WASM 运行时；Rust 兼容 `xxh3_64` 由 `@aura/utils` 纯 TS 实现提供

## 关键依赖 (Key Dependencies)

**核心库:**
- `effect` (4.0.0-beta.68) — Effect-TS 核心：Effect、Context、Layer、Schema、Stream、Schedule
- `@effect/vitest` (4.0.0-beta.68) — Effect-TS 测试集成

**加密:**
- `argon2-wasm-edge` (^1.0.23) — WASM 版 Argon2id 密码哈希，用于密钥派生
- `@noble/ciphers` (^0.5.3) — ChaCha20-Poly1305 认证加密
- `@noble/hashes` (^1.5.0) — SHA-256、HMAC 哈希

**数据结构与索引:**
- `roaring-wasm` (^1.1.0) — WASM 版 Roaring Bitmap，用于高效稀疏位图操作 (`packages/indexing/src/Roaring.ts`)
- `@aura/utils` `xxh3_64` — Rust `xxhash_rust::xxh3::xxh3_64` 纯 TS 投影，用于核心维护 ID、fingerprint、NGram hash 与 SDR seed parity

**代码提取:**
- `web-tree-sitter` (0.25.10) — WASM 版 Tree-sitter，多语言语法解析
- `tree-sitter-wasms` (^0.1.11) — 预编译多语言 WASM 语法文件（支持 20+ 编程语言）
- `ignore` (^7.0.5) — `.gitignore` 规则匹配

**MCP (Model Context Protocol):**
- `@mastra/core` (^0.21.0) — Mastra 框架核心
- `@mastra/mcp` (^0.13.3) — Mastra MCP 服务器实现
- `zod` (^3.25.76) — Schema 验证，用于 MCP 工具输入定义

## 项目结构 (Monorepo)

**Workspace 包 (`packages/*`):**
| 包名 | 路径 | 用途 |
|------|------|------|
| `@aura/core` | `packages/core` | 核心 Aura 引擎：recall/store/maintenance |
| `@aura/contract` | `packages/contract` | 服务接口定义 (Tag/Interface)、DTO 类型 |
| `@aura/codec` | `packages/codec` | 二进制编码 (Bincode/Binary)、加密原语 |
| `@aura/storage` | `packages/storage` | 持久化存储：CognitiveStoreFile、BrainAura |
| `@aura/indexing` | `packages/indexing` | N-gram 索引、Roaring Bitmap、倒排索引 |
| `@aura/recall` | `packages/recall` | 召回管线：RRF Fusion、SDR 解释器、reranker |
| `@aura/belief` | `packages/belief` | 信念引擎 |
| `@aura/concept` | `packages/concept` | 概念引擎 |
| `@aura/causal` | `packages/causal` | 因果模式引擎 |
| `@aura/policy` | `packages/policy` | 策略引擎 |
| `@aura/epistemic-runtime` | `packages/epistemic-runtime` | 认知运行时（组合上述引擎） |
| `@aura/platform-node` | `packages/platform-node` | Node.js 平台适配层 (FileRead/Write/Clock/Crypto) |
| `@aura/mcp` | `packages/mcp` | MCP 服务器，暴露 Aura 能力给 AI 代理 |
| `@aura/utils` | `packages/utils` | 通用工具函数 (CRC32、Hex、Id12、Time) |
| `@aura/code-extraction` | `packages/code-extraction` | 代码提取与分析 (tree-sitter) |

## 配置 (Configuration)

**环境:**
- 环境变量通过 `process.env` 读取
- 关键环境变量: `AURA_BRAIN_PATH`（brain 目录路径，默认 `./aura_brain`），`AURA_PASSWORD`（可选的加密密码）
- 无 `.env` 文件（环境变量在运行时注入）

**TypeScript 配置 (`tsconfig.json`):**
- `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`
- `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`
- `types: ["node", "vitest/globals"]`
- 所有 `@aura/*` 包通过 `paths` 别名映射

**测试配置 (`vitest.config.ts`):**
- 全局模式，Node 环境
- 使用 resolve alias 映射 `@aura/*` 包路径
- Setup 文件: `vitest.setup.ts`

**Git 忽略 (`.gitignore`):**
- 忽略 `.claude/*`（但保留 `!.claude/skills/` 和 `!.claude/CLAUDE.md`）
- 忽略 `.codegraph/` 和 `recall_parity/`

## 平台要求 (Platform Requirements)

**开发:**
- Node.js 22+
- npm
- TypeScript 5.6+
- Windows/POSIX 均可（使用 `node:fs/promises` 等跨平台 API）

**生产:**
- 当前为 SDK/库项目，无部署目标
- MCP 服务器通过 stdio 协议运行，适用于 AI 代理集成场景
- 纯本地文件系统持久化，无需数据库或云服务

---

*技术栈分析: 2026-06-01*
