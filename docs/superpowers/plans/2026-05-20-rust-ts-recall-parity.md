# Rust/TS Recall Parity (Fixtures + Verifier + Vitest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增确定性的 Rust recall fixture 生成器与 Rust recall verifier，并新增 TS parity 测试：Rust 与 TS 在同一 brain 目录与同一 query 下输出的 recall id 序列完全一致（覆盖 SDR + tags + ngram 三信号融合）。

**Architecture:** Rust 侧提供两个 `cargo run --bin ...` 工具：一个生成临时 brain fixture（`brain.aura` + `index/` + `brain.cog` + `brain.snap`），一个读取 brain fixture 运行 Rust recall pipeline 并输出 JSON id 序列。TS 侧 vitest 测试在临时目录生成 fixture 后，分别调用 Rust verifier 与 `Aura.recallScored`，断言 id 序列一致。

**Tech Stack:** Rust (cargo bin + aura crate modules), TypeScript (bun + vitest + @effect/vitest), Node `spawnSync`.

---

## 文件结构

**Rust**
- Create: [/workspace/src/bin/aura-ts-recall-fixtures.rs](file:///workspace/src/bin/aura-ts-recall-fixtures.rs)
- Create: [/workspace/src/bin/aura-ts-verify-recall.rs](file:///workspace/src/bin/aura-ts-verify-recall.rs)
- Modify: [/workspace/src/ngram.rs](file:///workspace/src/ngram.rs)（为 verifier 提供确定性的 seeded 构造器；不改变默认行为）

**TypeScript**
- Create: [/workspace/typescript/packages/core/src/Recall.parity.test.ts](file:///workspace/typescript/packages/core/src/Recall.parity.test.ts)

---

## 关键对齐点（实现前确认）

- Rust `compute_effective_trust` 与 TS `computeEffectiveTrust` 的 recency boost 公式不同（Rust：线性衰减并 clamp；TS：指数衰减）。本计划通过让两条记录的 trust multiplier 完全一致来保证最终排序不受影响。
- Rust ngram 使用 MinHash+LSH；TS ngram 目前是 trigram Jaccard。这里不追求中间分数一致，只要求最终排序一致；fixture 文本确保两者都给出 `r1 > r2`，且不打平。

---

### Task 1: 为 Rust NGramIndex 增加可复现的 seeded 构造器

**Files:**
- Modify: [/workspace/src/ngram.rs](file:///workspace/src/ngram.rs)
- Test: （复用现有单测风格，新增一个最小确定性测试即可）

- [ ] **Step 1: 写一个失败测试，证明同 seed 下签名一致**

在 `src/ngram.rs` 的 `#[cfg(test)]` 模块里新增测试（放在文件末尾，沿用现有测试风格）：

```rust
#[test]
fn test_ngram_seeded_is_deterministic() {
    let mut a = NGramIndex::with_seed(Some(32), None, 0);
    a.add("r1", "alpha");
    a.add("r2", "alpha zeta");

    let mut b = NGramIndex::with_seed(Some(32), None, 0);
    b.add("r1", "alpha");
    b.add("r2", "alpha zeta");

    let qa = a.query("alpha", 10);
    let qb = b.query("alpha", 10);
    assert_eq!(qa, qb);
}
```

- [ ] **Step 2: 运行 Rust 测试确认失败**

Run:

```bash
cargo test -q
```

Expected: 编译失败（`with_seed` 不存在）。

- [ ] **Step 3: 增加 `NGramIndex::with_seed` 实现（不改默认 new 行为）**

在 `src/ngram.rs` 的 `impl NGramIndex` 里新增：

```rust
pub fn with_seed(num_hashes: Option<usize>, synonym_ring: Option<SynonymRing>, seed: u64) -> Self {
    use rand::{Rng, SeedableRng};
    let num_hashes = num_hashes.unwrap_or(DEFAULT_NUM_HASHES);
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    let a: Vec<u64> = (0..num_hashes).map(|_| rng.gen_range(1..PRIME)).collect();
    let b: Vec<u64> = (0..num_hashes).map(|_| rng.gen_range(0..PRIME)).collect();
    let buckets = (0..num_hashes).map(|_| AHashMap::new()).collect();
    Self {
        num_hashes,
        a,
        b,
        signatures: AHashMap::new(),
        buckets,
        synonym_ring,
    }
}
```

要求：
- 现有 `new()` 继续使用 `thread_rng()`，保持行为不变
- `with_seed` 只用于测试/fixture/verifier（不会影响主流程，除非未来显式调用）

- [ ] **Step 4: 运行 Rust 测试确认通过**

Run:

```bash
cargo test -q
```

Expected: PASS

---

### Task 2: 实现 Rust fixture 生成器 `aura-ts-recall-fixtures`

**Files:**
- Create: [/workspace/src/bin/aura-ts-recall-fixtures.rs](file:///workspace/src/bin/aura-ts-recall-fixtures.rs)

- [ ] **Step 1: 定义 fixture 的常量与记录内容**

固定两条 cognitive record（12 hex id）与对应 aura_id（aura 侧 record id）：

- `record_id_r1 = "000000000001"`, `aura_id_r1 = "aura_r1"`
- `record_id_r2 = "000000000002"`, `aura_id_r2 = "aura_r2"`

内容与 tags：
- r1: `content = "alpha"`, `tags = ["alpha"]`
- r2: `content = "alpha zeta"`, `tags = ["alpha", "x"]`

这三条信号都能区分顺序：
- tags Jaccard：1.0 vs 0.5
- ngram：query="alpha" 时 r1 更高
- sdr：query="alpha" 时 r1 tanimoto 更高

- [ ] **Step 2: 生成 `brain.aura`**

使用 `aura::sdr::SDRInterpreter::default()` 计算：
- `sdr_indices_r1 = sdr.text_to_sdr("alpha", false)`
- `sdr_indices_r2 = sdr.text_to_sdr("alpha zeta", false)`

然后用 `aura::storage::AuraStorage` 写两条 `StoredRecord`：
- `StoredRecord.id = aura_id_rx`
- 其它字段全固定（timestamp/intensity/stability/decay_velocity/entropy/encrypted_flag/offset）

Runbook：
- `AuraStorage::new(out_dir)`
- `append` 两次
- `flush`

- [ ] **Step 3: 生成 `index/`（inverted index）**

输出目录结构：
- `${out}/index/index_manifest.json`
- `${out}/index/sdr.idx`

用 `aura::index::InvertedIndex`：
- `InvertedIndex::new(out.join("index"))`
- `add(aura_id_r1, &sdr_indices_r1)`
- `add(aura_id_r2, &sdr_indices_r2)`
- `save()`

- [ ] **Step 4: 生成 `brain.cog` + `brain.snap`**

用 `aura::cognitive_store::CognitiveStore`，写入两条 `aura::record::Record`（确保 determinism）：
- `id` 覆盖为固定 12 hex
- `content/tags/aura_id` 按上面常量
- `created_at/last_activated` 固定为同一个常量（例如 `1_700_000_000.0`）
- `strength = 1.0`
- `namespace = "default"`
- `source_type = "recorded"`
- `metadata = {}`，`connections = {}`

写入流程：
- `append_store(r1)`
- `append_store(r2)`
- `let records = store.load_all()?;`
- `store.write_snapshot(&records)?;`

- [ ] **Step 5: 添加 CLI 参数与默认输出目录（仅用于本地手跑）**

二进制签名：
- `cargo run --bin aura-ts-recall-fixtures -- <out_dir>`

若 `<out_dir>` 缺省，可默认写到：
- `typescript/test/fixtures/recall_parity`（但测试用例会传临时目录，所以默认值仅用于开发）

- [ ] **Step 6: 本地验证 fixture 文件齐全**

Run:

```bash
tmp="$(mktemp -d)"
cargo run --quiet --bin aura-ts-recall-fixtures -- "$tmp"
ls -la "$tmp" "$tmp/index"
```

Expected:
- `$tmp/brain.aura`
- `$tmp/temporal.bin`（若 AuraStorage 自动生成）
- `$tmp/index/index_manifest.json`
- `$tmp/index/sdr.idx`
- `$tmp/brain.cog`
- `$tmp/brain.snap`

---

### Task 3: 实现 Rust recall verifier `aura-ts-verify-recall`

**Files:**
- Create: [/workspace/src/bin/aura-ts-verify-recall.rs](file:///workspace/src/bin/aura-ts-verify-recall.rs)

- [ ] **Step 1: CLI 约定与输出格式**

命令：
- `cargo run --bin aura-ts-verify-recall -- <brain_dir> <query>`

输出（stdout）：
- JSON 数组：`["000000000001","000000000002"]`

- [ ] **Step 2: 加载 brain 所需结构**

从 `<brain_dir>` 组装 `recall::recall_pipeline` 所需依赖：
- `records: HashMap<String, Record>`：`CognitiveStore::new(brain_dir)?.load_all()?`
- `tag_index: HashMap<String, HashSet<String>>`：遍历 `records`，按 `tag.to_lowercase()` 建立 inverted map
- `aura_index: HashMap<String, String>`：遍历 `records`，若 `rec.aura_id.is_some()` 则 `aura_id -> rec.id`
- `storage: AuraStorage::new(brain_dir)?`
- `index: InvertedIndex::new(brain_dir.join("index")); index.load()?;`
- `sdr: SDRInterpreter::default()`
- `ngram: NGramIndex::with_seed(None, None, 0)`，并对每条 record 执行 `ngram.add(&rec.id, &rec.content)`

- [ ] **Step 3: 调用 Rust recall pipeline 并输出 ids**

调用：

```rust
let scored = aura::recall::recall_pipeline(
    query,
    10,
    0.0,
    false,
    &sdr,
    &index,
    &storage,
    &ngram,
    &tag_index,
    &aura_index,
    &records,
    None,
    None,
    None,
);
let ids: Vec<String> = scored.into_iter().map(|(_, r)| r.id).collect();
println!("{}", serde_json::to_string(&ids)?);
```

- [ ] **Step 4: 手动跑 verifier 确认输出稳定**

Run:

```bash
tmp="$(mktemp -d)"
cargo run --quiet --bin aura-ts-recall-fixtures -- "$tmp"
cargo run --quiet --bin aura-ts-verify-recall -- "$tmp" "alpha"
```

Expected:
- 输出为 JSON 数组，长度 2，顺序为 r1 在前

---

### Task 4: 新增 TS parity 测试 `Recall.parity.test.ts`

**Files:**
- Create: [/workspace/typescript/packages/core/src/Recall.parity.test.ts](file:///workspace/typescript/packages/core/src/Recall.parity.test.ts)

- [ ] **Step 1: 新增测试文件（沿用现有 spawnSync + @effect/vitest 风格）**

测试逻辑（伪码到可直接落地的 TS）：

```ts
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { Clock } from "@aura/contract"
import { NodeFileReadLive } from "@aura/platform-node"
import { Aura } from "./Aura"

function fixedClock(nowUnixSec: number) {
  return { nowSeconds: () => Effect.succeed(nowUnixSec) }
}

it("Rust recall verifier parity with TS Aura.recallScored (SDR+tags+ngram)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recall-parity-"))

  const repoRoot = path.join(process.cwd(), "..")

  const gen = spawnSync("cargo", ["run", "--quiet", "--bin", "aura-ts-recall-fixtures", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8"
  })
  assert.strictEqual(gen.status, 0, gen.stderr)

  const query = "alpha"
  const rust = spawnSync(
    "cargo",
    ["run", "--quiet", "--bin", "aura-ts-verify-recall", "--", dir, query],
    { cwd: repoRoot, encoding: "utf8" }
  )
  assert.strictEqual(rust.status, 0, rust.stderr)
  const rustIds: string[] = JSON.parse(rust.stdout.trim())

  const clock = fixedClock(1_700_000_000)
  const tsScored = await Effect.runPromise(
    Aura.recallScored(dir, query, { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provideService(Clock, clock)
    )
  )
  const tsIds = tsScored.map(([, id]) => id)

  assert.deepStrictEqual(tsIds, rustIds)
  assert.deepStrictEqual(tsIds, ["000000000001", "000000000002"])
})
```

注意点：
- `cwd` 必须指向 monorepo 根目录（参考现有 `BrainAuraFile.test.ts` 的 `cwd: path.join(process.cwd(), "..")`）
- 断言失败时把 `stderr` 带出来，便于定位 cargo 错误

- [ ] **Step 2: 运行 typecheck**

Run:

```bash
cd /workspace/typescript
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: 运行 vitest**

Run:

```bash
cd /workspace/typescript
bun run test
```

Expected: PASS

---

## 端到端验证清单

- [ ] `cargo test -q` 通过
- [ ] `cd typescript && bun run typecheck` 通过
- [ ] `cd typescript && bun run test` 通过

---

## 执行注意事项（遇到无法对齐点先停）

如果出现以下情况之一，需要先停下来征询再继续，而不是“改到能过”为止：
- Rust/TS recall 结果出现打平（导致排序不稳定）
- Rust ngram seeded 后仍出现不稳定（例如 rand crate feature/StdRng 不可用）
- cargo 在 CI 环境耗时过长导致测试不可接受

