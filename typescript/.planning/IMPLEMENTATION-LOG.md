# Implementation Log

## 2026-06-01 - Core Graph remove_record skeleton and Aura.delete cleanup

- 范围：`packages/core/src/Graph.ts`、`packages/core/src/Graph.test.ts`、`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`、`packages/core/src/index.ts`。
- 实现：在 core 包内新增 `Graph.ts` 骨架，承载 Rust `graph.rs` 对应的纯内存 graph 逻辑；未新建 workspace package，保持 core facade 内部模块结构与 Rust 包结构可对照。
- 实现：新增 `removeRecord(recordId, records)`，按 Rust `graph::remove_record` 只访问目标 record 的 `connections` keys，移除目标 record，并清理这些已知邻居上的反向 `connections` 与 `connection_types`。
- 实现：`Aura.delete` 改为复用 `removeRecord`，并将受影响邻居追加为 `Update` 后再写 delete tombstone；这是 TS 当前逐操作 replay `brain.cog` 架构下保持后续操作不重新读回已删边所必需的持久化收敛。
- 实现：`Aura.delete` 的 search read model 直接替换为 graph helper 返回的 records map；删除旧的 facade-local `removeSearchRecord` 私有方法，避免把 Rust `graph.rs` 逻辑继续内联在 `Aura.ts`。
- 测试：新增 `Graph.test.ts` 覆盖 target-known neighbor cleanup 与“不全表扫描 incoming-only 脏边”的 Rust 语义；扩展 `Aura.test.ts` 覆盖 delete 后 open Aura view 与 `brain.cog` replay 均不再保留已知邻居反向边。
- Rust reference：`graph::remove_record`（`../src/graph.rs`），`Aura::delete`（`../src/aura.rs`）。
- 验证：
  - `bun run test packages/core/src/Graph.test.ts packages/core/src/Aura.test.ts` 通过，2 files / 35 tests。
  - `bun run typecheck` 通过。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，56 files / 545 tests。

## 2026-06-01 - SDRInterpreter xxh3 seed parity

- 范围：`packages/recall/src/SDRInterpreter.ts`、`packages/recall/src/SDRInterpreter.test.ts`、`packages/recall/package.json`、根 `package.json` 与 `bun.lock`。
- 实现：`SDRInterpreter` 移除 `xxhash-wasm` lazy hasher 和 `h64Raw` 注入字段，所有 ASCII / UTF-8 quadgram、trigram、bigram seed 点统一复用 `@aura/utils` 的 Rust-compatible `xxh3_64`。
- 实现：保留 `SDRInterpreter.default()` / `lite()` / `withResolution()` 的 async 外部签名以避免扩大调用面，但内部构造已同步化；补齐类与方法签名前 JSDoc，移除过期 `SIMPLE IMPLEMENTATION` 标记。
- 实现：根依赖移除 `xxhash-wasm`，`@aura/recall` 显式声明 `@aura/utils` workspace 依赖。
- 实现：同步纳入中文注释规范化，将 JSDoc 中文说明行统一为 `@zh ...` 形式。
- 测试：`SDRInterpreter.test.ts` 新增保存的 Rust fixture exact vector，锁定 `SDRInterpreter::text_to_sdr("alpha", false)` 输出；本轮尝试重新运行 Rust `aura-ts-recall-fixtures` 被本机 Cargo `target/debug/.cargo-lock` 权限错误挡住，因此未把 live Rust 生成伪装成通过。
- Rust reference：`SDRInterpreter::text_to_sdr_inner` 的 `xxhash_rust::xxh3::xxh3_64` seed 点（`../src/sdr.rs`）。
- 验证：
  - `bun install --lockfile-only` 更新 lockfile，移除 `xxhash-wasm` 并记录 `@aura/recall` 的 `@aura/utils` 依赖。
  - `bun run test packages/recall/src/SDRInterpreter.test.ts` 通过，1 file / 4 tests。
  - `bun run typecheck` 通过。
  - `bun run test packages/recall/src/SDRInterpreter.test.ts packages/recall/src/Signals.test.ts packages/recall/src/Pipeline.test.ts` 通过，3 files / 17 tests。
  - `git diff --check` 通过（仅 CRLF warning）。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，55 files / 542 tests。

