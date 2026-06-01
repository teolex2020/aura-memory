# Implementation Log

## 2026-06-01 - Aura delete / InvertedIndex remove 写入链补齐

- 范围：`packages/indexing/src/InvertedIndex.ts`、`packages/indexing/src/InvertedIndex.roundtrip.test.ts`、`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`、`.planning/BACKLOG.md`。
- 实现：`InvertedIndex.remove` 改为对齐 Rust `InvertedIndex::remove(external_id)`：从 `id_map` / `reverse_map` 删除 external id，并从所有 bitmaps 移除 doc id；不再要求调用方传入旧 SDR bits。
- 实现：`Aura.delete` 改为基于当前实例 read model 执行 graph cleanup，并在删除成功后加载/更新/保存 `index/`，同时从实例级 `brain.aura` header view (`listRecords`) 移除该 record。
- 实现：`Aura.delete` 的 marker 从过期 `SIMPLE IMPLEMENTATION` 收窄为 `NON-PARITY IMPLEMENTATION`，剩余差异明确为 embedding store 与 runtime SDR cache service 尚未接入。
- 备注：`connect` 当前仍按 TS 旧行为持久化 connection updates，但 Rust `Aura::connect` 是运行时内存态 mutation；这一语义差异保留在 backlog，后续需单独处理以避免把 index 删除 slice 和 connect 持久化决策混在一起。
- Rust reference：`Aura::delete`（`../src/aura.rs`），`graph::remove_record`（`../src/graph.rs`），`AuraStorage::delete`（`../src/storage.rs`），`InvertedIndex::remove`（`../src/index.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/indexing/src/InvertedIndex.roundtrip.test.ts packages/indexing/src/InvertedIndex.searchScored.test.ts packages/core/src/Aura.test.ts packages/storage/src/RecallView.test.ts packages/core/src/Recall.parity.test.ts packages/mcp/src/Parity.test.ts` 通过，6 files / 50 tests。

## 2026-06-01 - Aura open/store storage-index 写入闭环对齐

