---
title: Aura TypeScript 重写工程分层纠偏（effect-smol 风格）
date: 2026-05-20
status: draft
scope:
  - typescript-only
  - packaging
  - effect-context-layering
---

# 背景与问题

当前 `typescript/` 下的实现为了快速对照与验证，出现了以下偏离：

- core/storage/codec 直接引用 `node:*`（平台依赖泄漏）
- 跨 package 采用相对路径互相引用（`../../codec/src/*`），破坏模块边界
- effect 仅在测试中使用断言，并未承担分层与依赖注入职责

这会导致后续功能持续偏离“effect-smol 分层设计”的 spec 目标，因此需要先做工程纠偏，再继续扩展 M3/M4。

# 目标

- 以“中度分层”为边界：先把平台依赖与跨包引用收敛到可控边界；核心算法与数据结构允许暂时保留少量 class/OOP 或同步 API
- 建立两个基础包：
  - `@aura/contract`：只放 Context Tags（依赖契约）
  - `@aura/utils`：只放纯函数工具（无 IO、无 Context）
- 新增一个平台实现包：
  - `@aura/platform-node`：承载 `node:*`/`bun:*` 依赖，并提供 contract 的 Live Layer
- 引用规则：
  - core/storage/codec/indexing/mcp 之间只能通过 `@aura/*` 依赖，不允许跨包相对引用
  - `node:*` 只能出现在 `@aura/platform-node`（以及测试里调用 Rust 对照进程的少量 glue code）

# contract 设计（按只读/仅写入拆分）

为提高可测试性，文件系统按“只读/仅写入”拆为两个 Context。

## FileRead（只读）

能力集合（最小集，按当前需求覆盖）：

- `readFile(path: string): Effect<Uint8Array>`
- `exists(path: string): Effect<boolean>`
- `stat(path: string): Effect<{ size: number }>`

## FileWrite（仅写入 + 随机写）

为支持 `brain.aura` 的 `flush()`（offset=8 写 header.count），需要随机写能力。

- `mkdirp(path: string): Effect<void>`
- `writeFile(path: string, data: Uint8Array): Effect<void>`
- `appendFile(path: string, data: Uint8Array): Effect<void>`
- `writeAt(path: string, offset: number, data: Uint8Array): Effect<void>`
- `fsync(path: string): Effect<void>`

注：M2 的 `BrainAuraFile` 目前用 `openSync/writeSync` 直接操作 fd；纠偏后将迁移到 `FileWrite`，并由 `platform-node` 负责 fd 管理细节（对上层暴露“按 path 写入”的抽象）。

## Crypto（算法实现允许在 codec，但依赖注入由 contract 暴露）

Crypto 作为逻辑依赖从 `@aura/contract` 暴露为 Context：

- `deriveKeyFromPassword(password: string, salt16: Uint8Array): Effect<Uint8Array>`
- `encryptData(plaintext: Uint8Array, key32: Uint8Array, nonce?: Uint8Array): Effect<Uint8Array>`
- `decryptData(encrypted: Uint8Array, key32: Uint8Array): Effect<Uint8Array>`
- `computeHmac(data: Uint8Array, key32: Uint8Array): Effect<Uint8Array>`

实现可复用当前 `@aura/codec` 里的算法代码，但由 `platform-node` 提供 Live Layer，以便测试替换/注入不同实现。

# utils 设计

将重复或易重复的工具抽离到 `@aura/utils`：

- `hexToBytes/bytesToHex`
- `fixedBytes(str, size)`
- 其他“纯函数”工具（不得引入 node/bun API）

# 包管理与导入规范（解决 @aura/* 运行时解析）

目标：vitest/bun 运行时与 tsc 均可稳定解析 `@aura/*`。

- 每个 package 的 `package.json` 必须包含：
  - `name: "@aura/<pkg>"`
  - `type: "module"`
  - `exports: { ".": "./src/index.ts" }`
- vitest 侧增加 `resolve.alias`，将 `@aura/<pkg>` 映射到对应的 `packages/<pkg>/src/index.ts`（避免 Vite 依赖 package build 产物）
- 禁止在包内写 `../../other-package/src/*` 形式的跨包相对导入

# 渐进迁移策略（不阻断现有验证）

1) 先补齐 contract/utils/platform-node 与 alias，保证所有包都能通过 `@aura/*` 引用
2) 将 `codec/storage/core` 内的跨包相对导入替换为 `@aura/*`
3) 将 `node:*` 依赖从 core/storage/codec 收敛到 `platform-node`，并在核心入口（例如 Aura.open）用 `Effect.provide` 注入 Live Layer
4) 现有“跨语言对照测试”允许保留 `spawnSync`（测试 glue），但其余 IO 必须走 `FileRead/FileWrite`

# 验收标准

- tsc：`bun run typecheck` 通过
- vitest：`bun run test` 通过
- grep 规则：
  - `packages/{core,storage,codec}/src` 内不得出现 `node:` 导入（允许测试文件按需存在，但推荐也逐步迁移）
  - 不得出现跨包 `../../<pkg>/src` 引用
- 现有 M1/M2 的字节对照测试仍通过（Crypto oracle + TS 写→Rust 回读）