## 2026-06-01 - NGramIndex SynonymRing expansion parity

- 范围：`packages/indexing/src/SynonymRing.ts`、`packages/indexing/src/NGramIndex.ts`、`packages/indexing/src/NGramIndex.test.ts`、`packages/indexing/src/index.ts`。
- 实现：新增纯逻辑 `SynonymRing`，对齐 Rust `SynonymRing::add_pair`、`add_group`、`get`、`expand`、`len`、`is_empty`、`contains` 的双向同义词环语义；不在 `@aura/indexing` 引入 `node:*` 或文件 IO。
- 实现：`NGramIndex.random()` / `NGramIndex.withSeed0()` 接受可选 `SynonymRing`，并在 `add()` / `query()` 前按 Rust `NGramIndex::expand` 执行同义词扩展；移除缺少 SynonymRing 的 NON-PARITY 标记。
- Rust reference：`SynonymRing`（`../src/synonym.rs`），`NGramIndex::expand` / `NGramIndex::add` / `NGramIndex::query`（`../src/ngram.rs`）。
- 验证：
  - `bun run test packages/indexing/src/NGramIndex.test.ts` 通过，1 file / 5 tests。
  - `bun run typecheck` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，54 files / 536 tests。
  - 备注：默认并发 `bun run test` 两次在测试执行末尾触发 Vitest/tinypool worker teardown 的 `RangeError: Maximum call stack size exceeded`，单线程池全量通过。

## 2026-06-01 - Core/RRF 签名 JSDoc 注释规范补齐

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Recall.ts`、`packages/recall/src/RRF.ts`。
- 实现：将写入、搜索、维护、治理、解释、纠正、unsupported facade、core recall trust helper、`rrfFuse` 等函数/方法的签名说明从函数体首行 `//` 迁移到签名前块级 JSDoc，保留 `SIMPLE IMPLEMENTATION:` / `UNIMPLEMENTED:` 等可搜索前缀与 Rust reference。
- 实现：保留函数体内部流程注释，仅修正承担 API/签名说明职责的注释，避免把算法步骤说明混入签名文档。
- Rust reference：`Aura::store_code`、`Aura::store_decision`、`Aura::store`、`Aura::update`、`Aura::delete`、`Aura::connect`、`Aura::search`、`Aura::stats`、`Aura::run_maintenance`、`Aura::explain_recall`、`Aura::get_suggested_corrections_report`（`../src/aura.rs`），`rrf_fuse`（`../src/recall.rs`）。
- 验证：
  - `git diff --check` 通过。
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Aura.test.ts packages/core/src/Recall.test.ts packages/recall/src/RRF.test.ts` 通过，3 files / 39 tests。
  - `bun run test` 通过，54 files / 535 tests。

## 2026-06-01 - RRF 签名与过滤位置确认

- 范围：`packages/recall/src/RRF.ts`、`packages/recall/src/RRF.test.ts`。
- 结论：`filterByStrengthAndNamespace` 已内置在 `RRF.ts`，`rrfFuse(records, rankedLists, minStrength, topK, namespaces)` 签名已对齐 Rust `rrf_fuse`。
- Rust reference：`rrf_fuse(...).filter_map(...)`（`../src/recall.rs`）。
- 验证：`bun run test packages/recall/src/RRF.test.ts` 通过，3 tests。
- 关联提交：`271dcaa Internalize RRF filter helper`。

## 2026-06-01 - Aura decay/reflect 维护 facade 对齐

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`。
- 实现：新增 `Aura.decay()`，按 Rust `Record::apply_decay` / `Level::decay_rate` 应用 strength 衰减，衰减 connections，归档 strength `< 0.05` 的 records，并刷新 core search read model。
- 实现：新增 `Aura.reflect()`，按 Rust `Record::can_promote`、空 semantic promotion 分支、contextual hub promotion、dead record archival 返回 `{ promoted, archived }`。
- 细节：contextual hub promotion 使用 10+ connections、strength >= 0.5、非 Identity、平均连接权重 >= 0.4；TS 侧对边界浮点加 `Number.EPSILON`，避免 10 个 `0.4` 累加低一 ulp 时偏离 Rust f32 阈值语义。
- Rust reference：`Aura::decay` / `py_decay`、`Aura::reflect` / `py_reflect`（`../src/aura.rs`），`Record::apply_decay` / `Record::is_alive` / `Record::can_promote`（`../src/record.rs`），`Level::decay_rate`（`../src/levels.rs`）。
- 验证：
  - `bun run test packages/core/src/Aura.test.ts` 通过，31 tests。
  - `bun run typecheck` 通过。
  - `bun run test` 通过，54 files / 530 tests。
  - PyO3 surface regex check：`rust_py_total 158`，`missing 70`；首批缺口为 `end_session`、`set_taxonomy`、`get_taxonomy`、`get_structural_relations`、`get_relations` 等。

