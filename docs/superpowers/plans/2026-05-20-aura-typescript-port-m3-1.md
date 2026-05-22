# Aura TypeScript Port (M3-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 effect-smol 分层约束下，实现 `index_manifest.json + sdr.idx`（Roaring bitmap）读写互通，以及 `brain.cog + brain.snap` 写入互通；并用 Rust 端 fixture + verifier 做双向对照测试。

**Architecture:** contract 定义 `FileRead/FileWrite`（只读/仅写入）与 `Clock/Crypto`；platform-node 提供 Live Layer；indexing/storage 实现纯逻辑与格式，所有 IO 通过 Context 注入；测试使用 vitest + @effect/vitest，并在必要处用 `spawnSync` 调 Rust verifier。

**Tech Stack:** Bun、TypeScript、Effect、Vitest、roaring bitmap（WASM/JS 实现，要求序列化与 Rust roaring crate 兼容）。

---

## Scope（M3-1 覆盖 / 不覆盖）

覆盖：
- 倒排索引持久化：`index_manifest.json` + `sdr.idx`（与 [index.rs](file:///workspace/src/index.rs#L199-L251) 完全对齐）
- 倒排索引基本操作：add/remove/search（足以支撑后续 store 时增量更新）
- CognitiveStore 写入：`brain.cog` 追加写、`brain.snap` 原子写（与 [cognitive_store.rs](file:///workspace/src/cognitive_store.rs) 对齐）

不覆盖（M3-2）：
- 版本系统 `versions/*`
- 备份容器 `.bak`
- `.aura.learned/.aura.syn` 与 synonym toml
- `persistence_manifest.json` 归一化

---

## 依赖决策（Roaring 兼容优先）

Rust 使用 `roaring::RoaringBitmap::{serialize_into,deserialize_from}`（见 [index.rs](file:///workspace/src/index.rs#L209-L219)）。M3-1 需要一个在 Bun 可用、且序列化格式与 Rust roaring crate 兼容的实现。

本计划按以下优先级尝试：

1) `roaring-wasm`（WASM，通常基于 CRoaring，序列化与多数语言实现兼容）
2) 若不兼容：退回到“以 Rust 生成/校验”为准，TS 侧仅以 roaring 库做序列化/反序列化的字节对照，直到通过 fixture

---

## Files（新增/修改概览）

**Typescript**
- Create: `/workspace/typescript/packages/indexing/package.json`
- Create: `/workspace/typescript/packages/indexing/src/Roaring.ts`
- Create: `/workspace/typescript/packages/indexing/src/InvertedIndex.ts`
- Create: `/workspace/typescript/packages/indexing/src/index.ts`
- Test: `/workspace/typescript/packages/indexing/src/InvertedIndex.fixture.test.ts`
- Test: `/workspace/typescript/packages/indexing/src/InvertedIndex.roundtrip.test.ts`

- Modify: `/workspace/typescript/package.json`（添加 roaring 依赖）
- Modify: `/workspace/typescript/tsconfig.json`（加入 @aura/indexing paths）
- Modify: `/workspace/typescript/vitest.config.ts`（加入 @aura/indexing alias）

- Modify: `/workspace/typescript/packages/contract/src/FileWrite.ts`（补齐 rename，用于 brain.snap 原子写）
- Modify: `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`（实现 rename）
- Create: `/workspace/typescript/packages/storage/src/Crc32.ts` 或迁移到 `@aura/utils`
- Modify: `/workspace/typescript/packages/storage/src/Cognitive.ts`（复用统一 CRC32）
- Create: `/workspace/typescript/packages/storage/src/CognitiveStoreFile.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Test: `/workspace/typescript/packages/storage/src/CognitiveStoreFile.test.ts`

**Rust（fixture + verifier）**
- Create: `/workspace/src/bin/aura-ts-index-fixtures.rs`
- Create: `/workspace/src/bin/aura-ts-verify-index.rs`
- Create: `/workspace/src/bin/aura-ts-cognitive-fixtures.rs`
- Create: `/workspace/src/bin/aura-ts-verify-cognitive.rs`

---

### Task 1: 新增 @aura/indexing package + workspace 解析配置

**Files:**
- Create: `/workspace/typescript/packages/indexing/package.json`
- Create: `/workspace/typescript/packages/indexing/src/index.ts`
- Modify: `/workspace/typescript/tsconfig.json`
- Modify: `/workspace/typescript/vitest.config.ts`

- [ ] **Step 1: 创建 package.json**

写入 `/workspace/typescript/packages/indexing/package.json`：

```json
{
  "name": "@aura/indexing",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

- [ ] **Step 2: 创建空 index.ts**

写入 `/workspace/typescript/packages/indexing/src/index.ts`：

```ts
export {}
```

- [ ] **Step 3: tsconfig paths 加入 @aura/indexing**

在 `/workspace/typescript/tsconfig.json` 的 `paths` 追加：

```json
{
  "@aura/indexing": ["packages/indexing/src/index.ts"],
  "@aura/indexing/*": ["packages/indexing/src/*"]
}
```

- [ ] **Step 4: vitest alias 加入 @aura/indexing**

在 `/workspace/typescript/vitest.config.ts` 的 alias 追加：

```ts
"@aura/indexing": pkg("indexing")
```

- [ ] **Step 5: typecheck**

Run (in `/workspace/typescript`):

```bash
bun run typecheck
```

Expected: PASS。

---

### Task 2: 引入 Roaring 依赖并实现 Roaring 包装层

**Files:**
- Modify: `/workspace/typescript/package.json`
- Create: `/workspace/typescript/packages/indexing/src/Roaring.ts`
- Modify: `/workspace/typescript/packages/indexing/src/index.ts`
- Test: `/workspace/typescript/packages/indexing/src/Roaring.test.ts`

- [ ] **Step 1: 添加依赖 roaring-wasm**

修改 `/workspace/typescript/package.json` 的 dependencies，追加：

```json
{
  "roaring-wasm": "^0.8.0"
}
```

- [ ] **Step 2: bun install**

Run:

```bash
bun install
```

- [ ] **Step 3: 写 failing test（最小 serialize/deserialize 恒等）**

写入 `/workspace/typescript/packages/indexing/src/Roaring.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { RoaringBitmap } from "./Roaring"

it("roaring serialize/deserialize roundtrip", () => {
  const bm = RoaringBitmap.empty()
  bm.add(1)
  bm.add(10)
  bm.add(1000)
  const bytes = bm.serialize()
  const bm2 = RoaringBitmap.deserialize(bytes)
  assert.deepStrictEqual(bm2.toArray(), [1, 10, 1000])
})
```

- [ ] **Step 4: 实现 Roaring.ts**

写入 `/workspace/typescript/packages/indexing/src/Roaring.ts`：

```ts
import { RoaringBitmap32 } from "roaring-wasm"

export class RoaringBitmap {
  private constructor(private readonly inner: RoaringBitmap32) {}

  static empty(): RoaringBitmap {
    return new RoaringBitmap(new RoaringBitmap32())
  }

  static deserialize(bytes: Uint8Array): RoaringBitmap {
    return new RoaringBitmap(RoaringBitmap32.deserialize(bytes))
  }

  serialize(): Uint8Array {
    return this.inner.serialize()
  }

  add(v: number): void {
    this.inner.add(v >>> 0)
  }

  remove(v: number): void {
    this.inner.remove(v >>> 0)
  }

  has(v: number): boolean {
    return this.inner.has(v >>> 0)
  }

  and(other: RoaringBitmap): RoaringBitmap {
    return new RoaringBitmap(this.inner.and(other.inner))
  }

  or(other: RoaringBitmap): RoaringBitmap {
    return new RoaringBitmap(this.inner.or(other.inner))
  }

  toArray(): number[] {
    return Array.from(this.inner.toArray())
  }
}
```

- [ ] **Step 5: 更新 indexing 导出**

修改 `/workspace/typescript/packages/indexing/src/index.ts`：

```ts
export * from "./Roaring"
```

- [ ] **Step 6: 运行测试**

Run:

```bash
bun run test packages/indexing/src/Roaring.test.ts
```

Expected: PASS。

---

### Task 3: 实现 InvertedIndex（manifest + sdr.idx 读写 + 基本操作）

**Files:**
- Create: `/workspace/typescript/packages/indexing/src/InvertedIndex.ts`
- Modify: `/workspace/typescript/packages/indexing/src/index.ts`
- Test: `/workspace/typescript/packages/indexing/src/InvertedIndex.roundtrip.test.ts`

- [ ] **Step 1: 写 failing test（纯 TS roundtrip：save -> load）**

写入 `/workspace/typescript/packages/indexing/src/InvertedIndex.roundtrip.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { InvertedIndex } from "@aura/indexing"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

it("InvertedIndex save/load roundtrip", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-index-"))
  const program = Effect.gen(function* () {
    const idx = InvertedIndex.empty()
    idx.add("r1", [1, 2, 3])
    idx.add("r2", [2, 3])
    yield* idx.save(dir)
    const loaded = yield* InvertedIndex.load(dir)
    assert.deepStrictEqual(loaded.search([2, 3]).sort(), ["r1", "r2"].sort())
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  await Effect.runPromise(program)
})
```

- [ ] **Step 2: 实现 InvertedIndex.ts**

写入 `/workspace/typescript/packages/indexing/src/InvertedIndex.ts`：

```ts
import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"
import { BinaryReader, BinaryWriter } from "@aura/codec"
import { RoaringBitmap } from "./Roaring"

export type IndexManifest = {
  next_doc_id: number
  id_map: Record<string, number>
}

export class InvertedIndex {
  private constructor(
    private nextDocId: number,
    private readonly idMap: Map<string, number>,
    private readonly reverseMap: Map<number, string>,
    private readonly bitToDocs: Map<number, RoaringBitmap>
  ) {}

  static empty(): InvertedIndex {
    return new InvertedIndex(1, new Map(), new Map(), new Map())
  }

  static load(dir: string): Effect.Effect<InvertedIndex, unknown, FileRead> {
    const manifestPath = `${dir}/index_manifest.json`
    const sdrPath = `${dir}/sdr.idx`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const manifestBytes = yield* fr.readFile(manifestPath)
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as IndexManifest
      const idMap = new Map(Object.entries(manifest.id_map).map(([k, v]) => [k, v]))
      const reverseMap = new Map<number, string>()
      for (const [k, v] of idMap.entries()) reverseMap.set(v, k)

      const sdrBytes = yield* fr.readFile(sdrPath)
      const r = new BinaryReader(sdrBytes)
      const bitToDocs = new Map<number, RoaringBitmap>()
      while (r.remaining() > 0) {
        const bit = r.u16le()
        const len = r.u64leAsBigInt()
        const payload = r.bytes(Number(len))
        bitToDocs.set(bit, RoaringBitmap.deserialize(payload))
      }
      return new InvertedIndex(manifest.next_doc_id, idMap, reverseMap, bitToDocs)
    })
  }

  save(dir: string): Effect.Effect<void, unknown, FileWrite> {
    const manifestPath = `${dir}/index_manifest.json`
    const sdrPath = `${dir}/sdr.idx`
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)

      const id_map: Record<string, number> = {}
      for (const [k, v] of this.idMap.entries()) id_map[k] = v
      const manifest: IndexManifest = { next_doc_id: this.nextDocId, id_map }
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
      yield* fw.writeFile(manifestPath, manifestBytes)

      const w = new BinaryWriter()
      const entries = Array.from(this.bitToDocs.entries()).sort((a, b) => a[0] - b[0])
      for (const [bit, bm] of entries) {
        const payload = bm.serialize()
        w.u16le(bit)
        w.u64leFromBigInt(BigInt(payload.byteLength))
        w.bytes(payload)
      }
      yield* fw.writeFile(sdrPath, w.toUint8Array())
      yield* fw.fsync(sdrPath)
    }.bind(this))
  }

  add(externalId: string, bits: number[]): void {
    const docId = this.getOrCreateDocId(externalId)
    for (const b of bits) {
      const bit = b & 0xffff
      const bm = this.bitToDocs.get(bit) ?? RoaringBitmap.empty()
      bm.add(docId)
      this.bitToDocs.set(bit, bm)
    }
  }

  remove(externalId: string, bits: number[]): void {
    const docId = this.idMap.get(externalId)
    if (docId === undefined) return
    for (const b of bits) {
      const bit = b & 0xffff
      const bm = this.bitToDocs.get(bit)
      if (!bm) continue
      bm.remove(docId)
    }
  }

  search(bits: number[]): string[] {
    if (bits.length === 0) return []
    const first = this.bitToDocs.get(bits[0]! & 0xffff)
    if (!first) return []
    let acc = first
    for (let i = 1; i < bits.length; i++) {
      const bm = this.bitToDocs.get(bits[i]! & 0xffff)
      if (!bm) return []
      acc = acc.and(bm)
    }
    return acc.toArray().map((docId) => this.reverseMap.get(docId)!).filter(Boolean)
  }

  private getOrCreateDocId(externalId: string): number {
    const existing = this.idMap.get(externalId)
    if (existing !== undefined) return existing
    const next = this.nextDocId
    this.nextDocId += 1
    this.idMap.set(externalId, next)
    this.reverseMap.set(next, externalId)
    return next
  }
}
```

- [ ] **Step 3: 更新导出**

修改 `/workspace/typescript/packages/indexing/src/index.ts`：

```ts
export * from "./Roaring"
export * from "./InvertedIndex"
```

- [ ] **Step 4: 运行测试**

Run:

```bash
bun run test packages/indexing/src/InvertedIndex.roundtrip.test.ts
```

Expected: PASS。

---

### Task 4: Rust index fixtures + TS 读取 fixture 对照（验证 roaring 序列化兼容）

**Files:**
- Create: `/workspace/src/bin/aura-ts-index-fixtures.rs`
- Test: `/workspace/typescript/packages/indexing/src/InvertedIndex.fixture.test.ts`

- [ ] **Step 1: 生成 Rust fixture（index_manifest.json + sdr.idx）**

写入 `/workspace/src/bin/aura-ts-index-fixtures.rs`：

```rust
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let out = std::env::args().nth(1).unwrap_or_else(|| "typescript/test/fixtures/minimal_index".to_string());
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let mut idx = aura::index::InvertedIndex::new();
    idx.add("r1".to_string(), vec![1u16, 2u16, 3u16]);
    idx.add("r2".to_string(), vec![2u16, 3u16]);
    idx.save(&out)?;
    Ok(())
}
```

- [ ] **Step 2: 运行 fixture 生成器**

Run (in `/workspace`):

```bash
cargo run --bin aura-ts-index-fixtures -- typescript/test/fixtures/minimal_index
```

Expected: `typescript/test/fixtures/minimal_index/index_manifest.json` 与 `sdr.idx` 存在。

- [ ] **Step 3: TS 读取 fixture 并断言 search 结果一致**

写入 `/workspace/typescript/packages/indexing/src/InvertedIndex.fixture.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { InvertedIndex } from "@aura/indexing"
import { NodeFileReadLive } from "@aura/platform-node"

it("load rust fixture index and query", async () => {
  const dir = `${process.cwd()}/test/fixtures/minimal_index`
  const program = Effect.gen(function* () {
    const idx = yield* InvertedIndex.load(dir)
    assert.deepStrictEqual(idx.search([2, 3]).sort(), ["r1", "r2"].sort())
    assert.deepStrictEqual(idx.search([1]).sort(), ["r1"].sort())
  }).pipe(Effect.provide(NodeFileReadLive))
  await Effect.runPromise(program)
})
```

- [ ] **Step 4: 运行测试**

Run (in `/workspace/typescript`):

```bash
bun run test packages/indexing/src/InvertedIndex.fixture.test.ts
```

Expected: PASS（若失败，说明 roaring 序列化不兼容，需要换实现或调整）。

---

### Task 5: CognitiveStore 写入（brain.cog append + brain.snap 原子写）并对齐 Rust verifier

**Files:**
- Modify: `/workspace/typescript/packages/contract/src/FileWrite.ts`
- Modify: `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts`
- Create: `/workspace/typescript/packages/utils/src/Crc32.ts`
- Modify: `/workspace/typescript/packages/utils/src/index.ts`
- Modify: `/workspace/typescript/packages/storage/src/Cognitive.ts`
- Create: `/workspace/typescript/packages/storage/src/CognitiveStoreFile.ts`
- Modify: `/workspace/typescript/packages/storage/src/index.ts`
- Create: `/workspace/src/bin/aura-ts-cognitive-fixtures.rs`
- Create: `/workspace/src/bin/aura-ts-verify-cognitive.rs`
- Test: `/workspace/typescript/packages/storage/src/CognitiveStoreFile.test.ts`

- [ ] **Step 1: contract/FileWrite 增加 rename**

在 `/workspace/typescript/packages/contract/src/FileWrite.ts` 的接口追加：

```ts
rename: (from: string, to: string) => Effect.Effect<void>
```

- [ ] **Step 2: platform-node 实现 rename**

在 `/workspace/typescript/packages/platform-node/src/NodeFileWrite.ts` 的实现对象追加：

```ts
rename: (from, to) => Effect.tryPromise(() => fs.rename(from, to).then(() => undefined))
```

- [ ] **Step 3: utils 增加标准 CRC32（与 Rust crc32fast 一致的多项式）**

写入 `/workspace/typescript/packages/utils/src/Crc32.ts`：

```ts
export function crc32(buf: Uint8Array): number {
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
```

并在 `/workspace/typescript/packages/utils/src/index.ts` 追加：

```ts
export * from "./Crc32"
```

- [ ] **Step 4: storage/Cognitive.ts 复用 utils/crc32**

将 `/workspace/typescript/packages/storage/src/Cognitive.ts` 内部 crc32 实现删除，改为：

```ts
import { crc32 } from "@aura/utils"
```

- [ ] **Step 5: 实现 CognitiveStoreFile（Effect + FileRead/FileWrite）**

写入 `/workspace/typescript/packages/storage/src/CognitiveStoreFile.ts`：

```ts
import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"
import { BinaryReader, BinaryWriter } from "@aura/codec"
import { crc32, fixedBytes } from "@aura/utils"

const te = new TextEncoder()
const td = new TextDecoder()

export type RecordJson = unknown

export class CognitiveStoreFile {
  private constructor(private readonly dir: string, private readonly cogPath: string, private readonly snapPath: string) {}

  static open(dir: string): Effect.Effect<CognitiveStoreFile, unknown, FileRead | FileWrite> {
    const cogPath = `${dir}/brain.cog`
    const snapPath = `${dir}/brain.snap`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      const exists = yield* fr.exists(cogPath)
      if (!exists) {
        const w = new BinaryWriter()
        w.bytes(te.encode("COG1"))
        w.u8(2)
        yield* fw.writeFile(cogPath, w.toUint8Array())
        yield* fw.fsync(cogPath)
      }
      return new CognitiveStoreFile(dir, cogPath, snapPath)
    })
  }

  appendStore(record: RecordJson): Effect.Effect<void, unknown, FileWrite> {
    return this.appendOp(0x01, record)
  }

  appendUpdate(record: RecordJson): Effect.Effect<void, unknown, FileWrite> {
    return this.appendOp(0x02, record)
  }

  appendDelete(id: string): Effect.Effect<void, unknown, FileWrite> {
    const payload = fixedBytes(id, 12)
    return this.appendRaw(0x03, payload)
  }

  private appendOp(op: number, record: RecordJson): Effect.Effect<void, unknown, FileWrite> {
    const payload = te.encode(JSON.stringify(record))
    return this.appendRaw(op, payload)
  }

  private appendRaw(op: number, payload: Uint8Array): Effect.Effect<void, unknown, FileWrite> {
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      const w = new BinaryWriter()
      w.u8(op)
      w.u32le(payload.byteLength)
      w.u32le(crc32(payload))
      w.bytes(payload)
      yield* fw.appendFile(this.cogPath, w.toUint8Array())
    }.bind(this))
  }

  writeSnapshot(records: RecordJson[]): Effect.Effect<void, unknown, FileRead | FileWrite> {
    const tmp = `${this.snapPath}.tmp`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const fw = yield* Effect.service(FileWrite)

      const cogBytes = yield* fr.readFile(this.cogPath)
      const logPosition = BigInt(cogBytes.byteLength)

      const w = new BinaryWriter()
      w.bytes(te.encode("CSN1"))
      w.u8(2)
      w.u64leFromBigInt(logPosition)
      w.u32le(records.length)
      for (const rec of records) {
        const payload = te.encode(JSON.stringify(rec))
        w.u32le(payload.byteLength)
        w.bytes(payload)
      }
      yield* fw.writeFile(tmp, w.toUint8Array())
      yield* fw.fsync(tmp)
      yield* fw.rename(tmp, this.snapPath)
      yield* fw.fsync(this.snapPath)
    }.bind(this))
  }
}
```

- [ ] **Step 6: 导出 CognitiveStoreFile**

修改 `/workspace/typescript/packages/storage/src/index.ts`：

```ts
export * from "./CognitiveStoreFile"
```

- [ ] **Step 7: Rust cognitive fixture + verifier**

写入 `/workspace/src/bin/aura-ts-cognitive-fixtures.rs`：

```rust
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let out = std::env::args().nth(1).unwrap_or_else(|| "typescript/test/fixtures/minimal_cognitive".to_string());
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let mut store = aura::cognitive_store::CognitiveStore::new(&out)?;
    let rec = aura::record::Record::new("id1".to_string(), "hello".to_string());
    store.append_store(&rec)?;
    store.write_snapshot(&[rec.clone()])?;
    Ok(())
}
```

写入 `/workspace/src/bin/aura-ts-verify-cognitive.rs`：

```rust
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let brain_path = std::env::args().nth(1).expect("brain path");
    let brain_path = PathBuf::from(brain_path);
    let store = aura::cognitive_store::CognitiveStore::new(&brain_path)?;
    let all = store.load_all()?;
    println!("{}", serde_json::json!({ "count": all.len() }));
    Ok(())
}
```

- [ ] **Step 8: TS 测试（TS 写 -> Rust load_all 验证）**

写入 `/workspace/typescript/packages/storage/src/CognitiveStoreFile.test.ts`：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile } from "@aura/storage"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

it("TS cognitive write is readable by Rust", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cog-"))
  const program = Effect.gen(function* () {
    const store = yield* CognitiveStoreFile.open(dir)
    yield* store.appendStore({ id: "id1", content: "hello" })
    yield* store.writeSnapshot([{ id: "id1", content: "hello" }])
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  await Effect.runPromise(program)

  const proc = spawnSync("cargo", ["run", "--quiet", "--bin", "aura-ts-verify-cognitive", "--", dir], {
    cwd: path.join(process.cwd(), ".."),
    encoding: "utf8"
  })
  assert.strictEqual(proc.status, 0)
  const out = JSON.parse(proc.stdout.trim())
  assert.strictEqual(out.count, 1)
})
```

- [ ] **Step 9: 运行测试**

Run:

```bash
cargo run --bin aura-ts-cognitive-fixtures -- typescript/test/fixtures/minimal_cognitive
bun run test packages/storage/src/CognitiveStoreFile.test.ts
```

Expected: PASS。

---

## Plan Self-Review

- 索引部分严格复刻 Rust `index.rs` 的 save/load 字节布局，并通过 Rust fixture 验证 roaring 序列化兼容
- Cognitive 写入按 Rust `cognitive_store.rs` 的 header/entry/snapshot/tmp+rename 流程实现
- 所有 IO 通过 `FileRead/FileWrite` 注入，符合 effect-smol 分层纠偏 spec

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-05-20-aura-typescript-port-m3-1.md`。

默认按你之前的选择用 Subagent-Driven 执行；如果你想改为 Inline Execution，再告诉我即可。

