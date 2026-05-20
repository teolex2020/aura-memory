# Aura TypeScript Port (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `typescript/` 下搭建 Bun + Effect（effect-smol 风格）工作区，并实现“主链路文件集”的只读解析能力（brain.aura / temporal.bin / brain.cog + brain.snap），用 Rust 生成 fixture 做字节对照测试。

**Architecture:** 使用 Effect 的 Context/Layer 做依赖注入；`codec` 提供字节读写与 bincode 子集；`storage` 负责落盘格式；`core` 暂只提供 open + read APIs（M1 不实现 recall/search）。

**Tech Stack:** Bun、TypeScript、Effect（effect-smol 风格）、Vitest（配合 @effect/vitest）、Rust fixture generator（二进制对照）。

---

## Scope（本计划覆盖 / 不覆盖）

覆盖（M1）：

- `typescript/` workspace 初始化（Bun）
- effect-smol 风格的 Service/Layer 骨架（FileSystem/Clock 等）
- `brain.aura` 读取：header + record 逐条解析（含 encrypted_flag 逻辑）
- `temporal.bin` 读取：TPL1 + bincode(HashMap<String,String>) 子集解码
- `brain.cog` / `brain.snap` 读取：magic/version + CRC32 + JSON payload（按 Rust 的容错策略）
- Rust fixture 生成器：输出最小 brain 目录用于 TS 读对照

不覆盖（后续计划）：

- `sdr.idx` / Roaring bitmap 解码与检索
- `index_manifest.json` / `sdr.idx` 写入
- 加密全链路互通（M1 仅实现 brain.aura record text 的 decrypt 逻辑接口与 “无 key 行为” 对齐；真正跨语言互通放到 M2）
- 版本化、备份容器、learner/canonical 等其他落盘格式（M3）
- MCP server（M4）

---

## 目录结构（M1 完成后）

- Create: `/workspace/typescript/package.json`
- Create: `/workspace/typescript/tsconfig.json`
- Create: `/workspace/typescript/vitest.config.ts`
- Create: `/workspace/typescript/packages/codec/src/*`
- Create: `/workspace/typescript/packages/storage/src/*`
- Create: `/workspace/typescript/packages/core/src/*`
- Create: `/workspace/typescript/test/fixtures/*`（由 Rust 生成）
- Create: `/workspace/src/bin/aura-ts-fixtures.rs`（Rust fixture 生成器）

---

### Task 1: 初始化 Bun + TS + 测试框架骨架

**Files:**
- Create: `/workspace/typescript/package.json`
- Create: `/workspace/typescript/tsconfig.json`
- Create: `/workspace/typescript/vitest.config.ts`
- Create: `/workspace/typescript/packages/codec/package.json`
- Create: `/workspace/typescript/packages/storage/package.json`
- Create: `/workspace/typescript/packages/core/package.json`

- [ ] **Step 1: 创建根 package.json（workspace + scripts）**

写入 `/workspace/typescript/package.json`：

```json
{
  "name": "aura-ts",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "effect": "4.0.0-beta.68",
    "@effect/vitest": "4.0.0-beta.68"
  }
}
```

- [ ] **Step 2: 创建 tsconfig（strict + bundler resolution）**