## 2026-06-01 - Aura end_session / SessionTracker 对齐

- 范围：`packages/core/src/RecallFinalizer.ts`、`packages/core/src/Recall.ts`、`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`。
- 实现：新增 Aura-owned ephemeral `RecallSessionTracker`，对齐 Rust `Aura { session_tracker: RwLock<SessionTracker> }` 的实例级状态边界。
- 实现：`RecallFinalizerFileLive` 在带 `sessionId` 的 recall finalize 后记录 top-10 record IDs，对齐 Rust `activate_and_strengthen(..., session_tracker, session_id)` 的 session tracking 逻辑。
- 实现：新增 `Aura.end_session(session_id)`，按 Rust `SessionTracker::end_session` / `consolidate_session` 对同 session records 做 namespace guard、diminishing-return coactivation strengthening、双向 connection 更新和 `connection_types` 的 `coactivation` or-insert。
- Rust reference：`Aura::end_session` / `py_end_session`（`../src/aura.rs`），`SessionTracker::new` / `track_activation` / `end_session` / `consolidate_session`（`../src/graph.rs`），`activate_and_strengthen`（`../src/recall.rs`）。
- 验证：
  - `bun run test packages/core/src/Aura.test.ts` 通过，32 tests。
  - `bun run test packages/core/src/Recall.test.ts packages/recall/src/Pipeline.test.ts packages/core/src/DefaultLayer.test.ts` 通过，12 tests。
  - `bun run typecheck` 通过。
  - `bun run test` 通过，54 files / 535 tests。
  - PyO3 surface regex check：`rust_py_total 158`，`missing 69`；首批缺口为 `set_taxonomy`、`get_taxonomy`、`get_structural_relations`、`get_relations`、`get_structural_relations_for_record` 等。

## 2026-06-01 - Recall namespace filter Rust semantics

- 范围：`packages/recall/src/Signals.ts`、`packages/recall/src/RRF.ts`、`packages/recall/src/GraphWalk.ts`、`packages/recall/src/CausalWalk.ts`、对应 recall 测试。
- 实现：把 recall signal、RRF filter、graph walk、causal walk 的 namespace 判断统一为 Rust `in_namespace` 语义：`namespaces.contains(record.namespace)`；空 namespace slice 不匹配任何记录，默认 namespace 仍由 pipeline 上层注入。
- 实现：移除 `collectTags` 的 SIMPLE 标记，当前实现已对齐 Rust `collect_tags` 的 query tag parse、candidate 聚合、Jaccard scoring、namespace filter、sort/truncate 流程。
- Rust reference：`in_namespace`、`collect_tags`、`rrf_fuse`、`graph_walk`、`causal_walk`（`../src/recall.rs`）。
- 验证：
  - `bun run test packages/recall/src/Signals.test.ts packages/recall/src/RRF.test.ts packages/recall/src/GraphWalk.test.ts packages/recall/src/Pipeline.test.ts` 通过，20 tests。
  - `bun run typecheck` 通过。
  - `bun run test` 通过，54 files / 535 tests。