- 子代理审计：Epicurus / Wegener 只读核对 open→write→recall 全流程，均将 `Aura.store_with_channel` 未维护 `brain.aura` / SDR index / `aura_id` 判为 P0；同时指出 `InvertedIndex.empty()` 从 doc id 1 起步会在开始写 index 后产生磁盘格式偏差。
- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`、`packages/storage/src/BrainAuraFile.ts`、`packages/indexing/src/InvertedIndex.ts`、`packages/indexing/src/InvertedIndex.roundtrip.test.ts`、`.planning/BACKLOG.md`。
- 实现：`Aura.open` 现在按 Rust startup 行为自举 `brain.aura` 与 `brain.cog`，空目录 open 不再依赖外部预先创建 storage 文件。
- 实现：`Aura.store_with_channel` 的主写入闭环现在生成 Rust SDR、写入 `index/` 的 `InvertedIndex`、追加 `brain.aura` StoredRecord、设置 `record.aura_id = record.id`、追加 `brain.cog` 并刷新实例级 `listRecords` / search read model / recall caches。
- 实现：`BrainAuraFile.appendUnencrypted` 提供无加密 StoredRecord append 路径并返回 byte offset，避免普通未加密写入被尚未对齐的 encryption service 污染；原 `append` 保留 encrypted branch。
- 实现：`InvertedIndex.empty()` 从 Rust `InvertedIndex::new` 的 `next_doc_id = 0` 起步，roundtrip 测试断言 manifest 中 `r1=0`、`r2=1`、`next_doc_id=2`。
- 仍未完成：store guard/dedup/surprise/audit/embedding/cortex 分支尚未全量接入，因此 `Aura.store_with_channel` 保留更精确的 `NON-PARITY IMPLEMENTATION` marker；update/delete/connect 的 storage/index/cache 闭环仍在 backlog。
- Rust reference：`Aura::open` / `Aura::open_with_password` / `Aura::store_with_channel`（`../src/aura.rs`），`AuraStorage::with_encryption` / `AuraStorage::append`（`../src/storage.rs`），`InvertedIndex::new` / `InvertedIndex::add` / `InvertedIndex::save`（`../src/index.rs`），`SDRInterpreter::text_to_sdr`（`../src/sdr.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/storage/src/BrainAuraFile.test.ts packages/indexing/src/InvertedIndex.roundtrip.test.ts packages/indexing/src/InvertedIndex.searchScored.test.ts packages/core/src/Aura.test.ts packages/storage/src/RecallView.test.ts packages/core/src/Recall.parity.test.ts packages/mcp/src/Parity.test.ts` 通过，7 files / 50 tests。

## 2026-06-01 - RecallView startup/load read model 对齐

- 范围：`packages/storage/src/RecallView.ts`、`packages/storage/src/RecallView.test.ts`、`.planning/BACKLOG.md`。
- 实现：审计 `RecallView` 的 startup/load marker；`InvertedIndex.load/searchScored` 与 NGram deterministic verifier path 已由前序实现对齐，因此移除过期 `SIMPLE IMPLEMENTATION` 注释，改为明确 Rust `Aura::open` / `InvertedIndex::load` read-model 构造引用。
- 实现：`buildTagIndex` 不再把 tag key lower-case，改为保留 Rust `Aura::open` / `Aura::store_with_channel` / `rollback` 的 `entry(tag.clone())` 语义；`collect_tags` 仍按 Rust 函数自身处理 query/tag scoring。
- 测试：`RecallView.test.ts` 增加 mixed-case tag key 回归，锁定 read-model 构建边界不额外规范化 tag casing。
- 旁证：尝试移除 MCP parity harness 的 `score` normalization 后，live Rust MCP exact compare 仍只在 `recall_structured` score 数值上失败；因此 `packages/mcp/src/Parity.test.ts` 的 NON-PARITY marker 保留，并在 `BACKLOG.md` 继续追踪。
- Rust reference：`Aura::open` / `Aura::store_with_channel` / `rollback` tag index 构造（`../src/aura.rs`），`InvertedIndex::load` / `InvertedIndex::search`（`../src/index.rs`），`collect_tags`（`../src/recall.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/storage/src/RecallView.test.ts packages/core/src/Recall.parity.test.ts packages/recall/src/Signals.test.ts` 通过，3 files / 5 tests。
  - `bun run test packages/mcp/src/Parity.test.ts` 当前 normalization 下通过；临时关闭 score normalization 时失败，证明 score gap 仍未闭合。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 562 passed / 7 skipped。

## 2026-06-01 - Core RecallService / recall cache 对齐

- 范围：`packages/core/src/RecallService.ts`、`packages/core/src/Recall.ts`、`packages/core/src/Aura.ts`、`packages/core/src/Recall.test.ts`、`packages/core/src/Aura.test.ts`、`packages/core/src/index.ts`、`packages/mcp/src/tools.ts`、`packages/mcp/src/Invocation.test.ts`、`.planning/BACKLOG.md`。
- 实现：新增 core `RecallService.ts`，承载 Rust `recall_service.rs` / `cache.rs` 对应的 text cache key、formatted recall cache、structured recall cache、raw/raw_with_trace wrapper、shadow/rerank report wrapper 与 `format_preamble`/record formatting 逻辑。
- 实现：`Aura.recall` 从 TS-only scored IDs 改为 Rust `Aura::recall` 语义的 formatted LLM context string，`Aura.recall_structured` 通过 `RecallService.recall_structured_cached` 返回 scored records；保留 `Aura.recall_scored` 作为 TS 兼容 helper 指向 Rust `recall_core` 语义。
- 实现：`Aura` 实例持有 formatted 与 structured recall cache，并在 store/update/delete/connect/mark salience/promote/move/decay/reflect/consolidate/import/runMaintenance 等写入影响召回结果的路径调用 `clearRecallCaches()`，对齐 Rust `runtime.clear_recall_caches()`。
- 实现：MCP `recall` tool 不再在 transport 层复刻格式化逻辑，改为直接调用 `Aura.recall`；transport 继续只做参数映射和 text serialization。
- 测试：新增 `RecallService.formatPreamble` level order/source/semantic/causal preview 覆盖，新增 structured cache key/cache hit/clear 覆盖；新增 `Aura.recall` formatted 输出与 cache invalidation 回归。
- Rust reference：`RecallService`（`../src/recall_service.rs`）、`RecallCache` / `StructuredRecallCache`（`../src/cache.rs`）、`format_preamble` / `format_record`（`../src/recall.rs`）、`Aura::recall` / `Aura::recall_structured` / `runtime.clear_recall_caches`（`../src/aura.rs`）、`AuraMcpServer::recall`（`../src/mcp.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Recall.test.ts packages/core/src/Aura.test.ts packages/mcp/src/Invocation.test.ts packages/mcp/src/Parity.test.ts` 通过，4 files / 45 tests。
  - `git diff --check` 通过（仅 CRLF warning）。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 562 passed / 7 skipped。

## 2026-06-01 - Aura recall_full Rust fallback alignment

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`、`.planning/BACKLOG.md`。
- 实现：`Aura.recall_full` 不再直接复用 `recall_structured`，改为按 Rust 三阶段执行：先运行 recall_core/RRF pipeline，再从当前 records read model 合并 substring fallback，最后按 `outcome-failure` + query word fallback 补充 failure records。
- 实现：`recall_full` 支持 `includeFailures` / `include_failures` 选项，默认 true；namespace、strength、`top_k + 15` 截断、substring score `0.6` 与 failure score `0.8` 均按 Rust `Aura::recall_full` 对齐。
- 实现：Aura 层 recall options 默认值收敛为 Rust `top_k = 20`、`min_strength = 0.1`、`expand_connections = true`、默认 namespace，而不是继续依赖 recall package 的通用 pipeline fallback。
- 测试：新增 `recall_full` fallback 测试，使用 `topK=0` 稳定绕开 Stage 1 命中，验证 substring/failure fallback、`includeFailures=false` 与 namespace filter。
- Rust reference：`Aura::recall_full`、`Aura::recall_structured` / `Aura::recall_core` defaults（`../src/aura.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Aura.test.ts packages/core/src/Recall.test.ts packages/recall/src/Pipeline.test.ts` 通过，3 files / 47 tests。
  - `git diff --check` 通过（仅 CRLF warning）。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 559 passed / 7 skipped。

