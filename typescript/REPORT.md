# 代码审查报告 — xhigh 级别

**审查范围:** `2c67139..HEAD` — 185 个文件，~32K+ 行新增  
**审查日期:** 2026-05-26  
**审查方法:** 5 角度并行扫描 + 逐项验证 + 扫尾补漏

---

## 🔴 HIGH（4 个）

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| **1** | `code-extraction/src/index.ts` | 408 | **`orchestrator.indexFiles()` 前缺少 `await`** — `finally` 块中的 `fileLock.release()` 在异步索引完成前就执行了。并发进程在索引还在进行时就获取到了锁，导致 SQLite 数据损坏或"database is locked"错误。修复：加上 `await`。 |
| **2** | `code-extraction/src/db/sqlite-adapter.ts` | ~3627 | **实际使用 `require('bun:sqlite')`，不是 `node:sqlite`** — 类名叫 `NodeSqliteAdapter`，文档说封装了 Node 内置的 `node:sqlite`，但代码实际导入的是 Bun 的 SQLite 模块。在标准 Node.js 22.5+ 环境下直接 `MODULE_NOT_FOUND`。 |
| **3** | `storage/src/CognitiveRecord.ts` vs `CognitiveStoreFile.ts` | — | **`brain.cog` 二进制解析逻辑重复** — 两个文件各自独立实现了相同的格式解析（魔数 "COG1"/"CSN1"、CRC 校验、op-code 0x01/0x02/0x03 分发）。若只改其中一处，另一处会静默产生错误数据 — 没有编译报错，没有共享的格式常量。 |
| **4** | `storage/src/BrainAura.ts` | 104 | **直接从 `@aura/codec` 调用 `decryptData`，绕过 `Crypto` 服务** — 读路径绕过了 Crypto 服务标签。写路径（`BrainAuraFile`）正确地通过 Crypto → `CryptoError` 包装。读路径抛出裸 `Error`，被 catch 后映射为字符串 `"<decryption failed>"`，丢失了结构化的 `CryptoError` 类型信息。 |

## 🟡 MEDIUM（7 个）

| # | 文件 | 行号 | 问题 |
|---|------|------|------|
| **5** | `storage/src/CogJsonSnapshotFile.ts` | 25-32 | **save 方法没有原子 rename** — 直接通过 `writeFile` + `fsync` 写入目标文件。中途崩溃会留下截断/损坏的文件。同包内的 `CognitiveStoreFile.writeSnapshot` 使用了正确的 tmp+rename 模式。重启时 4 个 `*StoreFile.load` 调用方都会失败，因为 `empty()` 回退只在文件不存在或为空时触发，不覆盖部分写入的文件。 |
| **6** | `belief/src/BeliefEngine.ts`, `concept/src/ConceptEngine.ts` | ~411, ~716 | **通过 `Layer.succeed` 暴露单例可变状态 — 非协程安全** — 在 `Effect.gen` 块内执行 `self.state = {...}` 这种读-改-写操作。两个并发协程可能读取同一份快照，各自计算后互相覆盖结果。写入丢失且无任何诊断。修复：使用 Effect 的 `Ref` 或 `MutableRef`。 |
| **7** | `code-extraction/src/extraction/index.ts` | ~5819 | **Worker 超时回调与并发 `requestParse` 存在竞态** — 超时将 `parseWorker` 设为 null 并终止 worker，但下一次迭代的 `ensureWorker()` 在旧 worker 的 WASM 堆释放前就创建了新 worker。双堆可能导致 OOM。重试路径通过 `recycleWorker()` 规避了此问题，但正常超时路径没有同样的保护。 |
| **8** | `code-extraction/src/db/sqlite-adapter.ts` | 188-200 | **`transaction()` 包装器不处理异步回调** — COMMIT 在异步任务完成前就执行了；异步 rejection 发生时 ROLLBACK 永远不会触发。当前判定为 PLAUSIBLE（所有调用方都是同步的），但是一个潜在的隐患。 |
| **9** | `code-extraction/src/resolution/callback-synthesizer.ts` | 109 | **符号名直接拼接进正则表达式，未转义** — `new RegExp(\`${reg.node.name}\\s*\\(...\`)`。包含 `$` 的符号名（如 `$emit`、`$on`）会导致正则失效。项目中 `cargo-workspace.ts` 已有 `escapeRegExp` 函数且用于相同场景，但此处未使用。 |
| **10** | `code-extraction/src/extraction/index.ts` | 5779-5807 | **`recycleWorker()` 返回 void，却被 `await` 调用** — `w.terminate()` 是 fire-and-forget 的，`await recycleWorker()` 立即 resolve，此时 WASM 内存尚未释放。紧接着 `ensureWorker()` 创建新 worker，在内存受限环境下可能失败。 |
| **11** | 多个 extractor 文件 | — | **路径分隔符处理不一致** — `DfmExtractor` 只用 `'/'` 分割；`SvelteExtractor`/`VueExtractor` 用 `/[/\\]/` 同时处理两种分隔符。Windows 下反斜杠路径会导致 DFM extractor 生成错误文件名 → 跨会话节点 ID 不稳定。 |

## 🟢 LOW（4 个）

| # | 文件 | 问题 |
|---|------|------|
| 12 | `code-extraction/src/search/query-utils.ts` | `matchesNonProductionDir` 子串误匹配 — `my-integration-core/` 会匹配到 `/integration/` |
| 13 | `concept/src/ConceptEngine.ts` | 7 处残留的内联 `import("@aura/contract")` 未迁移为顶层 `import type`（可维护性问题） |
| 14 | `code-extraction/src/context/formatter.ts` | 树形连接符在最后一个 edge-kind 分组仍用 `├──` 而非 `└──`（视觉问题） |
| 15 | `code-extraction/src/utils.ts` | `debounce`/`throttle` 静默吞掉异步 rejection（timer 回调中 fire-and-forget） |

---

## ❌ 已排除

- `*StoreImpl` 缺少 `implements` — `Layer.succeed` 处已有结构类型检查，类型不匹配会编译报错
- `sliceLines` 的 falsy-zero — 行号明确定义为 1-indexed，0 不是合法输入

---

## 总结

- **15 个发现:** 4 个 HIGH, 7 个 MEDIUM, 4 个 LOW
- contract 包的内联 import 重构：无问题
- 所有 bug 集中在 `code-extraction/` 包和 `storage/` 包
- 建议优先修复 #1（并发锁问题）和 #2（Node.js 兼容性）