## 2026-06-01 - Recall session tracker facade export fix

- 范围：`packages/core/src/Recall.ts`、`packages/core/src/Aura.ts`。
- 实现：`Aura` 从 `RecallFinalizer` 直接使用 `createRecallSessionTracker`、`endRecallSession` 与 `RecallSessionTracker`；同时 `Recall.ts` 重新导出这些符号，保持 core recall facade 可发现。
- Rust reference：`Aura::end_session`（`../src/aura.rs`）和 `SessionTracker::end_session`（`../src/graph.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts packages/recall/src/Signals.test.ts packages/recall/src/RRF.test.ts packages/recall/src/GraphWalk.test.ts packages/recall/src/Pipeline.test.ts` 通过，78 tests。
  - `bun run test` 通过，54 files / 535 tests。

## 2026-06-01 - Recall namespace/signal 注释块规范化

- 范围：`packages/recall/src/Signals.ts`、`packages/recall/src/RRF.ts`、`packages/recall/src/GraphWalk.ts`、`packages/recall/src/CausalWalk.ts`。
- 实现：将 namespace helper、`collectSdr`、`collectNgram`、`collectTags`、`collectEmbedding` 的 Rust reference / 中文逻辑说明从行注释提升为块级 JSDoc，便于 LSP 提取并符合注释规范。
- Rust reference：`in_namespace`、`collect_sdr`、`collect_ngram`、`collect_tags`、`rrf_fuse`、`graph_walk`、`causal_walk`（`../src/recall.rs`）。
- 验证：仅注释形态调整；复用本轮已通过的 `bun run typecheck` 与 `bun run test`。