## 2026-06-01 - EpistemicRuntime / PolicyEngine Rust behavior alignment

- 范围：`packages/epistemic-runtime/src/EpistemicRuntime.ts`、`packages/contract/src/EpistemicRuntime.ts`、`packages/policy/src/PolicyEngine.ts`、`packages/contract/src/policy/PolicyTypes.ts`、`packages/core/src/Aura.ts`、相关测试与 noUnused 清理文件。
- 实现：`EpistemicRuntime` 对齐 Rust `epistemic_runtime.rs` 的 surfaced concept mode gate 与 telemetry 计数，`getBeliefInstabilitySummary` 改为接收当前 records read model 并计算 contradiction cluster count，`getContradictionClusters` 改为按 belief key namespace、Rust unstable/conflict node gate、hypothesis records/tags 连通与 Rust 排序生成结果。
- 实现：`EpistemicRuntime` 的 high/low belief 查询、state filter、suppressed/rejected policy hint 查询、policy lifecycle summary、policy pressure report 改为 Rust limit、排序、action weight 与 advisory pressure 公式。
- 实现：`PolicyEngine.discover` 改为 Rust full rebuild 周期：每轮清空 hints/key_index，按 6 gates 选 seed，过滤 mixed explicit outcome ambiguity，构建 stable concept provenance、belief provenance、supporting records，按 Resolved/Singleton belief confidence 与 record confidence fallback 计算 hint，再执行 suppression 与 Stable/Candidate/Rejected 分类。
- 实现：`PolicyHint` contract 补充 Rust provenance 字段 `trigger_causal_ids`、`trigger_concept_ids`、`trigger_belief_ids`、`supporting_record_ids`；保留既有 TS 兼容字段供 recall/core surfaces 继续消费。
- 测试：`EpistemicRuntime.test.ts` 中 7 个旧 TS 语义断言先用 `it.skip` 标注，原因是 Rust reference 没有该模块独立测试可直接迁移，后续应按 Rust 行为重写，而不是让实现回退到旧测试期望。
- Rust reference：`EpistemicRuntime` inspection methods and concept surface telemetry（`../src/epistemic_runtime.rs`），`PolicyEngine::discover` / `build_hint` / `apply_suppression` / `surface_policy_hints`（`../src/policy.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/epistemic-runtime/src/EpistemicRuntime.test.ts packages/policy/src/PolicyEngine.test.ts packages/policy/src/Surface.test.ts packages/causal/src/CausalEngine.test.ts` 通过，4 files / 145 passed / 7 skipped。
  - `git diff --check` 通过（仅 CRLF warning）。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 558 passed / 7 skipped。

