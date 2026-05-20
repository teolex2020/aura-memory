# Aura TypeScript Effect Layering Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 `typescript/` 实现纠偏到 effect-smol 风格的“中度分层”：新增 `@aura/contract` / `@aura/utils` / `@aura/platform-node`，消除跨包相对引用与 core/storage/codec 中的 `node:*` 依赖，并保持现有 M1/M2 对照测试全部通过。

**Architecture:** 以 contract 暴露 Context Tags（FileRead/FileWrite/Crypto/Clock），platform-node 提供 Live Layer；utils 放纯函数；core/storage/codec 只通过 `@aura/*` 引用与 Context 注入获取能力。现阶段允许保留同步 parse 与少量 class，但 IO 必须经 Context。

**Tech Stack:** Bun、TypeScript、Effect（effect-smol 风格）、Vitest + @effect/vitest。

---

## File Map（新增/修改概览）

**新增 packages**
- Create: `/workspace/typescript/packages/contract/package.json`
- Create: `/workspace/typescript/packages/contract/src/FileRead.ts`
- Create: `/workspace/typescript/packages/contract/src/FileWrite.ts`
- Create: `/workspace/typescript/packages/contract/src/Crypto.ts`
- Create: `/workspace/typescript/packages/contract/src/Clock.ts`
- Create: `/workspace/typescript/packages/contract/src/index.ts`

- Create: `/workspace/typescript/packages/utils/package.json`
- Create: `/workspace/typescript/packages/utils/src/Hex.ts`
- Create: `/workspace/typescript/packages/utils/src/Bytes.ts`
- Create: `/workspace/typescript/packages/utils/src/index.ts`