写入 `/workspace/typescript/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"],
    "baseUrl": ".",
    "paths": {
      "@aura/codec/*": ["packages/codec/src/*"],
      "@aura/storage/*": ["packages/storage/src/*"],
      "@aura/core/*": ["packages/core/src/*"]
    }
  },
  "include": [
    "packages/**/*.ts",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 3: 创建 vitest 配置（@effect/vitest 断言）**

写入 `/workspace/typescript/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node"
  }
})
```

- [ ] **Step 4: 为三个 package 写最小 package.json（仅用于工作区分层）**

写入 `/workspace/typescript/packages/codec/package.json`：

```json
{
  "name": "@aura/codec",
  "private": true,
  "type": "module"
}
```

写入 `/workspace/typescript/packages/storage/package.json`：

```json
{
  "name": "@aura/storage",
  "private": true,
  "type": "module"
}
```

写入 `/workspace/typescript/packages/core/package.json`：

```json
{
  "name": "@aura/core",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 5: 安装依赖**

Run (in `/workspace/typescript`):

```bash
bun install
```

Expected: 依赖安装完成，生成 `bun.lockb`。

- [ ] **Step 6: 运行 typecheck 与空测试**

Run (in `/workspace/typescript`):

```bash
bun run typecheck
bun run test
```

Expected: typecheck PASS；test PASS（无测试时 vitest 退出码为 0）。

---

### Task 2: codec - LittleEndian BinaryReader/BinaryWriter（最小可用）

**Files:**
- Create: `/workspace/typescript/packages/codec/src/Binary.ts`
- Create: `/workspace/typescript/packages/codec/src/index.ts`
- Test: `/workspace/typescript/packages/codec/src/Binary.test.ts`

- [ ] **Step 1: 写 failing test（读取/写入 f64/u32/u16/u8 与 bytes）**

写入 `/workspace/typescript/packages/codec/src/Binary.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryReader, BinaryWriter } from "@aura/codec/index"

it("BinaryReader/BinaryWriter roundtrip", () => {
  const w = new BinaryWriter()
  w.u8(1)
  w.u16le(0x2233)
  w.u32le(0x44556677)
  w.f32le(12.25)
  w.f64le(123.5)
  w.bytes(Uint8Array.from([9, 8, 7]))

  const buf = w.toUint8Array()
  const r = new BinaryReader(buf)
  assert.strictEqual(r.u8(), 1)
  assert.strictEqual(r.u16le(), 0x2233)
  assert.strictEqual(r.u32le(), 0x44556677)
  assert.strictEqual(r.f32le(), 12.25)
  assert.strictEqual(r.f64le(), 123.5)
  assert.deepStrictEqual(Array.from(r.bytes(3)), [9, 8, 7])
  assert.strictEqual(r.remaining(), 0)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run (in `/workspace/typescript`):

```bash
bun run test packages/codec/src/Binary.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 BinaryReader/BinaryWriter**

写入 `/workspace/typescript/packages/codec/src/Binary.ts`：

```ts
export class BinaryReader {
  private readonly view: DataView
  private readonly buf: Uint8Array
  private off = 0

  constructor(buf: Uint8Array) {
    this.buf = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  remaining(): number {
    return this.buf.byteLength - this.off
  }

  private need(n: number): void {
    if (this.off + n > this.buf.byteLength) {
      throw new Error("unexpected eof")
    }
  }

  u8(): number {
    this.need(1)
    const v = this.view.getUint8(this.off)
    this.off += 1
    return v
  }

  u16le(): number {
    this.need(2)
    const v = this.view.getUint16(this.off, true)
    this.off += 2
    return v
  }

  u32le(): number {
    this.need(4)
    const v = this.view.getUint32(this.off, true)
    this.off += 4
    return v
  }

  u64leAsBigInt(): bigint {
    this.need(8)
    const lo = BigInt(this.view.getUint32(this.off, true))
    const hi = BigInt(this.view.getUint32(this.off + 4, true))
    this.off += 8
    return (hi << 32n) | lo
  }

  f32le(): number {
    this.need(4)
    const v = this.view.getFloat32(this.off, true)
    this.off += 4
    return v
  }

  f64le(): number {
    this.need(8)
    const v = this.view.getFloat64(this.off, true)
    this.off += 8
    return v
  }

  bytes(n: number): Uint8Array {
    this.need(n)
    const out = this.buf.subarray(this.off, this.off + n)
    this.off += n
    return out
  }

  sliceRemaining(): Uint8Array {
    return this.bytes(this.remaining())
  }
}

export class BinaryWriter {
  private chunks: Uint8Array[] = []
  private len = 0

  private push(chunk: Uint8Array): void {
    this.chunks.push(chunk)
    this.len += chunk.byteLength
  }

  u8(v: number): void {
    const b = new Uint8Array(1)
    b[0] = v & 0xff
    this.push(b)
  }

  u16le(v: number): void {
    const b = new Uint8Array(2)
    const view = new DataView(b.buffer)
    view.setUint16(0, v & 0xffff, true)
    this.push(b)
  }

  u32le(v: number): void {
    const b = new Uint8Array(4)
    const view = new DataView(b.buffer)
    view.setUint32(0, v >>> 0, true)
    this.push(b)
  }

  u64leFromBigInt(v: bigint): void {
    const b = new Uint8Array(8)
    const view = new DataView(b.buffer)
    view.setUint32(0, Number(v & 0xffffffffn), true)
    view.setUint32(4, Number((v >> 32n) & 0xffffffffn), true)
    this.push(b)
  }

  f32le(v: number): void {
    const b = new Uint8Array(4)
    const view = new DataView(b.buffer)
    view.setFloat32(0, v, true)
    this.push(b)
  }

  f64le(v: number): void {
    const b = new Uint8Array(8)
    const view = new DataView(b.buffer)
    view.setFloat64(0, v, true)
    this.push(b)
  }

  bytes(buf: Uint8Array): void {
    this.push(buf)
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.len)
    let off = 0
    for (const c of this.chunks) {
      out.set(c, off)
      off += c.byteLength
    }
    return out
  }
}
```

写入 `/workspace/typescript/packages/codec/src/index.ts`：

```ts
export * from "./Binary"
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
bun run test packages/codec/src/Binary.test.ts
```

Expected: PASS。

---

### Task 3: codec - bincode 子集（支持 HashMap<String, String>）

**Files:**
- Create: `/workspace/typescript/packages/codec/src/Bincode.ts`
- Modify: `/workspace/typescript/packages/codec/src/index.ts`
- Test: `/workspace/typescript/packages/codec/src/Bincode.test.ts`

- [ ] **Step 1: 写 failing test（HashMap<String,String> 轮转）**

写入 `/workspace/typescript/packages/codec/src/Bincode.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryWriter } from "@aura/codec/Binary"
import { bincodeDecodeStringMap, bincodeEncodeStringMap } from "@aura/codec/Bincode"

it("bincode HashMap<String,String> roundtrip", () => {
  const m = new Map<string, string>([
    ["a", "1"],
    ["hello", "world"]
  ])
  const bytes = bincodeEncodeStringMap(m)
  const decoded = bincodeDecodeStringMap(bytes)
  assert.strictEqual(decoded.get("a"), "1")
  assert.strictEqual(decoded.get("hello"), "world")
})

it("bincode deterministic layout (u64 len + repeated key/value)", () => {
  const m = new Map<string, string>([["k", "v"]])
  const bytes = bincodeEncodeStringMap(m)
  const w = new BinaryWriter()
  w.u64leFromBigInt(1n)
  const k = new TextEncoder().encode("k")
  const v = new TextEncoder().encode("v")
  w.u64leFromBigInt(BigInt(k.length))
  w.bytes(k)
  w.u64leFromBigInt(BigInt(v.length))
  w.bytes(v)
  assert.deepStrictEqual(Array.from(bytes), Array.from(w.toUint8Array()))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun run test packages/codec/src/Bincode.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 bincode 子集**

写入 `/workspace/typescript/packages/codec/src/Bincode.ts`：

```ts
import { BinaryReader, BinaryWriter } from "./Binary"

const te = new TextEncoder()
const td = new TextDecoder()

export function bincodeEncodeStringMap(map: Map<string, string>): Uint8Array {
  const w = new BinaryWriter()
  w.u64leFromBigInt(BigInt(map.size))
  for (const [k, v] of map.entries()) {
    const kb = te.encode(k)
    const vb = te.encode(v)
    w.u64leFromBigInt(BigInt(kb.length))
    w.bytes(kb)
    w.u64leFromBigInt(BigInt(vb.length))
    w.bytes(vb)
  }
  return w.toUint8Array()
}

export function bincodeDecodeStringMap(buf: Uint8Array): Map<string, string> {
  const r = new BinaryReader(buf)
  const n = r.u64leAsBigInt()
  const out = new Map<string, string>()
  for (let i = 0n; i < n; i++) {
    const kLen = Number(r.u64leAsBigInt())
    const k = td.decode(r.bytes(kLen))
    const vLen = Number(r.u64leAsBigInt())
    const v = td.decode(r.bytes(vLen))
    out.set(k, v)
  }
  return out
}
```

修改 `/workspace/typescript/packages/codec/src/index.ts`：

```ts
export * from "./Binary"
export * from "./Bincode"
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
bun run test packages/codec/src/Bincode.test.ts
```

Expected: PASS。

---

### Task 4: storage - temporal.bin（TPL1 + bincode HashMap<String,String>）

**Files:**
- Create: `/workspace/typescript/packages/storage/src/Temporal.ts`
- Create: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/Temporal.test.ts`

- [ ] **Step 1: 写 failing test（TPL1 header + version + map decode）**

写入 `/workspace/typescript/packages/storage/src/Temporal.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryWriter } from "@aura/codec/Binary"
import { bincodeEncodeStringMap } from "@aura/codec/Bincode"
import { decodeTemporalBin } from "@aura/storage/Temporal"

it("decode temporal.bin", () => {
  const links = new Map<string, string>([
    ["A", "B"],
    ["B", "C"]
  ])
  const payload = bincodeEncodeStringMap(links)
  const w = new BinaryWriter()
  w.bytes(new TextEncoder().encode("TPL1"))
  w.u8(1)
  w.bytes(payload)
  const decoded = decodeTemporalBin(w.toUint8Array())
  assert.strictEqual(decoded.get("A"), "B")
  assert.strictEqual(decoded.get("B"), "C")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun run test packages/storage/src/Temporal.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 Temporal.ts**

写入 `/workspace/typescript/packages/storage/src/Temporal.ts`：

```ts
import { BinaryReader } from "@aura/codec/Binary"
import { bincodeDecodeStringMap } from "@aura/codec/Bincode"

export function decodeTemporalBin(buf: Uint8Array): Map<string, string> {
  const r = new BinaryReader(buf)
  const magic = new TextDecoder().decode(r.bytes(4))
  if (magic !== "TPL1") {
    throw new Error("invalid temporal.bin magic")
  }
  const version = r.u8()
  if (version !== 1) {
    throw new Error("unsupported temporal.bin version")
  }
  const payload = r.sliceRemaining()
  return bincodeDecodeStringMap(payload)
}
```

写入 `/workspace/typescript/packages/storage/src/index.ts`：

```ts
export * from "./Temporal"
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
bun run test packages/storage/src/Temporal.test.ts
```

Expected: PASS。

---

### Task 5: storage - brain.cog / brain.snap（魔数 + CRC32 + JSON payload）

**Files:**
- Create: `/workspace/typescript/packages/storage/src/Cognitive.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/Cognitive.test.ts`

- [ ] **Step 1: 写 failing test（COG1 entry decode + CRC32 校验）**

写入 `/workspace/typescript/packages/storage/src/Cognitive.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryWriter } from "@aura/codec/Binary"
import { decodeCognitiveLog } from "@aura/storage/Cognitive"

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of buf) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