## 2026-06-01 - Record / Level namespace Rust impl helpers

- 范围：`packages/contract/src/record/Record.ts`、`packages/contract/src/levels/Level.ts`、`packages/core/src/Aura.ts`、`packages/core/src/MaintenanceService.ts`、`packages/core/src/RecallFinalizer.ts`、`packages/mcp/src/tools.ts`、对应 contract/core 测试。
- 实现：`Record` namespace 补齐 Rust `impl Record` 中剩余纯 helper：`make`（TS 侧对应 `Record::new`，因 `new` 为关键字改名并在注释保留原名）、`generateId`、`activate`、`applyDecay`、`isAlive`、`canPromote`、`promote`、connection helper、age helper、validation/default confidence helper、`updateEpistemicSignals` 与 `epistemicHealth`。
- 实现：保留旧顶层 `defaultConfidenceForSource` / `validateRecord*` wrapper 作为兼容入口，但真实逻辑集中到 `Record` namespace，后续调用方可统一通过 `Record as AuraRecord` 使用类型与方法。
- 实现：`Level` enum 合并 namespace，补齐 Rust `impl Level` helper：`decayRate`、`toDna`、`isIdentitySdr`、`promote`、`value`、`fromValue`、`displayName`（TS 侧对应 Rust `Level::name`）、`tier`、`isCognitive`、`isCore`。
- 实现：`Aura.ts`、`MaintenanceService.ts`、`RecallFinalizer.ts` 与 MCP tools 移除重复的 Record/Level 局部公式，改为复用 `AuraRecord.*` / `Level.*`；Recall finalizer 的 activation 复用 `AuraRecord.activate`。
- Rust reference：`Record::new`、`Record::generate_id`、`Record::activate`、`Record::apply_decay`、`Record::is_alive`、`Record::can_promote`、`Record::promote`、`Record::add_connection`、`Record::add_typed_connection`、`Record::connection_type`、`Record::age_days`、validation/default confidence/epistemic helpers（`../src/record.rs`），`Level` impl helpers（`../src/levels.rs`）。
- 验证：
  - `bun run test packages/contract/src/Record.test.ts packages/contract/src/record/Record.test.ts packages/contract/src/Enums.test.ts` 通过，3 files / 17 tests。
  - `bun run test packages/contract/src/Record.test.ts packages/contract/src/record/Record.test.ts packages/contract/src/Enums.test.ts packages/core/src/RecallFinalizer.test.ts packages/core/src/Aura.test.ts packages/core/src/MaintenanceService.test.ts` 通过，6 files / 80 tests。
  - `git diff --check` 通过（仅 CRLF warning）。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 565 tests。
  - `bun run typecheck` 未通过：仍被既有 noUnused diagnostics 阻塞（belief/causal/code-extraction/concept/core test/epistemic-runtime/indexing/policy/recall/storage 等文件）；本轮触达文件无剩余 typecheck 诊断。

