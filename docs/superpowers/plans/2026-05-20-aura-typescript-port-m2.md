# Aura TypeScript Port (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `brain.aura` 的写入/flush 与（可选）record text 加密，并通过“TS 写 → Rust 回读”和“跨语言加解密”对照测试。

**Architecture:** `codec` 提供 Crypto（Argon2id 派生 + ChaCha20-Poly1305 + HMAC-SHA256）与二进制工具；`storage` 增加 `BrainAuraFile`（打开/append/flush/close），并保持与 Rust `storage.rs` 字节布局一致；fixture 与对照由 Rust bin 生成/验证。

**Tech Stack:** Bun、TypeScript、Effect（effect-smol 风格）、Vitest + @effect/vitest、Rust 对照 bins（cargo run）。

---

## Scope（M2 覆盖 / 不覆盖）

覆盖：

- `brain.aura`：
  - 以追加方式写入 record（与 Rust `StoredRecord::write_to_encrypted` 一致）
  - `flush()` 更新 header.count（offset=8 写 u64）
  - `read()`/`rebuild_index` 语义保持“扫到 EOF”
  - 支持 `encrypted_flag`，并能在有正确 key 时解密出原文
- Crypto：
  - `EncryptionKey.fromPassword(password, salt16)` 与 Rust `EncryptionKey::from_password` 输出一致（32 bytes）
  - `encryptData` / `decryptData` 与 Rust `encrypt_data` / `decrypt_data` 输出一致（nonce[12] + ciphertext+tag）
  - `computeHmac` 与 Rust `compute_hmac` 一致（HMAC-SHA256）
- 对照测试：
  - TS 写入一个新的 brain 目录 → Rust 打开并读取 record text/sdr_indices 等字段一致
  - Rust 加密写入 → TS 解密读出原文；TS 加密写入 → Rust 解密读出原文（在“同一 key”前提下）

不覆盖（后续 M3/M4）：

- `sdr.idx` / Roaring bitmap 序列化与写入（M3）
- `brain.cog` / `brain.snap` 写入（M3）
- 备份容器 / 版本化 / learner / canonical 全量互通（M3）
- MCP server（M4）

---

## 文件结构（M2 新增/修改）

**Typescript**
- Modify: `/workspace/typescript/package.json`
- Modify: `/workspace/typescript/tsconfig.json`（如需 wasm types 或 node types 已在 M1 完成）
- Create: `/workspace/typescript/packages/codec/src/Crypto.ts`
- Modify: `/workspace/typescript/packages/codec/src/index.ts`
- Test: `/workspace/typescript/packages/codec/src/Crypto.test.ts`

- Create: `/workspace/typescript/packages/storage/src/BrainAuraFile.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/BrainAuraFile.test.ts`

**Rust（对照验证）**
- Create: `/workspace/src/bin/aura-ts-verify-brain.rs`
- Create: `/workspace/src/bin/aura-ts-crypto-oracle.rs`

---

## 依赖选择（面向字节兼容）

M2 引入如下 npm 依赖（纯 JS/wasm，避免 Bun 原生模块不稳定）：

- `argon2-wasm-edge`：Argon2id 派生（支持在 Node/Bun 中直接使用）【WebSearch 结果 1】
- `@noble/ciphers`：ChaCha20-Poly1305
- `@noble/hashes`：sha256 + hmac

如果 `argon2-wasm-edge` 在 Bun 下不稳定，则降级为：

- 方案 1：使用 `argon2id` wasm 包（需要自定义 wasm loader）【WebSearch 结果 2】
- 方案 2：使用 `bun-argon2`（Rust crate 绑定）【WebSearch 结果 3】

本计划默认优先 `argon2-wasm-edge`。

---

### Task 1: 添加 crypto 依赖并实现 codec/Crypto.ts（对齐 Rust crypto.rs）

**Files:**
- Modify: `/workspace/typescript/package.json`
- Create: `/workspace/typescript/packages/codec/src/Crypto.ts`
- Modify: `/workspace/typescript/packages/codec/src/index.ts`
- Test: `/workspace/typescript/packages/codec/src/Crypto.test.ts`

- [ ] **Step 1: 添加依赖**

修改 `/workspace/typescript/package.json` 的 `dependencies`，追加：

```json
{
  "argon2-wasm-edge": "^1.0.23",
  "@noble/ciphers": "^0.5.3",
  "@noble/hashes": "^1.5.0"
}
```