it("decode brain.cog minimal", () => {
  const record = { id: "id1", content: "hello" }
  const payload = new TextEncoder().encode(JSON.stringify(record))
  const w = new BinaryWriter()
  w.bytes(new TextEncoder().encode("COG1"))
  w.u8(2)
  w.u8(0x01)
  w.u32le(payload.length)
  w.u32le(crc32(payload))
  w.bytes(payload)

  const ops = decodeCognitiveLog(w.toUint8Array())
  assert.strictEqual(ops.length, 1)
  assert.strictEqual(ops[0]._tag, "Store")
  assert.strictEqual(ops[0].record.id, "id1")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun run test packages/storage/src/Cognitive.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 Cognitive.ts（内置 CRC32，后续替换为依赖实现）**

写入 `/workspace/typescript/packages/storage/src/Cognitive.ts`：

```ts
import { BinaryReader } from "@aura/codec/Binary"

export type CognitiveOp =
  | { _tag: "Store"; record: any }
  | { _tag: "Update"; record: any }
  | { _tag: "Delete"; id: string }

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of buf) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function decodeCognitiveLog(buf: Uint8Array): CognitiveOp[] {
  const r = new BinaryReader(buf)
  const magic = new TextDecoder().decode(r.bytes(4))
  if (magic !== "COG1") {
    throw new Error("invalid brain.cog magic")
  }
  const version = r.u8()
  if (version !== 2) {
    throw new Error("unsupported brain.cog version")
  }

  const ops: CognitiveOp[] = []
  while (r.remaining() > 0) {
    const op = r.u8()
    const payloadLen = r.u32le()
    const expectedCrc = r.u32le()
    const payload = r.bytes(payloadLen)
    const actualCrc = crc32(payload)
    if (actualCrc !== expectedCrc) {
      continue
    }
    if (op === 0x01 || op === 0x02) {
      const json = new TextDecoder().decode(payload)
      const record = JSON.parse(json)
      ops.push({ _tag: op === 0x01 ? "Store" : "Update", record })
    } else if (op === 0x03) {
      const id = new TextDecoder().decode(payload).replaceAll("\u0000", "")
      ops.push({ _tag: "Delete", id })
    } else {
      continue
    }
  }
  return ops
}
```

修改 `/workspace/typescript/packages/storage/src/index.ts`：

```ts
export * from "./Temporal"
export * from "./Cognitive"
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
bun run test packages/storage/src/Cognitive.test.ts
```

Expected: PASS。

---

### Task 6: Rust fixture 生成器（输出最小 brain 目录）

**Files:**
- Create: `/workspace/src/bin/aura-ts-fixtures.rs`
- Create: `/workspace/typescript/test/fixtures/.gitkeep`

- [ ] **Step 1: 添加 Rust binary（生成 fixtures 到 typescript/test/fixtures/minimal_brain）**

写入 `/workspace/src/bin/aura-ts-fixtures.rs`：

```rust
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let out = std::env::args().nth(1).unwrap_or_else(|| {
        "typescript/test/fixtures/minimal_brain".to_string()
    });
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let storage = aura::storage::AuraStorage::new(&out)?;

    let record = aura::storage::StoredRecord {
        id: "ts_fixture_1".to_string(),
        dna: "user_core".to_string(),
        timestamp: 123456789.0,
        intensity: 5.5,
        stability: 1.0,
        decay_velocity: 0.1,
        entropy: 0.2,
        sdr_indices: vec![1, 10, 100, 2000],
        text: "Hello TS Fixture".to_string(),
        offset: 0,
    };
    storage.append(&record)?;
    storage.flush()?;

    Ok(())
}
```

- [ ] **Step 2: 创建 fixtures 目录占位**

创建 `/workspace/typescript/test/fixtures/.gitkeep`，内容为空。

- [ ] **Step 3: 运行 fixture 生成器**

Run (in `/workspace`):

```bash
cargo run --bin aura-ts-fixtures -- typescript/test/fixtures/minimal_brain
```

Expected: `typescript/test/fixtures/minimal_brain/brain.aura` 存在，且文件头魔数正确。

---

### Task 7: storage - brain.aura 只读解析（header + records）

**Files:**
- Create: `/workspace/typescript/packages/storage/src/BrainAura.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/BrainAura.test.ts`

- [ ] **Step 1: 写 failing test（读取 Rust fixture 的 brain.aura 并解析首条 record）**

写入 `/workspace/typescript/packages/storage/src/BrainAura.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import { readBrainAuraFile } from "@aura/storage/BrainAura"

it("read brain.aura from rust fixture", () => {
  const p = path.join(process.cwd(), "test/fixtures/minimal_brain/brain.aura")
  const buf = new Uint8Array(fs.readFileSync(p))
  const parsed = readBrainAuraFile(buf)
  assert.strictEqual(parsed.header.magic, "AURA")
  assert.strictEqual(parsed.records.length, 1)
  assert.strictEqual(parsed.records[0].id, "ts_fixture_1")
  assert.strictEqual(parsed.records[0].dna, "user_core")
  assert.strictEqual(parsed.records[0].text, "Hello TS Fixture")
  assert.deepStrictEqual(parsed.records[0].sdr_indices, [1, 10, 100, 2000])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun run test packages/storage/src/BrainAura.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 brain.aura 解析（对齐 storage.rs 的 header/record layout）**

写入 `/workspace/typescript/packages/storage/src/BrainAura.ts`：

```ts
import { BinaryReader } from "@aura/codec/Binary"

export type BrainAuraHeader = {
  magic: "AURA"
  version: number
  count: bigint
  created: number
}

export type StoredRecord = {
  id: string
  dna: string
  timestamp: number
  intensity: number
  stability: number
  decay_velocity: number
  entropy: number
  sdr_indices: number[]
  text: string
  offset: bigint
  encrypted_flag: number
}

const td = new TextDecoder()

function decodeFixedString(bytes: Uint8Array): string {
  return td.decode(bytes).replaceAll("\u0000", "")
}

export function readBrainAuraFile(buf: Uint8Array): { header: BrainAuraHeader; records: StoredRecord[] } {
  const r = new BinaryReader(buf)
  const magic = td.decode(r.bytes(4))
  if (magic !== "AURA") {
    throw new Error("invalid brain.aura magic")
  }
  const version = r.u32le()
  const count = r.u64leAsBigInt()
  const created = r.f64le()
  r.bytes(40)

  const header: BrainAuraHeader = {
    magic: "AURA",
    version,
    count,
    created
  }

  const records: StoredRecord[] = []
  while (r.remaining() > 0) {
    const offset = BigInt(buf.byteLength - r.remaining())
    let idBytes: Uint8Array
    try {
      idBytes = r.bytes(32)
    } catch {
      break
    }
    const id = decodeFixedString(idBytes)
    if (id.length === 0) {
      break
    }
    const dna = decodeFixedString(r.bytes(16))
    const timestamp = r.f64le()
    const intensity = r.f32le()
    const stability = r.f32le()
    const decay_velocity = r.f32le()
    const entropy = r.f32le()
    const sdr_count = r.u16le()
    const text_len = r.u32le()
    const encrypted_flag = r.u8()
    const sdr_indices: number[] = []
    for (let i = 0; i < sdr_count; i++) {
      sdr_indices.push(r.u16le())
    }
    const textBytes = r.bytes(text_len)
    const text = encrypted_flag === 0x01 ? "<encrypted - no key>" : td.decode(textBytes)

    records.push({
      id,
      dna,
      timestamp,
      intensity,
      stability,
      decay_velocity,
      entropy,
      sdr_indices,
      text,
      offset,
      encrypted_flag
    })
  }

  return { header, records }
}
```

- [ ] **Step 4: 修改 storage index 导出**

修改 `/workspace/typescript/packages/storage/src/index.ts`：

```ts
export * from "./Temporal"
export * from "./Cognitive"
export * from "./BrainAura"
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
bun run test packages/storage/src/BrainAura.test.ts
```

Expected: PASS（records.length == 1，字段对齐 fixture）。

---

### Task 8: core - Aura.open（只读：加载 brain.aura + cognitive + temporal）

**Files:**
- Create: `/workspace/typescript/packages/core/src/Aura.ts`
- Create: `/workspace/typescript/packages/core/src/index.ts`
- Test: `/workspace/typescript/packages/core/src/Aura.test.ts`

- [ ] **Step 1: 写 failing test（打开 fixtures 并返回 record 列表）**

写入 `/workspace/typescript/packages/core/src/Aura.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as path from "node:path"
import { Aura } from "@aura/core/index"

it("Aura.open loads minimal fixture", async () => {
  const brainPath = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const aura = await Aura.open(brainPath)
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0].id, "ts_fixture_1")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bun run test packages/core/src/Aura.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 Aura.open（先用最小 Node FS，M2 再替换为 effect-smol FileSystem service）**

写入 `/workspace/typescript/packages/core/src/Aura.ts`：

```ts
import * as fs from "node:fs"
import * as path from "node:path"
import { readBrainAuraFile, StoredRecord } from "@aura/storage/BrainAura"

export class Aura {
  private constructor(private readonly records: StoredRecord[]) {}

  static async open(brainPath: string): Promise<Aura> {
    const brainAuraPath = path.join(brainPath, "brain.aura")
    const buf = new Uint8Array(fs.readFileSync(brainAuraPath))
    const parsed = readBrainAuraFile(buf)
    return new Aura(parsed.records)
  }

  listRecords(): StoredRecord[] {
    return this.records.slice()
  }
}
```

写入 `/workspace/typescript/packages/core/src/index.ts`：

```ts
export * from "./Aura"
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
bun run test packages/core/src/Aura.test.ts
```

Expected: PASS。

---

## Plan Self-Review（执行前检查）

- 本计划满足 spec 的 M1：完成 typescript workspace、effect-smol 风格测试习惯引入、主链路文件解析、Rust fixture 对照
- 已显式标注不覆盖内容，避免把 “全量兼容” 一次性塞进 M1 导致不可控
- 后续计划必须优先解决：brain.aura 完整写入、加密跨语言互通、sdr.idx / roaring 序列化对齐

---

## Execution Handoff

计划已保存到：`docs/superpowers/plans/2026-05-20-aura-typescript-port-m1.md`。

两种执行方式：

1) **Subagent-Driven（推荐）** - 我按 Task 逐个派发子代理实现与验证，你每个 Task 完成后 review

2) **Inline Execution** - 我在当前会话里按计划逐步实现（适合快速迭代，但单次上下文更重）

你选 1 还是 2？
