# @aura/platform-node（Task 3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `typescript/packages/platform-node` 新增 Node 平台实现包，为 `@aura/contract` 的 FileRead / FileWrite / Clock / Crypto 提供 Live Layer，并保证 `bun run typecheck` 通过。

**Architecture:** 每个能力在独立文件中以 `Layer.succeed(<Tag>)(impl)` 导出 Live Layer。IO 统一使用 `node:fs/promises` 并通过 `Effect.tryPromise` 包装；时钟使用 `Effect.sync`；加密能力复用 `@aura/codec/Crypto` 并按同步/异步分别使用 `Effect.sync` / `Effect.tryPromise` 包装。

**Tech Stack:** Bun、TypeScript、Effect（Context/Layer）。

---

## File Map

- Create: `/workspace/typescript/packages/platform-node/package.json`
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileRead.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeClock.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeCrypto.ts`
- Create: `/workspace/typescript/packages/platform-node/src/index.ts`

---

### Task 1: 新建 @aura/platform-node 包与导出入口

**Files:**
- Create: `/workspace/typescript/packages/platform-node/package.json`
- Create: `/workspace/typescript/packages/platform-node/src/index.ts`

- [ ] **Step 1: 创建 package.json**

写入 `/workspace/typescript/packages/platform-node/package.json`：

```json
{
  "name": "@aura/platform-node",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: 创建 index.ts**

写入 `/workspace/typescript/packages/platform-node/src/index.ts`：

```ts
export * from "./NodeFileRead"
export * from "./NodeFileWrite"
export * from "./NodeClock"
export * from "./NodeCrypto"
```

---

### Task 2: NodeFileReadLive（node:fs/promises + Effect.tryPromise）

**Files:**
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileRead.ts`

- [ ] **Step 1: 写入 NodeFileRead.ts**

写入 `/workspace/typescript/packages/platform-node/src/NodeFileRead.ts`：

```ts
import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileRead } from "../../contract/src/FileRead"

export const NodeFileReadLive = Layer.succeed(FileRead)({
  readFile: (path) => Effect.tryPromise(() => fs.readFile(path).then((b) => new Uint8Array(b))),
  exists: (path) => Effect.tryPromise(() => fs.stat(path).then(() => true).catch(() => false)),
  stat: (path) =>
    Effect.tryPromise(() =>
      fs.stat(path).then((s) => ({
        size: s.size
      }))
    )
})
```

---

### Task 3: NodeFileWriteLive（node:fs/promises + Effect.tryPromise）

**Files:**
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`

- [ ] **Step 1: 写入 NodeFileWrite.ts**

写入 `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`：

```ts
import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileWrite } from "../../contract/src/FileWrite"

export const NodeFileWriteLive = Layer.succeed(FileWrite)({
  mkdirp: (path) => Effect.tryPromise(() => fs.mkdir(path, { recursive: true }).then(() => undefined)),
  writeFile: (path, data) => Effect.tryPromise(() => fs.writeFile(path, data).then(() => undefined)),
  appendFile: (path, data) => Effect.tryPromise(() => fs.appendFile(path, data).then(() => undefined)),
  writeAt: (path, offset, data) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(path, "r+")
      try {
        await fd.write(data, 0, data.byteLength, offset)
      } finally {
        await fd.close()
      }
    }),
  fsync: (path) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(path, "r+")
      try {
        await fd.sync()
      } finally {
        await fd.close()
      }
    })
})
```

---

### Task 4: NodeClockLive（Effect.sync）

**Files:**
- Create: `/workspace/typescript/packages/platform-node/src/NodeClock.ts`

- [ ] **Step 1: 写入 NodeClock.ts**

写入 `/workspace/typescript/packages/platform-node/src/NodeClock.ts`：

```ts
import { Effect, Layer } from "effect"
import { Clock } from "../../contract/src/Clock"

export const NodeClockLive = Layer.succeed(Clock)({
  nowSeconds: () => Effect.sync(() => Date.now() / 1000)
})
```

---

### Task 5: NodeCryptoLive（包装 @aura/codec/Crypto）

**Files:**
- Create: `/workspace/typescript/packages/platform-node/src/NodeCrypto.ts`

- [ ] **Step 1: 写入 NodeCrypto.ts**

写入 `/workspace/typescript/packages/platform-node/src/NodeCrypto.ts`：

```ts
import { Effect, Layer } from "effect"
import { Crypto } from "../../contract/src/Crypto"
import { computeHmac, decryptData, deriveKeyFromPassword, encryptData } from "@aura/codec/Crypto"

export const NodeCryptoLive = Layer.succeed(Crypto)({
  deriveKeyFromPassword: (password, salt16) =>
    Effect.tryPromise(() => deriveKeyFromPassword(password, salt16)),
  encryptData: (plaintext, key32, nonce) => Effect.sync(() => encryptData(plaintext, key32, nonce)),
  decryptData: (encrypted, key32) => Effect.sync(() => decryptData(encrypted, key32)),
  computeHmac: (data, key32) => Effect.sync(() => computeHmac(data, key32))
})
```

---

### Task 6: typecheck

- [ ] **Step 1: 运行 typecheck**

Run (in `/workspace/typescript`):

```bash
bun run typecheck
```

Expected: PASS（exit code 0）。