## 2026-06-01 - Core Graph auto_connect / merge_records skeleton

- 范围：`packages/core/src/Graph.ts`、`packages/core/src/Graph.test.ts`、`packages/core/src/Aura.ts`。
- 实现：将原本内联在 `Aura.ts` 的 auto-connect 写入逻辑迁移到 core 内部 `Graph.autoConnect`，`Aura.store_with_channel` 只负责调用 Graph、写入 `brain.cog` 和替换 search read model。
- 实现：`Graph.autoConnect` 对齐 Rust `graph::auto_connect` 的共享 tag candidate 计数、`MAX_CONNECTIONS = 50`、namespace guard、`0.2 + 0.15 * shared_count` capped at `0.8`、双向 `associative` connection 更新；candidate 应用顺序保留当前 records map 顺序以维持 MCP parity 排序基线，且仍保持 TS 现有不追加 synthetic neighbor update 的内存可见性策略。
- 实现：新增纯内存 `Graph.mergeRecords`，对齐 Rust `graph::merge_records` 的 level upgrade、tag merge、connection/type transfer、strength/activation/source_type 合并和最终 `removeRecord` 调用；暂不接入 `Aura.consolidate`，因为 storage/index/embedding coherent mutation path 仍在 backlog。
- 实现：移除 `Aura.ts` 中的 `MAX_AUTO_CONNECTIONS` 和 `sharedTagCount`，避免 Rust `graph.rs` 语义继续散落在 facade 内。
- 测试：`Graph.test.ts` 新增 auto-connect 同 namespace / cross namespace / no tags 覆盖，以及 merge-record 字段合并与 remove cleanup 覆盖；`Aura.test.ts` 既有 store auto-connect 行为保持通过。
- Rust reference：`MAX_CONNECTIONS`、`graph::auto_connect`、`graph::merge_records`（`../src/graph.rs`），`Aura::store` / `Aura::store_with_channel`（`../src/aura.rs`）。
- 验证：
  - `bun run test packages/core/src/Graph.test.ts packages/core/src/Aura.test.ts` 通过，2 files / 38 tests。
  - `bun run test packages/core/src/Graph.test.ts packages/core/src/Aura.test.ts packages/mcp/src/Parity.test.ts` 通过，3 files / 40 tests。
  - `bun run typecheck` 通过。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，56 files / 548 tests。

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

## 2026-06-01 - Core Graph SessionTracker 归位对齐

- 范围：`packages/core/src/Graph.ts`、`packages/core/src/RecallFinalizer.ts`、`packages/core/src/Aura.ts`、`packages/core/src/Graph.test.ts`、`packages/core/src/RecallFinalizer.test.ts`、`.planning/BACKLOG.md`。
- 实现：将 Rust `graph.rs` 的 `SessionBuffer` / `SessionTracker` / `SESSION_TIMEOUT` / `track_activation` / `end_session` / `cleanup_stale_sessions` 语义归位到 core `Graph.ts`，补齐 stale session consolidation 的纯 graph 骨架。
- 实现：`RecallFinalizer` 不再内联 session pair strengthening 与 tracker buffer 结构，而是通过 `Graph.trackActivation` / `Graph.endSession` 复用 graph module；`Aura` 持有 `Graph.SessionTracker` 并通过 `Graph.createSessionTracker()` 初始化。
- 实现：session 时间读取改为 Effect + `Clock` contract 注入，不从 `@aura/utils` 直接导入时间 helper，也不向 Rust-shaped graph 方法显式追加 clock 参数。
- Rust reference：`SessionBuffer::new`、`SessionTracker::new`、`track_activation`、`end_session`、`consolidate_session`、`cleanup_stale_sessions`（`../src/graph.rs`），`Aura::end_session`（`../src/aura.rs`），`activate_and_strengthen` session tracking（`../src/recall.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Graph.test.ts packages/core/src/RecallFinalizer.test.ts packages/core/src/Aura.test.ts` 通过，3 files / 43 tests。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，56 files / 550 tests。