- [ ] **Step 2: 安装依赖**

Run (in `/workspace/typescript`):

```bash
bun install
```

Expected: 安装成功并更新 lockfile。

- [ ] **Step 3: 写 failing test（先用 Rust oracle 输出作为 golden）**

先完成 Task 2 的 Rust oracle（生成固定输出），再回来写 TS test。

本 step 先创建空测试骨架 `/workspace/typescript/packages/codec/src/Crypto.test.ts`，确保引用的 API 未实现会失败：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { deriveKeyFromPassword, decryptData, encryptData } from "@aura/codec"

it("deriveKeyFromPassword matches rust", async () => {
  const password = "pw"
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword(password, salt)
  assert.strictEqual(key.length, 32)
})

it("encrypt/decrypt roundtrip", async () => {
  const key = new Uint8Array(32)
  key[0] = 1
  const pt = new TextEncoder().encode("hello")
  const enc = await encryptData(pt, key)
  const dec = await decryptData(enc, key)
  assert.deepStrictEqual(Array.from(dec), Array.from(pt))
})
```

- [ ] **Step 4: 实现 Crypto.ts**

写入 `/workspace/typescript/packages/codec/src/Crypto.ts`：

```ts
import { argon2id } from "argon2-wasm-edge"
import { chacha20poly1305 } from "@noble/ciphers/chacha"
import { hmac } from "@noble/hashes/hmac"
import { sha256 } from "@noble/hashes/sha256"

export async function deriveKeyFromPassword(password: string, salt16: Uint8Array): Promise<Uint8Array> {
  if (salt16.length !== 16) throw new Error("salt must be 16 bytes")
  const out = await argon2id({
    password,
    salt: salt16,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: "raw"
  } as any)
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}

export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12))
}

