# TypeScript Codec Crypto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/workspace/typescript` 增加 `@aura/codec` 的 Crypto 工具：Argon2id 派生 + ChaCha20-Poly1305 加解密 + HMAC-SHA256，并用固定 salt/password 与 Rust oracle 向量对照测试通过。

**Architecture:** `packages/codec/src/Crypto.ts` 暴露 `deriveKeyFromPassword/encryptData/decryptData/computeHmac/generateNonce`；`deriveKeyFromPassword` 使用 `argon2-wasm-edge`；加密使用 `@noble/ciphers` 的 ChaCha20-Poly1305，输出格式为 `nonce(12) || ciphertext+tag`；HMAC 使用 `@noble/hashes` 的 HMAC-SHA256。

**Tech Stack:** Bun、TypeScript、Vitest + @effect/vitest、argon2-wasm-edge、@noble/ciphers、@noble/hashes。

---

## 文件结构

- Modify: `/workspace/typescript/package.json`
- Modify: `/workspace/typescript/bun.lock`
- Create: `/workspace/typescript/packages/codec/src/Crypto.ts`
- Modify: `/workspace/typescript/packages/codec/src/index.ts`
- Create: `/workspace/typescript/packages/codec/src/Crypto.test.ts`

---

### Task 1: 添加依赖并安装

**Files:**
- Modify: `/workspace/typescript/package.json`
- Modify: `/workspace/typescript/bun.lock`

- [ ] **Step 1: 更新 package.json dependencies**

将以下依赖添加到 `/workspace/typescript/package.json` 的 `dependencies`：

```json
{
  "argon2-wasm-edge": "^1.0.23",
  "@noble/ciphers": "^1.2.0",
  "@noble/hashes": "^1.8.0"
}
```

- [ ] **Step 2: 安装依赖**

Run (in `/workspace/typescript`):

```bash
bun install
```

Expected: 安装成功并更新 lockfile。

---

### Task 2: 实现 Crypto.ts 并导出

**Files:**
- Create: `/workspace/typescript/packages/codec/src/Crypto.ts`
- Modify: `/workspace/typescript/packages/codec/src/index.ts`

- [ ] **Step 1: 实现 Crypto.ts**

写入 `/workspace/typescript/packages/codec/src/Crypto.ts`（包含可选 `nonce?: Uint8Array` 参数，仅用于测试固定向量；默认随机生成）：

```ts
import { argon2id } from "argon2-wasm-edge"
import { chacha20poly1305 } from "@noble/ciphers/chacha"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"

export async function deriveKeyFromPassword(password: string, salt16: Uint8Array): Promise<Uint8Array> {
  if (salt16.length !== 16) throw new Error("salt must be 16 bytes")
  const key = await argon2id({
    password,
    salt: salt16,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "raw"
  } as any)
  return key instanceof Uint8Array ? key : new Uint8Array(key)
}

export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

export async function encryptData(plaintext: Uint8Array, key32: Uint8Array, nonce?: Uint8Array): Promise<Uint8Array> {
  if (key32.length !== 32) throw new Error("key must be 32 bytes")
  const n = nonce ?? generateNonce()
  if (n.length !== 12) throw new Error("nonce must be 12 bytes")
  const cipher = chacha20poly1305(key32, n)
  const ciphertext = cipher.encrypt(plaintext)
  const out = new Uint8Array(12 + ciphertext.length)
  out.set(n, 0)
  out.set(ciphertext, 12)
  return out
}

export async function decryptData(encrypted: Uint8Array, key32: Uint8Array): Promise<Uint8Array> {
  if (key32.length !== 32) throw new Error("key must be 32 bytes")
  if (encrypted.length < 12 + 16) throw new Error("encrypted data too short")
  const nonce = encrypted.subarray(0, 12)
  const ciphertext = encrypted.subarray(12)
  const cipher = chacha20poly1305(key32, nonce)
  return cipher.decrypt(ciphertext)
}

export function computeHmac(data: Uint8Array, key32: Uint8Array): Uint8Array {
  if (key32.length !== 32) throw new Error("key must be 32 bytes")
  return hmac(sha256, key32, data)
}
```

- [ ] **Step 2: 更新导出**

修改 `/workspace/typescript/packages/codec/src/index.ts`：

```ts
export * from "./Binary"
export * from "./Bincode"
export * from "./Crypto"
```

---

### Task 3: 编写 Crypto.test.ts 并跑通

**Files:**
- Create: `/workspace/typescript/packages/codec/src/Crypto.test.ts`

- [ ] **Step 1: 写测试**

写入 `/workspace/typescript/packages/codec/src/Crypto.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { computeHmac, decryptData, deriveKeyFromPassword } from "./Crypto"

function bytesToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("bad hex")
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

it("deriveKeyFromPassword/encryptData/decryptData/computeHmac (rust oracle)", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  assert.strictEqual(bytesToHex(key), "b37c7b747648fbe8c5f3dfbe83fb2534fce70caf35f689f4dcd90c75f3de9431")

  const encrypted = hexToBytes("f8c20e6155a60ce95f52d6b0adbf167e0aa5159591b097160f67fe7a3b7f7f1d6895294036703717c9dfbf1232e1382e8c")
  const decrypted = await decryptData(encrypted, key)
  assert.strictEqual(new TextDecoder().decode(decrypted), "hello")

  const hmac = computeHmac(encrypted, key)
  assert.strictEqual(bytesToHex(hmac), "e8b0eb9ae0026b24aadcb0135c22865a97c241b52c62e13977d156823806292c")
})
```

- [ ] **Step 2: 运行测试**

Run (in `/workspace/typescript`):

```bash
bun run test packages/codec/src/Crypto.test.ts
```

Expected: PASS。

---

## Plan Self-Review

- 覆盖需求：依赖添加、bun install、Crypto.ts 五个 API、index.ts 导出、按指定 salt/password 与 Rust oracle 向量测试并通过
- 数据格式对齐：ChaCha20-Poly1305 输出 `nonce(12) || ciphertext+tag(16)`，HMAC-SHA256 对 encrypted 全量计算

---

## Execution Handoff

计划已保存到：`docs/superpowers/plans/2026-05-20-typescript-codec-crypto.md`。

执行方式二选一：

1. Subagent-Driven（推荐）
2. Inline Execution（在当前会话直接落地并跑测试）