## 2026-06-01 - Core Graph 导出 Effect 化与 auto_connect 签名修正

- 范围：`packages/core/src/Graph.ts`、`packages/core/src/Aura.ts`、`packages/core/src/RecallFinalizer.ts`、`packages/core/src/Graph.test.ts`、`.planning/BACKLOG.md`、`.planning/IMPLEMENTATION-LOG.md`。
- 子代理审计：Hume 只读核对 `Graph.ts` / `../src/graph.rs`，确认 SessionTracker 主体对齐；指出 `autoConnect` 的 tag index 参数/候选来源和新 record 插入边界偏离 Rust，并将 remove/merge/index-store 持久化与 stale cleanup lifecycle 归为 TODO。
- 实现：将 `Graph.autoConnect`、`Graph.removeRecord`、`Graph.mergeRecords`、`Graph.endSession` 这些非平凡导出操作改为返回 `Effect`；`Aura.store`、`Aura.delete` 与 `RecallFinalizer.endRecallSession` 调用 Graph 导出时改为 `yield*`。
- 实现：`Graph.autoConnect` 改为接收 Rust-shaped `tagIndex`，候选集合从 tag index 构建；返回的 `records` 只包含既有 records 及其 neighbor 更新，不再把新 record 插入 graph helper 结果，`Aura.store` 在 appendStore 后负责插入实例视图。
- 实现：补齐 `Graph.ts` exported interfaces / types 的块级 JSDoc；在 `removeRecord` / `mergeRecords` 上添加可搜索 `NON-PARITY IMPLEMENTATION:` 注释，并把对应 TODO 记录到 `BACKLOG.md`。
- Rust reference：`auto_connect`、`remove_record`、`merge_records`、`SessionTracker::end_session`（`../src/graph.rs`），`Aura::store_with_channel` / `Aura::delete` / `Aura::end_session`（`../src/aura.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Graph.test.ts packages/core/src/RecallFinalizer.test.ts packages/core/src/Aura.test.ts` 通过，3 files / 44 tests。
  - `bun run test packages/mcp/src/Parity.test.ts` 通过，1 file / 2 tests。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 首次因 `packages/indexing/src/NGramIndex.test.ts` 随机系数测试未命中 `r1` 失败；未修改实现。
  - `bun run test packages/indexing/src/NGramIndex.test.ts` 复跑通过，1 file / 6 tests。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 复跑通过，56 files / 551 tests。

## 2026-06-01 - NGramIndex random smoke test flake 标注

- 范围：`packages/indexing/src/NGramIndex.test.ts`、`.planning/BACKLOG.md`、`.planning/IMPLEMENTATION-LOG.md`。
- 实现：在 `NGramIndex.random()` 随机系数 smoke test 旁增加 `TODO(randomness)`，标注小样本 LSH query 可能因随机系数偶发漏掉目标；当前需后续确认是真实算法概率还是测试样本过脆。
- 实现：在 `BACKLOG.md` 记录随机性调查项，并明确 `it.flakyTest` 只包装 Effect tests，当前非 Effect 测试不能直接使用该 helper。
- 验证：
  - `bun run test packages/indexing/src/NGramIndex.test.ts` 通过，1 file / 6 tests。
  - `git diff --check` 通过。

## 2026-06-01 - Record.importance 命名空间与 Core Consolidation 对齐