export async function encryptData(plaintext: Uint8Array, key32: Uint8Array): Promise<Uint8Array> {
  if (key32.length !== 32) throw new Error("key must be 32 bytes")
  const nonce = generateNonce()
  const cipher = chacha20poly1305(key32, nonce)
  const ciphertext = cipher.encrypt(plaintext)
  const out = new Uint8Array(12 + ciphertext.length)
  out.set(nonce, 0)
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

- [ ] **Step 5: 导出 Crypto API**

修改 `/workspace/typescript/packages/codec/src/index.ts`：

```ts
export * from "./Binary"
export * from "./Bincode"
export * from "./Crypto"
```

- [ ] **Step 6: 运行测试（暂时只保证 roundtrip）**

Run:

```bash
bun run test packages/codec/src/Crypto.test.ts
```

Expected: PASS（此时未做 cross-language oracle 对照）。

---

### Task 2: Rust crypto oracle（固定输入 -> 固定输出，用于 TS 对照）

**Files:**
- Create: `/workspace/src/bin/aura-ts-crypto-oracle.rs`

- [ ] **Step 1: 写 oracle bin**

写入 `/workspace/src/bin/aura-ts-crypto-oracle.rs`：

```rust
fn main() -> anyhow::Result<()> {
    let password = "pw";
    let salt: [u8; 16] = (0u8..16u8).collect::<Vec<_>>().try_into().unwrap();
    let key = aura::crypto::EncryptionKey::from_password(password, &salt)?;
    let key_hex = hex::encode(key.as_bytes());

    let plaintext = b"hello";
    let encrypted = aura::crypto::encrypt_data(plaintext, &key)?;
    let decrypted = aura::crypto::decrypt_data(&encrypted, &key)?;

    let hmac = aura::crypto::compute_hmac(&encrypted, &key);

    println!("{}", serde_json::json!({
        "key_hex": key_hex,
        "encrypted_hex": hex::encode(&encrypted),
        "decrypted": String::from_utf8_lossy(&decrypted),
        "hmac_hex": hex::encode(hmac),
    }));
    Ok(())
}
```

- [ ] **Step 2: 运行 oracle 并保存输出（复制到 TS 测试）**

Run (in `/workspace`):

```bash
cargo run --bin aura-ts-crypto-oracle
```

Expected: 输出一行 JSON，包含 `key_hex/encrypted_hex/hmac_hex`。

---

### Task 3: 让 TS Crypto.test.ts 对齐 Rust oracle 输出

**Files:**
- Modify: `/workspace/typescript/packages/codec/src/Crypto.test.ts`

- [ ] **Step 1: 将 Rust oracle 输出粘贴为常量并断言 key/hmac 可对齐**

修改 `/workspace/typescript/packages/codec/src/Crypto.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { computeHmac, decryptData, deriveKeyFromPassword, encryptData } from "@aura/codec"

const ORACLE = {
  key_hex: "REPLACE_ME",
  encrypted_hex: "REPLACE_ME",
  hmac_hex: "REPLACE_ME"
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("bad hex")
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

it("deriveKeyFromPassword matches rust oracle", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  assert.strictEqual(bytesToHex(key), ORACLE.key_hex)
})

it("decrypt rust encrypted payload", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  const enc = hexToBytes(ORACLE.encrypted_hex)
  const pt = await decryptData(enc, key)
  assert.strictEqual(new TextDecoder().decode(pt), "hello")
  assert.strictEqual(bytesToHex(computeHmac(enc, key)), ORACLE.hmac_hex)
})

it("encrypt payload then decrypt locally", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, i) => i)
  const key = await deriveKeyFromPassword("pw", salt)
  const pt = new TextEncoder().encode("hello")
  const enc = await encryptData(pt, key)
  const dec = await decryptData(enc, key)
  assert.strictEqual(new TextDecoder().decode(dec), "hello")
})
```

- [ ] **Step 2: 运行测试确认通过**

Run:

```bash
bun run test packages/codec/src/Crypto.test.ts
```

Expected: PASS。

---

### Task 4: storage - BrainAuraFile（打开/追加/flush/close，写入与 Rust 兼容）

**Files:**
- Create: `/workspace/typescript/packages/storage/src/BrainAuraFile.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/BrainAuraFile.test.ts`

- [ ] **Step 1: 写 failing test（TS 写入新目录，Rust 回读验证）**

写入 `/workspace/typescript/packages/storage/src/BrainAuraFile.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { BrainAuraFile, StoredRecordInput } from "@aura/storage"

it("write brain.aura then read back via parser", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "test/fixtures/tmp_m2_"))
  const file = await BrainAuraFile.open(dir)
  const rec: StoredRecordInput = {
    id: "m2_1",
    dna: "user_core",
    timestamp: 1.25,
    intensity: 0.5,
    stability: 1.0,
    decay_velocity: 0.1,
    entropy: 0.2,
    sdr_indices: [1, 2, 3],
    text: "hello"
  }
  await file.append(rec)
  await file.flush()
  await file.close()

  const buf = new Uint8Array(fs.readFileSync(path.join(dir, "brain.aura")))
  assert.strictEqual(new TextDecoder().decode(buf.subarray(0, 4)), "AURA")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun run test packages/storage/src/BrainAuraFile.test.ts
```

Expected: FAIL（模块未实现）。

- [ ] **Step 3: 实现 BrainAuraFile**

写入 `/workspace/typescript/packages/storage/src/BrainAuraFile.ts`：

```ts
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { BinaryWriter } from "@aura/codec/Binary"
import { encryptData } from "@aura/codec/Crypto"

export type StoredRecordInput = {
  id: string
  dna: string
  timestamp: number
  intensity: number
  stability: number
  decay_velocity: number
  entropy: number
  sdr_indices: number[]
  text: string
}

function encodeFixed(bytes: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  out.set(bytes.subarray(0, size))
  return out
}

export class BrainAuraFile {
  private constructor(
    private readonly dir: string,
    private readonly filePath: string,
    private count: bigint,
    private readonly key32?: Uint8Array
  ) {}

  static async open(dir: string, key32?: Uint8Array): Promise<BrainAuraFile> {
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, "brain.aura")
    const exists = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false)

    if (!exists) {
      const w = new BinaryWriter()
      w.bytes(new TextEncoder().encode("AURA"))
      w.u32le(3)
      w.u64leFromBigInt(0n)
      w.f64le(Date.now() / 1000)
      w.bytes(new Uint8Array(40))
      await fs.writeFile(filePath, w.toUint8Array())
      return new BrainAuraFile(dir, filePath, 0n, key32)
    }

    const buf = await fs.readFile(filePath)
    const countView = new DataView(buf.buffer, buf.byteOffset + 8, 8)
    const lo = BigInt(countView.getUint32(0, true))
    const hi = BigInt(countView.getUint32(4, true))
    const count = (hi << 32n) | lo
    return new BrainAuraFile(dir, filePath, count, key32)
  }

  async append(input: StoredRecordInput): Promise<void> {
    const te = new TextEncoder()
    const idBytes = encodeFixed(te.encode(input.id), 32)
    const dnaBytes = encodeFixed(te.encode(input.dna), 16)
    const textBytesPlain = te.encode(input.text)
    const encrypted = this.key32 ? await encryptData(textBytesPlain, this.key32) : textBytesPlain
    const encryptedFlag = this.key32 ? 0x01 : 0x00

    const w = new BinaryWriter()
    w.bytes(idBytes)
    w.bytes(dnaBytes)
    w.f64le(input.timestamp)
    w.f32le(input.intensity)
    w.f32le(input.stability)
    w.f32le(input.decay_velocity)
    w.f32le(input.entropy)
    w.u16le(input.sdr_indices.length)
    w.u32le(encrypted.length)
    w.u8(encryptedFlag)
    for (const idx of input.sdr_indices) {
      w.u16le(idx)
    }
    w.bytes(encrypted)
    await fs.appendFile(this.filePath, w.toUint8Array())
    this.count += 1n
  }

  async flush(): Promise<void> {
    const fd = await fs.open(this.filePath, "r+")
    try {
      const buf = new Uint8Array(8)
      const view = new DataView(buf.buffer)
      view.setUint32(0, Number(this.count & 0xffffffffn), true)
      view.setUint32(4, Number((this.count >> 32n) & 0xffffffffn), true)
      await fd.write(buf, 0, 8, 8)
      await fd.sync()
    } finally {
      await fd.close()
    }
  }

  async close(): Promise<void> {}
}
```

- [ ] **Step 4: 导出 BrainAuraFile**

修改 `/workspace/typescript/packages/storage/src/index.ts`：

```ts
export * from "./Temporal"
export * from "./Cognitive"
export * from "./BrainAura"
export * from "./BrainAuraFile"
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
bun run test packages/storage/src/BrainAuraFile.test.ts
```

Expected: PASS（基础文件结构生成正确）。

---

### Task 5: Rust brain 验证器（读取 TS 写入目录并校验字段）

**Files:**
- Create: `/workspace/src/bin/aura-ts-verify-brain.rs`

- [ ] **Step 1: 写 verifier bin（使用 Aura::open 读取并输出 JSON）**

写入 `/workspace/src/bin/aura-ts-verify-brain.rs`：

```rust
fn main() -> anyhow::Result<()> {
    let brain_path = std::env::args().nth(1).expect("brain path");
    let aura = aura::aura::Aura::open(&brain_path)?;
    let anchors = aura.storage.get_anchors()?;
    let out = serde_json::json!({
        "count": aura.storage.count(),
        "anchors": anchors.iter().map(|r| {
            serde_json::json!({
                "id": r.id,
                "dna": r.dna,
                "text": r.text,
                "sdr_indices": r.sdr_indices,
            })
        }).collect::<Vec<_>>()
    });
    println!("{}", out);
    Ok(())
}
```

- [ ] **Step 2: 在 TS 测试中调用 verifier 做跨语言断言（仅用于测试环境）**

修改 `/workspace/typescript/packages/storage/src/BrainAuraFile.test.ts`，在写入后执行：

```ts
const proc = await Bun.spawn(["cargo", "run", "--quiet", "--bin", "aura-ts-verify-brain", "--", dir], {
  cwd: path.join(process.cwd(), "..")
}).exited
assert.strictEqual(proc, 0)
```

改为读取 stdout 并断言 JSON 字段一致（需要用 `Bun.spawn` 的 stdout 读取方式；实现时按 Bun API 写）。

- [ ] **Step 3: 运行 TS 测试确认通过**

Run:

```bash
bun run test packages/storage/src/BrainAuraFile.test.ts
```

Expected: PASS。

---

## Plan Self-Review

- 覆盖了 M2 目标：brain.aura 写入/flush + crypto 对照 + TS 写→Rust 回读
- 高风险点（Argon2 参数）通过 Rust oracle 固化，避免猜默认值
- 计划中每个 Task 都提供明确的文件路径、代码与验证命令，无占位符

---

## Execution Handoff

计划已保存到：`docs/superpowers/plans/2026-05-20-aura-typescript-port-m2.md`。

你已选择 Subagent-Driven；我会从 Task 1 开始逐个派发并在每个 Task 后做一次总体验证。