- Create: `/workspace/typescript/packages/platform-node/package.json`
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileRead.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeClock.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeCrypto.ts`
- Create: `/workspace/typescript/packages/platform-node/src/index.ts`

**工作区与测试工具**
- Modify: `/workspace/typescript/tsconfig.json`
- Modify: `/workspace/typescript/vitest.config.ts`
- Modify: `/workspace/typescript/packages/*/package.json`（增加 name/exports）

**迁移现有代码**
- Modify: `/workspace/typescript/packages/codec/src/*.ts`
- Modify: `/workspace/typescript/packages/storage/src/*.ts`
- Modify: `/workspace/typescript/packages/core/src/*.ts`

---

### Task 1: 新建 @aura/contract（FileRead/FileWrite/Crypto/Clock）

**Files:**
- Create: `/workspace/typescript/packages/contract/package.json`
- Create: `/workspace/typescript/packages/contract/src/FileRead.ts`
- Create: `/workspace/typescript/packages/contract/src/FileWrite.ts`
- Create: `/workspace/typescript/packages/contract/src/Crypto.ts`
- Create: `/workspace/typescript/packages/contract/src/Clock.ts`
- Create: `/workspace/typescript/packages/contract/src/index.ts`

- [ ] **Step 1: 创建 package.json**

写入 `/workspace/typescript/packages/contract/package.json`：

```json
{
  "name": "@aura/contract",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: 定义 FileRead**

写入 `/workspace/typescript/packages/contract/src/FileRead.ts`：

```ts
import { Context, Effect } from "effect"

export type FileStat = {
  size: number
}

export class FileRead extends Context.Tag("aura.contract.FileRead")<
  FileRead,
  {
    readFile: (path: string) => Effect.Effect<Uint8Array>
    exists: (path: string) => Effect.Effect<boolean>
    stat: (path: string) => Effect.Effect<FileStat>
  }
>() {}
```

- [ ] **Step 3: 定义 FileWrite**

写入 `/workspace/typescript/packages/contract/src/FileWrite.ts`：

```ts
import { Context, Effect } from "effect"

export class FileWrite extends Context.Tag("aura.contract.FileWrite")<
  FileWrite,
  {
    mkdirp: (path: string) => Effect.Effect<void>
    writeFile: (path: string, data: Uint8Array) => Effect.Effect<void>
    appendFile: (path: string, data: Uint8Array) => Effect.Effect<void>
    writeAt: (path: string, offset: number, data: Uint8Array) => Effect.Effect<void>
    fsync: (path: string) => Effect.Effect<void>
  }
>() {}
```

- [ ] **Step 4: 定义 Clock**

写入 `/workspace/typescript/packages/contract/src/Clock.ts`：

```ts
import { Context, Effect } from "effect"

export class Clock extends Context.Tag("aura.contract.Clock")<
  Clock,
  {
    nowSeconds: () => Effect.Effect<number>
  }
>() {}
```

- [ ] **Step 5: 定义 Crypto（Effect 形式）**

写入 `/workspace/typescript/packages/contract/src/Crypto.ts`：

import { Context, Effect } from "effect"

export class Crypto extends Context.Tag("aura.contract.Crypto")<
  Crypto,
  {
    deriveKeyFromPassword: (password: string, salt16: Uint8Array) => Effect.Effect<Uint8Array>
    encryptData: (plaintext: Uint8Array, key32: Uint8Array, nonce?: Uint8Array) => Effect.Effect<Uint8Array>
    decryptData: (encrypted: Uint8Array, key32: Uint8Array) => Effect.Effect<Uint8Array>
    computeHmac: (data: Uint8Array, key32: Uint8Array) => Effect.Effect<Uint8Array>
  }
>() {}

- [ ] **Step 6: 导出 index**

写入 `/workspace/typescript/packages/contract/src/index.ts`：

```ts
export * from "./FileRead"
export * from "./FileWrite"
export * from "./Clock"
export * from "./Crypto"
```

- [ ] **Step 7: typecheck**

Run (in `/workspace/typescript`):

```bash
bun run typecheck
```

Expected: PASS。

---

### Task 2: 新建 @aura/utils（hex/bytes 工具）

**Files:**
- Create: `/workspace/typescript/packages/utils/package.json`
- Create: `/workspace/typescript/packages/utils/src/Hex.ts`
- Create: `/workspace/typescript/packages/utils/src/Bytes.ts`
- Create: `/workspace/typescript/packages/utils/src/index.ts`

- [ ] **Step 1: 创建 package.json**

写入 `/workspace/typescript/packages/utils/package.json`：

```json
{
  "name": "@aura/utils",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: Hex**

写入 `/workspace/typescript/packages/utils/src/Hex.ts`：

```ts
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("bad hex")
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function bytesToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}
```

- [ ] **Step 3: Bytes**

写入 `/workspace/typescript/packages/utils/src/Bytes.ts`：

```ts
const te = new TextEncoder()

export function fixedBytes(value: string, len: number): Uint8Array {
  const out = new Uint8Array(len)
  const b = te.encode(value)
  out.set(b.subarray(0, len), 0)
  return out
}
```

- [ ] **Step 4: index**

写入 `/workspace/typescript/packages/utils/src/index.ts`：

```ts
export * from "./Hex"
export * from "./Bytes"
```

- [ ] **Step 5: typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS。

---

### Task 3: 新建 @aura/platform-node（contract 的 Live Layer）

**Files:**
- Create: `/workspace/typescript/packages/platform-node/package.json`
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileRead.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeClock.ts`
- Create: `/workspace/typescript/packages/platform-node/src/NodeCrypto.ts`
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

- [ ] **Step 2: NodeFileRead**

写入 `/workspace/typescript/packages/platform-node/src/NodeFileRead.ts`：

```ts
import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileRead } from "@aura/contract"

export const NodeFileReadLive = Layer.succeed(FileRead, {
  readFile: (p) => Effect.tryPromise(() => fs.readFile(p).then((b) => new Uint8Array(b))),
  exists: (p) => Effect.tryPromise(() => fs.stat(p).then(() => true).catch(() => false)),
  stat: (p) =>
    Effect.tryPromise(() =>
      fs.stat(p).then((s) => ({
        size: s.size
      }))
    )
})
```

- [ ] **Step 3: NodeFileWrite**

写入 `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`：

```ts
import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileWrite } from "@aura/contract"

export const NodeFileWriteLive = Layer.succeed(FileWrite, {
  mkdirp: (p) => Effect.tryPromise(() => fs.mkdir(p, { recursive: true }).then(() => undefined)),
  writeFile: (p, data) => Effect.tryPromise(() => fs.writeFile(p, data).then(() => undefined)),
  appendFile: (p, data) => Effect.tryPromise(() => fs.appendFile(p, data).then(() => undefined)),
  writeAt: (p, offset, data) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(p, "r+")
      try {
        await fd.write(data, 0, data.byteLength, offset)
      } finally {
        await fd.close()
      }
    }),
  fsync: (p) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(p, "r+")
      try {
        await fd.sync()
      } finally {
        await fd.close()
      }
    })
})
```

- [ ] **Step 4: NodeClock**

写入 `/workspace/typescript/packages/platform-node/src/NodeClock.ts`：

```ts
import { Effect, Layer } from "effect"
import { Clock } from "@aura/contract"

export const NodeClockLive = Layer.succeed(Clock, {
  nowSeconds: () => Effect.sync(() => Date.now() / 1000)
})
```

- [ ] **Step 5: NodeCrypto（复用现有 codec/Crypto 逻辑）**

写入 `/workspace/typescript/packages/platform-node/src/NodeCrypto.ts`：

```ts
import { Effect, Layer } from "effect"
import { Crypto } from "@aura/contract"
import * as Impl from "@aura/codec"

export const NodeCryptoLive = Layer.succeed(Crypto, {
  deriveKeyFromPassword: (password, salt16) => Effect.tryPromise(() => Impl.deriveKeyFromPassword(password, salt16)),
  encryptData: (plaintext, key32, nonce) => Effect.sync(() => Impl.encryptData(plaintext, key32, nonce)),
  decryptData: (encrypted, key32) => Effect.sync(() => Impl.decryptData(encrypted, key32)),
  computeHmac: (data, key32) => Effect.sync(() => Impl.computeHmac(data, key32))
})
```

- [ ] **Step 6: index（提供组合 Layer）**

写入 `/workspace/typescript/packages/platform-node/src/index.ts`：

```ts
export * from "./NodeFileRead"
export * from "./NodeFileWrite"
export * from "./NodeClock"
export * from "./NodeCrypto"
```

- [ ] **Step 7: typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS。

---

### Task 4: 统一 @aura/* 解析（tsconfig paths + vitest alias + package exports）

**Files:**
- Modify: `/workspace/typescript/tsconfig.json`
- Modify: `/workspace/typescript/vitest.config.ts`
- Modify: `/workspace/typescript/packages/{codec,storage,core}/package.json`

- [ ] **Step 1: 更新 tsconfig paths（补齐无通配符入口）**

修改 `/workspace/typescript/tsconfig.json` 的 `paths`：

```json
{
  "@aura/codec": ["packages/codec/src/index.ts"],
  "@aura/codec/*": ["packages/codec/src/*"],
  "@aura/storage": ["packages/storage/src/index.ts"],
  "@aura/storage/*": ["packages/storage/src/*"],
  "@aura/core": ["packages/core/src/index.ts"],
  "@aura/core/*": ["packages/core/src/*"],
  "@aura/contract": ["packages/contract/src/index.ts"],
  "@aura/contract/*": ["packages/contract/src/*"],
  "@aura/utils": ["packages/utils/src/index.ts"],
  "@aura/utils/*": ["packages/utils/src/*"],
  "@aura/platform-node": ["packages/platform-node/src/index.ts"],
  "@aura/platform-node/*": ["packages/platform-node/src/*"]
}
```

- [ ] **Step 2: 更新 vitest alias（让 Vite 运行时能解析 @aura/*）**

修改 `/workspace/typescript/vitest.config.ts`：

```ts
import * as path from "node:path"
import { defineConfig } from "vitest/config"

function pkg(name: string): string {
  return path.resolve(import.meta.dirname, "packages", name, "src", "index.ts")
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node"
  },
  resolve: {
    alias: {
      "@aura/codec": pkg("codec"),
      "@aura/storage": pkg("storage"),
      "@aura/core": pkg("core"),
      "@aura/contract": pkg("contract"),
      "@aura/utils": pkg("utils"),
      "@aura/platform-node": pkg("platform-node")
    }
  }
})
```

- [ ] **Step 3: 给 codec/storage/core 的 package.json 增加 name/exports**

修改 `/workspace/typescript/packages/codec/package.json`：

```json
{
  "name": "@aura/codec",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

修改 `/workspace/typescript/packages/storage/package.json`：

```json
{
  "name": "@aura/storage",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

修改 `/workspace/typescript/packages/core/package.json`：

```json
{
  "name": "@aura/core",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

- [ ] **Step 4: 运行 typecheck 与全量测试**

Run:

```bash
bun run typecheck
bun run test
```

Expected: PASS。

---

### Task 5: 消除跨包相对引用（codec/storage/core）

**Files:**
- Modify: `/workspace/typescript/packages/storage/src/*.ts`
- Modify: `/workspace/typescript/packages/core/src/*.ts`

- [ ] **Step 1: storage 内部从 ../../codec/src/* 改为 @aura/codec**

示例修改（以 Temporal.ts 为例）：

```ts
import { BinaryReader, bincodeDecodeStringMap } from "@aura/codec"
```

全量替换 storage/src 下所有 `../../codec/src/*`。

- [ ] **Step 2: core 内部从 ../../storage/src/* 改为 @aura/storage**

示例修改（Aura.ts）：

```ts
import { readBrainAuraFile, type BrainAuraRecord } from "@aura/storage"
```

- [ ] **Step 3: 运行测试**

Run:

```bash
bun run test
```

Expected: PASS。

---

### Task 6: 收敛 node:* 依赖到 platform-node（core/storage）

**Files:**
- Modify: `/workspace/typescript/packages/core/src/Aura.ts`
- Modify: `/workspace/typescript/packages/storage/src/BrainAuraFile.ts`
- Modify: `/workspace/typescript/packages/storage/src/BrainAuraFile.test.ts`

- [ ] **Step 1: core/Aura.open 改为 Effect + FileRead 注入**

将 `/workspace/typescript/packages/core/src/Aura.ts` 改为：

```ts
import { Effect } from "effect"
import { FileRead } from "@aura/contract"
import { readBrainAuraFile, type BrainAuraRecord } from "@aura/storage"

export class Aura {
  private constructor(private readonly records: BrainAuraRecord[]) {}

  static open(brainPath: string): Effect.Effect<Aura, unknown, FileRead> {
    const brainAuraPath = `${brainPath}/brain.aura`
    return FileRead.pipe(
      Effect.flatMap((fs) => fs.readFile(brainAuraPath)),
      Effect.map((buf) => readBrainAuraFile(buf).records),
      Effect.map((records) => new Aura(records))
    )
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice()
  }
}
```

并更新测试（Aura.test.ts）：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { Aura } from "@aura/core"
import { NodeFileReadLive } from "@aura/platform-node"

it("Aura.open loads minimal fixture", async () => {
  const brainPath = `${process.cwd()}/test/fixtures/minimal_brain`
  const aura = await Effect.runPromise(Aura.open(brainPath).pipe(Effect.provide(NodeFileReadLive)))
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0]!.id, "ts_fixture_1")
})
```

- [ ] **Step 2: storage/BrainAuraFile 迁移为 Effect + FileWrite/Clock/Crypto 注入**

将 `BrainAuraFile.open/append/flush` 改为返回 Effect，并用 `FileWrite`/`Clock`/`Crypto`：

- `open(dir, key32?)`: `mkdirp` + `exists/readFile/writeFile`（header 初始化）+ `stat` 获取 endOff
- `append`: `appendFile` 写入 record bytes（加密时用 Crypto.encryptData）
- `flush`: `writeAt(filePath, 8, u64count)` + `fsync`

为避免改动过大，允许保留 `class BrainAuraFile`，但其方法返回 `Effect`。

- [ ] **Step 3: 保留测试 glue（spawnSync），但 file IO 走 platform layer**

BrainAuraFile.test.ts 中 `spawnSync("cargo", ...)` 可保留；其余对 `fs.readFileSync` 改为走 `NodeFileReadLive` 或通过 `FileRead`。

- [ ] **Step 4: grep 校验（人工）**

Run:

```bash
bun run typecheck
bun run test
```

Expected: PASS。

---

## Plan Self-Review

- 覆盖 spec addendum 的 contract/utils/platform-node、只读/仅写入 Context 拆分、导入规范与验收标准
- 迁移策略先解决“边界与导入”，再把 node 依赖收敛到 platform-node，避免一次性重构过猛
- 允许中度分层：保留同步 parse 与少量 class，但 IO 必须经 Context

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-05-20-aura-typescript-effect-layering-plan.md`。

你已明确要求推进执行；我将按 Subagent-Driven 从 Task 1 开始逐个派发并在每个 Task 后做全量 typecheck/test 校验。