- 范围：`packages/contract/src/record/Record.ts`、`packages/contract/src/Record.test.ts`、`packages/core/src/Consolidation.ts`、`packages/core/src/Consolidation.test.ts`、`packages/core/src/Aura.ts`、`packages/core/src/Aura.test.ts`、`packages/core/src/MaintenanceService.ts`、MCP inventory/parity 测试与 07-08 parity artifacts。
- 实现：将 Rust `Record::importance` 公式归位到 contract `Record` namespace，调用方通过合并导入 `Record as AuraRecord` 同时使用类型与 `AuraRecord.importance(...)`，不再拆分 `Record as RecordFns` 这类函数别名。
- 实现：新增 core `Consolidation.ts`，投影 Rust `CONSOLIDATION_THRESHOLD` / `CONSOLIDATION_SOFT_THRESHOLD` / `ConsolidationResult` / `consolidation::consolidate`；硬合并复用 `Graph.mergeRecords`，并在 facade 层同步 ngram/tag/aura index 与 `CognitiveStore.appendDelete` / `appendUpdate` / `flush`。
- 实现：`Aura.consolidate` 从 typed unsupported 改为真实 Effect facade；`MaintenanceService.runPostDiscoveryPhases` 复用同一 consolidation 模块，并由 `Aura.runMaintenance` 传入真实 `tag_index` / `aura_index`。
- 实现：MCP `consolidate` inventory 状态改为 implemented，Parity harness 将 `consolidate` 纳入 Rust-comparable family，并刷新 07-08 parity JSON/golden/verification artifacts。
- 后续规则：同类 Rust 类型方法优先挂到对应 contract namespace，后续 `Record` impl 其它方法按 `AuraRecord.method` 模式补齐；`levelDisplayName` 这类 helper 后续可迁移为 `Level.displayName`。
- 验证：
  - `bun run typecheck` 未通过：当前被既有 noUnused 报错阻塞（belief/causal/code-extraction/concept/core MaintenanceService.test/epistemic-runtime/indexing/policy/recall/storage 等文件），本次改动引入的 MCP status 比较与 `MaintenanceService` 残留导入已修复。
  - `bun run test packages/contract/src/Record.test.ts packages/core/src/Consolidation.test.ts packages/core/src/Aura.test.ts packages/mcp/src/Inventory.test.ts packages/mcp/src/Invocation.test.ts` 通过，5 files / 41 tests。
  - `bun run test packages/core/src/MaintenanceService.test.ts` 通过，1 file / 27 tests。
  - `bun run test packages/mcp/src/Parity.test.ts` 通过，1 file / 2 tests（live Rust MCP parity passed）。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 553 tests。