## 2026-06-01 - Core recall/session/finalizer 注释块规范化

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Recall.ts`、`packages/core/src/RecallFinalizer.ts`。
- 实现：将 `Aura` recall family（`recall`、`recall_structured`、`recall_full`、`recall_at`、shadow/rerank report variants）、`Aura.decay`、`Aura.reflect`、`Aura.end_session`、core recall helpers、session tracker helpers、activation/finalize helpers 的 Rust reference / 中文逻辑说明提升为块级 JSDoc，保留 Rust 原始方法/函数位置引用。
- Rust reference：`Aura::decay`、`Aura::reflect`、`Aura::end_session`（`../src/aura.rs`），`SessionTracker`（`../src/graph.rs`），`Record::activate` / `activate_and_strengthen`（`../src/record.rs`、`../src/recall.rs`）。
- 验证：仅注释形态调整；复用本轮已通过的 `bun run typecheck` 与 `bun run test`。

## 2026-06-01 - 方法/函数签名注释规范补漏

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/MaintenanceService.ts`、`packages/core/src/RecallReranker.ts`、`packages/indexing/src/InvertedIndex.ts`、`packages/indexing/src/NGramIndex.ts`、`packages/recall/src/Pipeline.ts`、`packages/recall/src/Trace.ts`、`packages/storage/src/RecallView.ts`。
- 实现：把函数/方法体首行的说明性 `//` 注释迁移到签名前 JSDoc，包括 `Aura.open`、`Aura.open_with_password`、`policy_lifecycle_report`、`belief_instability_report`、`autoConnectRecord`、`recallPipeline`、`recallPipelineWithTrace`、`rerankRecallRecords`、`RecallViewLive`、`InvertedIndex.searchScored`、`createNGramIndex` 等。
- 实现：将 `NGramIndex` 内单行 JSDoc 规整为多行块级 JSDoc，保留 Rust reference 与 `SIMPLE IMPLEMENTATION:` / `NON-PARITY IMPLEMENTATION:` 可搜索前缀。
- 验证：
  - `git diff --check` 通过。
  - 签名/函数体首行注释扫描通过（本轮修改文件内没有函数/方法体首行 `//` 说明残留）。
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts packages/core/src/RecallReranker.test.ts packages/indexing/src/NGramIndex.test.ts packages/recall/src/Pipeline.test.ts packages/storage/src/RecallView.test.ts` 通过，6 files / 73 tests。
  - `bun run test packages/indexing/src/InvertedIndex.searchScored.test.ts` 通过，1 file / 7 tests。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，54 files / 536 tests。

## 2026-06-01 - Embedding signal RRF 过滤位置对齐

- 范围：`packages/recall/src/Signals.ts`、`packages/recall/src/Pipeline.ts`、`packages/recall/src/Trace.ts`、对应 recall 测试。
- 实现：`collectEmbedding` 不再预过滤 record/namespace、不再重排或二次截断，改为直接透传 EmbeddingStore 的 ranked list；record existence、strength、namespace 过滤统一交给 `rrfFuse`，保留 embedding 原始 rank 位置参与 RRF。
- 实现：修正 trace signal rank 为 Rust `enumerate()` 语义（0-based），并在记录 signal evidence 时同步累加 `rrfScore`，使被 RRF 过滤掉的 embedding 候选也保留 Rust trace 中的 pre-filter RRF evidence。
- Rust reference：`EmbeddingStore::query`（`../src/embedding.rs`），`Aura::collect_embedding_signal` / `Aura::recall_with_embedding`（`../src/aura.rs`），`recall_pipeline`、`recall_pipeline_with_trace`、`rrf_fuse`（`../src/recall.rs`）。
- 验证：
  - `bun run test packages/recall/src/Signals.test.ts packages/recall/src/Pipeline.test.ts` 通过，2 files / 13 tests。
  - `bun run typecheck` 通过。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，54 files / 539 tests。

## 2026-06-01 - RecallFinalizer 迁移后遗留入口清理

- 范围：`packages/recall/src/RecallFinalizer.ts`、`packages/recall/src/RecallFinalizer.test.ts`、`packages/recall/src/index.ts`、`packages/core/src/RecallFinalizer.test.ts`。
- 实现：删除 `@aura/recall` 里的旧 in-memory/no-op `RecallFinalizerImpl` 与导出，保留 contract `RecallFinalizer` tag 和 `@aura/core` 文件持久化 `RecallFinalizerFileLive` 作为唯一真实实现。
- 实现：将原 recall 包 finalizer 测试迁移为 core 包测试，改为验证空 scored list、文件持久化 activation/co-recall strengthening、Aura-owned session tracker 记录，而不是继续断言旧实现的私有 in-memory map。
- 教训：迁移实现到正确包边界后，必须同步清理原包遗留代码和测试入口，否则会把已废弃实现继续暴露为可用 surface。
- Rust reference：`activate_and_strengthen`（`../src/recall.rs`），`SessionTracker::track_activation`（`../src/graph.rs`），`Aura::recall_core` / `Aura::recall_finalize`（`../src/aura.rs`）。
- 验证：
  - `bun run test packages/core/src/RecallFinalizer.test.ts packages/core/src/Recall.test.ts packages/recall/src/Pipeline.test.ts` 通过，3 files / 16 tests。
  - `bun run typecheck` 通过。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，54 files / 538 tests。

## 2026-06-01 - Maintenance BackgroundBrain cross/task 对齐

- 范围：`packages/core/src/MaintenanceService.ts`、`packages/core/src/Aura.ts`、`packages/core/src/MaintenanceService.test.ts`。
- 实现：将 Phase 07 的 `DisabledBackgroundBrain` 空 shim 替换为 `DefaultBackgroundBrain`，实现 Rust-shaped `discover_cross_connections` 2-hop graph walk、namespace guard、UTF-8 boundary truncation 和 `max_discoveries` 限制。
- 实现：将 scheduled task reminder 从 TS fallback 的 active task id 列表改为 Rust `check_scheduled_tasks` 语义：按 `config.taskTag` 精确匹配、要求 `metadata.status === "active"`、解析 RFC3339 或 `YYYY-MM-DD` due date、输出 Due today / Due tomorrow / Overdue 文本并按 urgency + salience 排序。
- 实现：`runPostDiscoveryPhases` 对齐 Rust `run_post_discovery_phases`：`synthesisEnabled` 时固定执行 cross-connection discovery（limit 3），task reminders 始终来自 BackgroundBrain scheduled task check。
- Rust reference：`discover_cross_connections` / `truncate_utf8` / `check_scheduled_tasks`（`../src/background_brain.rs`），`run_post_discovery_phases`（`../src/maintenance_service.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/MaintenanceService.test.ts packages/core/src/Aura.test.ts` 通过，2 files / 59 tests。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，54 files / 539 tests。

## 2026-06-01 - NGramIndex random coefficient 分布对齐

- 范围：`packages/indexing/src/NGramIndex.ts`、`packages/indexing/src/NGramIndex.test.ts`、`vitest.config.ts`、`vitest.setup.ts`、`tsconfig.json`、`.planning/BACKLOG.md`。
- 实现：`NGramIndex.random()` 不再使用 `Math.random()`，改为 `globalThis.crypto.getRandomValues` 生成 31-bit 随机数，并通过 rejection sampling 对齐 Rust `rng.gen_range(1..PRIME)` / `rng.gen_range(0..PRIME)` 的整数区间分布。
- 实现：移除 `NGramIndex.random()` 的 `NON-PARITY IMPLEMENTATION` 标记；确定性跨语言 verifier 仍由 `NGramIndex.withSeed0()` 覆盖。
- 实现：为当前 Windows PATH 下的 Node 16.20.2 测试环境补齐 Vitest worker Web API setup（`crypto`、`fetch`、`Request`、`Response`、`Headers`、`Blob`、Web Streams），并保留 `vitest.config.ts` 中 Vite 启动阶段需要的 `node:crypto.getRandomValues` polyfill；生产包不引入 `node:*`。
- 文档：初始化 `.planning/BACKLOG.md`，从 ROADMAP Phase 8 与 IMPLEMENTATION-LOG 已完成项整理当前 parity backlog 和完成进度。
- Rust reference：`NGramIndex::new` / `NGramIndex::with_seed`（`../src/ngram.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/indexing/src/NGramIndex.test.ts` 通过，1 file / 6 tests。
  - `bun run test packages/indexing/src/NGramIndex.test.ts packages/codec/src/Crypto.test.ts packages/storage/src/BrainAuraFile.test.ts` 通过，3 files / 10 tests。
  - `bun run test packages/mcp/src/Inventory.test.ts packages/mcp/src/MastraCompat.test.ts packages/mcp/src/Parity.test.ts packages/mcp/src/StdioSmoke.test.ts` 通过，4 files / 6 tests。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，54 files / 540 tests。

## 2026-06-01 - ConceptEngine / NGramIndex 共享 xxh3_64 对齐

- 范围：`packages/utils/src/Xxh3.ts`、`packages/utils/src/Xxh3.test.ts`、`packages/indexing/src/NGramIndex.ts`、`packages/concept/src/ConceptEngine.ts`、对应 package metadata 与 `bun.lock`。
- 实现：新增 `@aura/utils` 的默认 seed/default secret `xxh3_64` 纯 TS 投影，覆盖 Rust `xxhash_rust::xxh3::xxh3_64` 的 0..16、17..128、129..240、241+ byte 路径，并提供 `xxh3_64Hex`。
- 实现：`NGramIndex` 移除局部 0..3 byte xxh3 片段，改为复用共享 `xxh3_64(bytes) & 0x7fffffff`，保留 Rust `NGramIndex::hash_str` 的短输入/31-bit mask 语义。
- 实现：`ConceptEngine` 移除 `xxhash-wasm` / `xxh64` workaround，`deterministicId` 改为 Rust `format!("c-{:012x}", xxh3_64(key.as_bytes()))` 语义，centroid signature 改为 `xxh3_64(bytes) as u32`。
- Rust reference：`xxhash-rust/src/xxh3.rs`、`xxh3_common.rs`，`NGramIndex::hash_str`（`../src/ngram.rs`），`deterministic_id` / `concept_key`（`../src/concept.rs`）。
- 验证：
  - `bun install --lockfile-only` 仅更新 `@aura/concept` 与 `@aura/indexing` 的 `@aura/utils` workspace 依赖。
  - `bun run typecheck` 通过。
  - `bun run test packages/utils/src/Xxh3.test.ts packages/indexing/src/NGramIndex.test.ts packages/concept/src/ConceptEngine.test.ts` 通过，3 files / 89 tests。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，55 files / 541 tests。

## 2026-06-01 - 维护引擎稳定 ID / fingerprint xxh3_64 对齐

- 范围：`packages/belief/src/BeliefEngine.ts`、`packages/causal/src/CausalEngine.ts`、`packages/policy/src/PolicyEngine.ts`、`packages/epistemic-runtime/src/EpistemicRuntime.ts`、相关 contract 注释、package metadata 与测试。
- 实现：`BeliefEngine.deterministicHypothesisId` 移除 `xxhash-wasm` lazy hasher 与 xxh64 bridge，直接按 Rust `Hypothesis::deterministic_id` 对 `belief_id\0sorted_record_ids` 做 `xxh3_64`。
- 实现：`CausalEngine.computeCorpusFingerprint` 移除 simple-hash / lazy `xxhash-wasm` 分支，按 Rust `corpus_fingerprint` 生成包含尾随换行和 causal connection 尾随逗号的 byte string，再用 `xxh3_64` 生成 16-char hex fingerprint。
- 实现：`CausalEngine` 的 pattern key/ID 改为 Rust `pattern_key(namespace, cause, effect)` 的 `namespace:cause→effect` 与 `ca-{:012x}`；TS-only `edge_hash` 仅作为 provenance 字段保留，不再参与 pattern ID。
- 实现：`PolicyEngine` 的 hint ID 改为 Rust `deterministic_id(namespace:action_kind:pattern_key)` 的 `p-{:012x}`，并用 Rust `action_kind_str` 的 `verify` key 而不是 TS enum 值 `verify_first`。
- 实现：`EpistemicRuntime.getContradictionClusters` 的 cluster ID 改为 Rust `xxh3_64(namespace\0sorted_belief_ids)`，并按 Rust 输出排序后的 belief IDs。
- Rust reference：`Hypothesis::deterministic_id`（`../src/belief.rs`），`corpus_fingerprint` / `pattern_key` / `deterministic_id`（`../src/causal.rs`），`action_kind_str` / `deterministic_id`（`../src/policy.rs`），`get_contradiction_clusters` cluster ID 逻辑（`../src/epistemic_runtime.rs`）。
- 验证：
  - `bun install --lockfile-only` 仅更新新增 `@aura/utils` workspace 依赖。
  - `bun run typecheck` 通过。
  - `bun run test packages/belief/src/BeliefEngine.test.ts packages/causal/src/CausalEngine.test.ts packages/policy/src/PolicyEngine.test.ts packages/epistemic-runtime/src/EpistemicRuntime.test.ts` 通过，4 files / 236 tests。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，55 files / 541 tests。
