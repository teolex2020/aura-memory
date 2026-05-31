# Implementation Log

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