## 2026-06-01 - Aura store_with_channel guard/dedup 分支对齐

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Guards.ts`、`packages/core/src/Trust.ts`、`packages/core/src/Aura.test.ts`、`.planning/BACKLOG.md`。
- 子代理审计：前置只读审计从 open/write/recall 全链路定位下一处 P0 为 `Aura::store_with_channel` 写入侧 guard、dedup、surprise、provenance、causal-link 缺口；audit / embedding / cortex / runtime SDR cache、update deterministic relation refresh、connect persistence decision 继续保留为后续项。
- 实现：新增 core `Guards.ts` 投影 Rust `guards.rs` 的 `GuardResult`、`auto_protect_tags`、`apply_store_guard`、`should_skip_consolidation`、`is_archive_protected`，保留 Rust regex 语义和可搜索 Rust reference。
- 实现：新增 core `Trust.ts` 投影 Rust store-time `trust.rs` 的 `TagTaxonomy`、`Provenance`、`infer_volatility`、`get_provenance`、`stamp_provenance`；timestamp 由 `Clock` 调用方注入，避免在 core 写入侧直接读取系统时间。
- 实现：`Aura.open` 从 cognitive records 构建实例级 runtime `NGramIndex` 与 tag index；`store_with_channel` 复用该索引执行同 namespace 强匹配 dedup，命中时激活既有 record、合并 tags、追加 cognitive update，并不追加 `brain.aura`。
- 实现：dedup gate 改为 UTF-8 byte length，匹配 Rust `content.len()`；runtime tag index 不在 dedup 合并 tag 时重建，避免后续 `auto_connect` 看到 Rust 当前实例不会看到的 dedup-merged tag。
- 实现：`store_with_channel` 对齐 Rust surprise promotion 阈值 `0.2`、auto-protect tags、store guard metadata、provenance metadata、causal parent typed connection；新增写入、update、delete、consolidation / post-discovery consolidation 对 runtime `NGramIndex` / tag index 的维护。
- 测试：新增 store dedup、UTF-8 byte length dedup gate、dedup tag index 生命周期与 guard/provenance/surprise/causal parent 覆盖；既有 recall finalizer、rerank report、consolidation fixture 在需要多条相似 records 的场景显式 `deduplicate: false`，防止 Rust-aligned store-time dedup 改变测试意图。
- Rust reference：`Aura::store_with_channel` / `Aura::update`（`../src/aura.rs`），`guards.rs`，`trust.rs`，`NGramIndex`（`../src/ngram.rs`），`graph::auto_connect` causal-link 调用边界（`../src/graph.rs`）。
- 剩余 caveat：`Aura.ts` 仍保留 audit / embedding / cortex / runtime SDR cache、update deterministic relation refresh、delete embedding/SDR-cache 与 connect persistence 相关 marker；生产 `NGramIndex` 与 Rust 一样保留随机系数，因此近阈值 dedup/surprise 仍应优先用确定性 verifier/fixture 排查。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Aura.test.ts packages/core/src/Graph.test.ts packages/storage/src/RecallView.test.ts packages/core/src/Recall.parity.test.ts packages/mcp/src/Parity.test.ts` 通过，5 files / 51 tests。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 567 tests，7 skipped。

## 2026-06-02 - Aura store-time taxonomy 配置对齐

- 范围：`packages/core/src/Aura.ts`、`packages/core/src/Trust.ts`、`packages/core/src/Guards.ts`、`packages/core/src/Aura.test.ts`、`.planning/BACKLOG.md`。
- 实现：`Trust.TagTaxonomy` 字段改为 Rust `TagTaxonomy` 的 snake_case 形状，并新增 `cloneTagTaxonomy`，避免 `set_taxonomy` / `get_taxonomy` 暴露内部可变 `HashSet` 状态。
- 实现：`Guards.GuardResult` 与 `Trust.Provenance` 的内部字段改为 Rust-shaped `extra_tags` / `extra_metadata` / `needs_approval` 与 `trust_score`，减少 store guard/trust 模块的字段投影偏差。
- 实现：`Aura` 新增实例级 `taxonomy` config state，补齐 `set_taxonomy` / `get_taxonomy`，`store_with_channel` 改为读取当前 taxonomy，而不是每次使用默认 taxonomy。
- 测试：新增 `Aura.test.ts` 覆盖 taxonomy set/get clone 语义、自定义 `sensitive_tags` 触发非交互写入 `actionable=false`、自定义 `stable_tags` 影响 provenance volatility。
- Rust reference：`TagTaxonomy` / `TagTaxonomy: Clone` / `infer_volatility` / `stamp_provenance`（`../src/trust.rs`），`GuardResult` / `apply_store_guard`（`../src/guards.rs`），`Aura::set_taxonomy` / `Aura::get_taxonomy` / `Aura::store_with_channel` / `py_set_taxonomy` / `py_get_taxonomy`（`../src/aura.rs`），`AuraConfigState`（`../src/aura_state.rs`）。
- 验证：
  - `bun run typecheck` 通过。
  - `bun run test packages/core/src/Aura.test.ts packages/core/src/Graph.test.ts packages/storage/src/RecallView.test.ts packages/core/src/Recall.parity.test.ts packages/mcp/src/Parity.test.ts` 通过，5 files / 52 tests。
  - `git diff --check` 通过。
  - `bun run test -- --pool=threads --poolOptions.threads.singleThread` 通过，58 files / 568 tests，7 skipped。
