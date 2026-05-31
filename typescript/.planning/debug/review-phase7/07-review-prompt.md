# Cross-AI Plan Review Request

You are reviewing implementation plans for a software project phase.
Provide structured feedback on plan quality, completeness, and risks.

## Project Context
# PROJECT.md

## Project

**Name:** Aura TypeScript Port

**Goal:** 1:1 TypeScript rewrite of Rust Aura core with full disk-format compatibility, using Bun runtime and effect-smol layering.

**Scope:**
- Core library (open/store/recall/search/update/delete/maintain/insights)
- MCP stdio server
- Effect-smol dependency injection and platform abstraction
- Byte-level disk format compatibility with Rust

**Non-Goals:**
- HTTP server / dashboard
- Browser/Worker runtime
- Performance exceeding Rust
- Python or UI components

**Success Metric:** TS and Rust can read/write the same brain directory; recall pipeline outputs match deterministically; all M1-M4 milestones pass cross-language fixture tests.

**Target Runtime:** Bun (TypeScript, effect-smol style)

## Decisions

- **D1:** Runtime = Bun (not Node, not Browser)
- **D2:** Framework = effect-smol (Context/Layer DI)
- **D3:** Disk format compatibility over performance
- **D4:** MCP stdio only (no HTTP server)
- **D5:** Read-first, then write (M1→M2→M3→M4)
- **D6:** FileRead vs FileWrite split for testability
- **D7:** No cross-package relative imports (only @aura/*)
- **D8:** Optional services for recall pipeline
- **D9:** Recall-first implementation order
- **D10:** SIMPLE/FULL IMPLEMENTATION comment markers mandatory

## Constraints

- Disk format byte-level compatible (Rust ↔ TS)
- effect-smol layering: core/storage/codec/indexing/mcp only via @aura/*
- node:* only in @aura/platform-node and test glue
- All packages must have package.json with name: @aura/<pkg>, type: module, exports

## Current State

**Phase 07 (MCP + Polish) planned** — 8 plans across 4 waves. Former backlog `999.1` / `999.2` plus remaining maintenance-service D-07 debt are now folded into the phase so MCP/governance/explainability parity can be closed at the server boundary.

## Requirements

### Validated in Phase 06.3

- REQ-011: Per-engine type-level parity — 19 constants/thresholds/formulas verified against Rust source
- REQ-012: Rust fixture E2E verification — 3 fixture sets cross-referenced, recall parity confirmed

Last updated: 2026-05-30

## Phase 7: MCP + Polish
### Roadmap Section
## Phase 7: MCP + Polish

**Goal:** MCP stdio server + full tool coverage + final parity verification

**Requirements:** REQ-001, REQ-012
**Depends on:** Phase 06.3
**Source:** `07-SPEC.md`, `07-CONTEXT.md`, former backlog `999.1` + `999.2`

**Success Criteria:**

- MCP stdio server starts and responds
- All tools (recall/store/search/insights/maintain/etc.) implemented
- Rust MCP and TS MCP produce equivalent responses for same brain directory

**Scope folded in:**

- Former backlog `999.1` (MaintenanceService TODO cleanup + public `Aura` defect cleanup)
- Former backlog `999.2` (cross-engine NON-PARITY tracking + Policy surface cleanup + `runMaintenance` record-path fix)
- Remaining D-07 maintenance-service algorithm debt required to make `maintain` / `insights` / `memory_health` / explainability-governance tools parity-grade

**Plans:** 8 plans, 4 waves

**Wave 1** *(foundation — blocked only by plan ordering inside the wave)*

- [ ] 07-01-PLAN.md — MCP-facing contract DTOs + unsupported error contract + maintenance artifact stores
- [ ] 07-02-PLAN.md — MaintenanceService parity completion + persisted trend/reflection outputs
- [ ] 07-03-PLAN.md — Core facade alignment for write/search/maintain/consolidate + backlog `999.1` / `999.2` structural fixes

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 07-04-PLAN.md — Governance/inspection/read-model facades: belief instability, policy lifecycle, namespace governance, memory health, cross-namespace digest
- [ ] 07-05-PLAN.md — Explainability + correction facades: explain_recall/record/bundle, correction log, review queues, suggested corrections

**Wave 3** *(blocked on Waves 1-2 completion)*

- [ ] 07-06-PLAN.md — `@aura/mcp` package scaffold with Mastra stdio server, env binding, schemas, and inventory smoke test
- [ ] 07-07-PLAN.md — Full MCP handler wiring, Rust-shaped text payloads, invocation tests, and explicit unsupported mapping

**Wave 4** *(blocked on Waves 1-3 completion)*

- [ ] 07-08-PLAN.md — Rust-vs-TS MCP parity harness, family-level E2E comparison, and final Phase 7 verification/closeout

## Backlog

### Phase 999.3: 引擎工具函数去重 — Effect 包装提取到 utils 包 (BACKLOG)

**Goal:** 提取 BeliefEngine/ConceptEngine 中重复的 UnionFind、CausalEngine/PolicyEngine 中重复的 polarity signal counting、以及 xxhash 初始化模式到 `@aura/utils`
**Requirements:** TBD
**Plans:** 0 plans

Source: `06.3-REVIEW.md § IN-07, IN-08` + `/gsd:capture` todo `2026-05-29-extract-duplicate-effect-wrappers-to-utils`

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Requirements Addressed
# REQUIREMENTS.md

## REQ-001: TypeScript 1:1 Rewrite of Rust Core

TypeScript must implement all Rust core capabilities with byte-level disk format compatibility.

## REQ-002: effect-smol Layering

Core logic transparent to IO/cache/time/crypto; testable via dependency substitution.

## REQ-003: @aura/contract Package

Context Tags only; no implementations, no node:* imports.

## REQ-004: @aura/utils Package

Pure functions only; no IO, no Effect Context.

## REQ-005: @aura/platform-node Package

Bun/Node Live Layer implementations; only package with node:* imports.

## REQ-006: FileRead Service

readFile, exists, stat with Effect<...> return types.

## REQ-007: FileWrite Service

mkdirp, writeFile, appendFile, writeAt, fsync with Effect<...> return types.

## REQ-008: Crypto Service Contract

deriveKeyFromPassword, encryptData, decryptData, computeHmac.

## REQ-009: Recall Pipeline Alignment

SDR + NGram + Tags + optional Embedding; RRF fusion; graph/causal expansion; trust-aware scoring.

## REQ-010: Deterministic Tests

Fixed Clock, mock RecallView; Phase A (no disk), Phase B (fixtures), Phase C (verifier).

## REQ-011: Epistemic Layer Skeleton

Belief/Concept/Causal/Policy engines with effect-smol Context/Layer.

## REQ-012: Maintenance Pipeline End-to-End

Trace → Belief → Concept → Causal → Policy with bounded reranking and finalize.


### User Decisions (CONTEXT.md)
# Phase 07: mcp-polish - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

为 TypeScript Aura workspace 增加基于 stdio 的 MCP server，补齐 Phase 7 声明的完整 tool inventory，关闭 backlog `999.1` 与 `999.2`，并以 MCP server 黑盒对比的方式完成 Rust ↔ TS 的工具级 parity 验证。

本 phase 的重点不是再设计新能力，而是把 Rust 已有 MCP surface 与 TS 端现有 `@aura/*` 能力做完整语义投影、统一公开入口、统一错误契约、统一验证边界。

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**7 requirements are locked.** See `07-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `07-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- A new Phase 7 directory under `.planning/phases/07-mcp-polish/` with discuss/plan/execute artifacts derived from this SPEC.
- A new TypeScript MCP server package using Mastra as the MCP server/tool harness.
- MCP stdio startup and initialization for the TypeScript Aura implementation.
- Full declared MCP tool inventory for Phase 7, including explicit handling of temporarily unsupported tools.
- Automated E2E verification that compares TS MCP behavior with the Rust reference on the same brain fixtures/directories.
- Full closure of backlog `999.1` and `999.2` in code and verification artifacts.
- Tool-surface stabilization needed to make MCP/E2E possible, including Aura/MaintenanceService fixes that are directly part of `999.1` and `999.2`.

**Out of scope (from SPEC.md):**
- Replacing Aura business logic with Mastra primitives.
- New browser UI, dashboard, or HTTP server work.
- Backlog `999.3` (`@aura/utils` dedup/refactor).
- Broad algorithm redesign beyond what is necessary to close `999.1`/`999.2` and satisfy MCP parity.
- Non-MCP feature expansion unrelated to parity/server readiness.

</spec_lock>

<decisions>
## Implementation Decisions

### Semantic Projection Discipline
- **D-01:** 本 phase 以“完整语义投影”为硬要求推进。TS 侧新增的 MCP-facing surface 必须尽量做到与 Rust 侧逐方法、逐行为、逐返回形态可对照；实现过程中应保持“每一段 TS 逻辑都能指出对应的 Rust 参考位置”。
- **D-02:** 如果实现过程中遇到 Rust 可调用的实例/方法在 TS 中不存在、或 TS 现有语义基础不足以安全投影，**不要静默忽略、不要擅自降级、不要偷偷失败**；优先向用户提问确认，再决定是补齐实现还是显式 unsupported。
- **D-03:** Phase 7 的优先级是 Rust 对齐，不为了“更 TS 风格”而改变公开 surface、返回形态或编排入口。

### MCP Server Startup And Brain Binding
- **D-04:** TS MCP server 采用“启动时绑定单一 brain”的模型，不做每个 tool 动态切换 brain。
- **D-05:** 启动契约严格复刻 Rust，只使用 `AURA_BRAIN_PATH` / `AURA_PASSWORD`，并保留 `./aura_brain` 默认回落。
- **D-06:** server 在进程启动时打开一次 `Aura`，后续所有 tool handler 复用同一个长期存活实例。
- **D-07:** 如果 brain 路径不存在、密码不匹配、或 brain 格式损坏，server 启动即失败并退出，不把配置错误拖到 tool 调用期。

### MCP Tool Entry Layer
- **D-08:** MCP tool 入口统一收敛到 `@aura/core`，优先补齐 `Aura` / core facade，再由 `@aura/mcp` 做 transport 与参数映射。
- **D-09:** Rust MCP 所需但 TS `Aura` 当前缺失的 surface，直接补进 `@aura/core`，而不是把拼装逻辑留在 `@aura/mcp`。
- **D-10:** `@aura/core` 既覆盖本 phase MCP inventory 需要的公开面，也尽量向 Rust `Aura` 的相关 public surface 靠齐；但不扩到本 phase 无关的 graph/entity/project 能力。
- **D-11:** 对本 phase 不相关、或暂时缺少 TS 实现基础的 Rust public API，可以先在 core 层定义对齐入口，但必须返回标准化、可测试的 unsupported 响应，不能静默缺失。
- **D-12:** core facade 内部允许委托 `EpistemicRuntime` 与既有 surface helper；MCP 层不能直接拼底层实现。
- **D-13:** 实现形态采用“两层收敛”：先在 `packages/core/src/` 新增少量 MCP-facing facade / helper，再由 `Aura` 实例方法委托它们。
- **D-14:** Phase 7 新增的 MCP-facing facade / helper 优先集中放在 `packages/core/src/` 下的少量文件中，不把 MCP 组合逻辑分散到各领域包。
- **D-15:** `Aura` 上新增的 MCP-facing 方法名尽量严格贴 Rust 原名，优先保留一一可对照的 surface。

### MCP Response Shape And Error Contract
- **D-16:** Phase 7 优先对齐 Rust MCP 的外部响应 shape，而不是只保证归一化后的内部语义接近。
- **D-17:** 如果 Rust tool 当前返回的是 `Content::text(...)`，即使文本内容本身是 JSON 字符串，TS 也严格跟随 Rust，先复刻同样的 text 载荷。
- **D-18:** 正常返回与错误返回都尽量贴 Rust 的 MCP 外部风格。
- **D-19:** TS 侧错误建模使用 Effect 的 `TaggedError` 风格；不要引入松散 `Error` / `unknown` 错误通道。
- **D-20:** 如果 Rust 某个 tool 返回所需字段 TS 还缺少关键数据来源或关键算法，原则是“能补齐就补齐；确实做不到就整个 tool 走标准化 unsupported”，不返回缩水成功结果。
- **D-21:** verifier 只允许忽略纯表示层噪音，例如 JSON 空白、对象 key 顺序、以及安全的时间/浮点格式化差异；不忽略媒介类型变化、字段缺失/新增、核心文案结构变化。
- **D-22:** 如果某些地方不得不采用非严格对齐实现，必须留下可全局检索的显式注释，优先使用现有约定：`NON-PARITY IMPLEMENTATION:`、`UNIMPLEMENTED:`、`TODO:`。

### Maintain Tool And Unsupported Contract
- **D-23:** 工具清单冲突时，以 `07-SPEC.md` 为准。TS Phase 7 必须覆盖 SPEC 列出的完整 inventory。
- **D-24:** Phase 7 显式提供 `maintain` tool，由 TS 侧直接暴露并走 `Aura.runMaintenance()` / core facade。即使整体目标是优先对齐 Rust 既有功能，新增不冲突的 tool 并不构成问题。
- **D-25:** 标准化 unsupported contract 在 `@aura/core` 定义领域级 `TaggedError`，`@aura/mcp` 只负责映射。
- **D-26:** unsupported 错误定义必须放在单独文件中，不能混杂在模块实现文件里，方便复用、检索和统计。
- **D-27:** 只有在某个 tool 缺少完成 Rust/SPEC 所需的关键数据或关键算法时，才允许返回标准化 unsupported；不能因为实现麻烦或暂时没做就随意 unsupported。
- **D-28:** unsupported 分支也必须保持良好的注释规范，显式写明原因、缺口来源和 Rust reference。
- **D-29:** unsupported 必须在三处同时显式可见：代码层、测试层、最终 phase verification artifact。
- **D-30:** 已定目标必须严肃执行，不能在实现阶段用“先挂 unsupported”稀释验收标准。

### MCP E2E Parity Harness
- **D-31:** Phase 7 parity harness 以黑盒 MCP server-to-server 对比为主。Rust MCP 与 TS MCP 在同一 fixture 设计下接受同一组工具调用，比较的是对外 MCP 响应。
- **D-32:** E2E parity 用例按工具家族分组组织，至少覆盖写入家族、检索家族、维护/inspection 家族、explainability/governance 家族。
- **D-33:** Phase 7 的 server-to-server E2E 以 MCP 专用 fixture 为主，不强绑既有 library parity fixture；是否复用现有底层生成逻辑由执行阶段自行判断，但不能为了复用而牺牲工具级可控性。
- **D-34:** MCP E2E 允许按家族共享一个 brain 并顺序累积状态，不强制每个用例都从全新副本开始。状态串扰被视为发现真实偏差的机会，而不是必须规避的噪音。
- **D-35:** MCP 黑盒 parity 的通过标准同时包含两层：每个 tool 调用都做单次响应比对；每个工具家族末尾再做一次最终 brain 状态 / 派生读取比对。

### Folded Maintenance Debt
- **D-36:** 用户确认：Phase 7 不只是给当前维护骨架包一层 MCP；`maintain` / `insights` / `memory_health` / explainability/governance 所需的剩余 D-07 maintenance algorithm debt 一并并入本 phase。
- **D-37:** 因为 maintenance debt 已并入本 phase，原先挂在 pending/backlog 的 `MaintenanceService` TODO 与 Policy surface 清理项不再单独保留 todo，后续在本 phase 的计划、执行与验证工件中统一跟踪。

### Folded Todos
- **重构PolicyEngine — 剔除不必要的遗留实现**：原始问题是 `packages/policy/src/Surface.ts` 仍依赖废弃的本地 `PolicyEngine` 扁平容器和 `policyEngineFromState` 适配器，导致 `PolicyEngine.Interface -> stats() -> state -> adapter -> surface` 的多余链路。该问题被折叠进本 phase，因为它直接命中 backlog `999.2` 的 Policy surface/type adaptation gap，并影响 `EpistemicRuntime` 与 MCP-facing policy tools 的收敛路径。执行阶段还应顺手检查 `packages/concept/src/Surface.ts` 是否存在同型冗余适配。

### the agent's Discretion
- `@aura/core` 下新增 facade / helper 的具体文件命名与拆分粒度。
- MCP 专用 fixture 的具体目录结构、生成方式、以及家族级测试顺序。
- 在不违反上述决策的前提下，哪些 inspection 工具优先复用 `EpistemicRuntime`，哪些需要新增 core facade 组合层。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 7 Spec And Project Constraints
- `.planning/phases/07-mcp-polish/07-SPEC.md` — Locked requirements, tool inventory, backlog pull-in, boundaries, and acceptance criteria for Phase 7.
- `.planning/PROJECT.md` — Project-level constraints: Bun runtime, effect-smol layering, MCP stdio only, no cross-package relative imports.
- `.planning/REQUIREMENTS.md` — Global requirements baseline, especially REQ-001 for 1:1 Rust rewrite expectations.
- `.planning/ROADMAP.md` — Phase 7 goal/success criteria and backlog `999.1` / `999.2` context.
- `.planning/STATE.md` — Current milestone state and deferred items carried into Phase 7.

### Prior Phase Context
- `.planning/phases/06-maintenance-pipeline-completion/06-CONTEXT.md` — Maintenance pipeline completion baseline and remaining MCP-facing gaps.
- `.planning/phases/06.2-epistemicruntime-maintain-maintenanceservice-rust/06.2-CONTEXT.md` — MaintenanceService vs EpistemicRuntime separation; do not collapse read/write responsibilities again.
- `.planning/phases/06.3-engine-algorithm-parity/06.3-CONTEXT.md` — Rust algorithm parity discipline and project expectation for line-by-line semantic alignment.
- `.planning/phases/06.1-/06.1-CONTEXT.md` — Earlier strict type repair context for epistemic packages.

### Rust MCP Reference
- `../src/mcp.rs` — Primary Rust MCP stdio server reference: tool inventory, tool names, parameter names, return shapes, and startup contract.
- `../src/bin/aura-mcp.rs` — Rust MCP binary entrypoint, env-based startup, stdio transport bootstrapping.
- `../src/aura.rs` — Rust `Aura` public API surface, including recall/explainability/analytics/correction/memory health/consolidation methods referenced by MCP.
- `../src/api_groups.rs` — Grouped read-only API facades used by Rust for explainability, analytics, correction, and memory health surfaces.
- `../src/maintenance_service.rs` — Maintenance orchestration semantics behind `maintain`-adjacent TS surface decisions.

### TypeScript Core And Inspection Surfaces
- `packages/core/src/Aura.ts` — Current TS facade surface, existing MCP-adjacent methods, and current unimplemented public APIs that must be resolved.
- `packages/core/src/MaintenanceService.ts` — Current maintenance orchestration, placeholder unknown types, D-07 deferred markers, and backlog `999.1` closure target.
- `packages/contract/src/EpistemicRuntime.ts` — Read-only inspection contract already available for reuse by core MCP-facing facade.
- `packages/epistemic-runtime/src/EpistemicRuntime.ts` — Existing implementation for belief instability, policy lifecycle, contradiction clusters, surfaced concepts/policy hints, and other inspection primitives.
- `packages/policy/src/Surface.ts` — Folded todo target for Policy surface cleanup and contract-aligned type simplification.

### Codebase Maps
- `.planning/codebase/STACK.md` — Runtime, package manager, module system, and strict TS constraints.
- `.planning/codebase/INTEGRATIONS.md` — Existing injected services, Rust interop strategy, and optional service boundaries.
- `.planning/codebase/CONVENTIONS.md` — Error handling, enum strategy, comment markers, naming conventions, and test expectations that Phase 7 must follow.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/Aura.ts`: 已有 `store` / `update` / `delete` / `connect` / `recall` / `recall_structured` / `recall_full` / `runMaintenance` 主入口，可作为 MCP facade 的现成宿主。
- `packages/core/src/MaintenanceService.ts`: 已有维护编排骨架和 telemetry 汇总逻辑，可直接支撑 `maintain` tool，但需要解决 `unknown` 占位与 backlog `999.1`。
- `packages/contract/src/EpistemicRuntime.ts` + `packages/epistemic-runtime/src/EpistemicRuntime.ts`: 已经实现 `belief_instability`、`policy_lifecycle`、`getPolicyPressureReport`、`getContradictionClusters`、namespace filtered surfaced helpers 等 inspection primitives。
- `packages/policy/src/Surface.ts` / `packages/concept/src/Surface.ts`: 已有可复用的 surfaced output 生成逻辑，但 policy 侧存在折叠进 scope 的适配层冗余。
- `packages/storage/src/PersistenceManifest.ts`: 已为 `maintenance_trends` 与 `reflection_summaries` 预留 manifest surface 版本位，但当前仍缺少对应 store/file helper 与持久化闭环。

### Established Patterns
- `@aura/core` 负责门面与编排，底层能力仍留在 `@aura/*` 领域包中；Phase 7 要延续这个边界，不让 `@aura/mcp` 变成第二编排层。
- Error handling 使用 Effect `TaggedError`；主流程公开 API 不应靠 `Effect.die` 暴露缺失功能。
- Rust parity 注释规范已经明确：`NON-PARITY IMPLEMENTATION:`、`UNIMPLEMENTED:`、`TODO:` 必须可检索。
- `EpistemicRuntime` 是纯只读 inspection surface，`MaintenanceService` 是写侧维护编排，这个分层在 06.2 已锁定，Phase 7 只能复用不能破坏。

### Integration Points
- 新的 MCP package 需要连接 `@aura/core` 的 `Aura` facade，而不是直接连接各 engine/store。
- `Aura` 需要新增或补齐 Rust 对应 public surface，再由 `@aura/mcp` 进行 tool 注册与参数/错误映射。
- `EpistemicRuntime` 是现成的只读委托点，适合承接 `belief_instability`、`policy_lifecycle`、队列类与 namespace governance 的部分基础数据。
- `MaintenanceService` / `Aura.runMaintenance()` 是 `maintain` tool 的直接落点。

</code_context>

<specifics>
## Specific Ideas

- `maintain` 即使不是 Rust 当前 `mcp.rs` 的独立 tool，也要在 TS Phase 7 显式提供，因为 SPEC 已锁定它属于完整 inventory。
- 对于 explainability / analytics / governance 类 tool，优先先在 `packages/core/src/` 收敛少量 facade，再由 `Aura` 实例方法委托，而不是让 MCP 包拼各处调用。
- 对于 Rust 当前已返回 `Content::text(...)` 的工具，即使内容是 JSON 字符串，也不在 TS 端“优化”为结构化返回。
- Phase 7 的 MCP parity 不应只做理想环境隔离；顺序累积状态被明确视为查偏差手段之一。

</specifics>

<deferred>
## Deferred Ideas

- 本 phase 不扩到 graph/entity/project 类 Rust public API；若后续需要，应单独立 phase，而不是借 Phase 7 顺手膨胀。

### Reviewed Todos (not folded)
- 除已并入本 phase 的 MaintenanceService / Policy surface todo 外，其余 pending todos 未折叠进入本 phase：它们与当前 MCP inventory、`999.1` / `999.2` 闭环无直接强耦合，保持 backlog 状态，避免 Phase 7 范围继续膨胀。

</deferred>

---

*Phase: 07-mcp-polish*
*Context gathered: 2026-05-30*


### Research Findings
# Phase 07: MCP + Polish - Research

**Date:** 2026-05-30
**Phase:** 07-mcp-polish
**Status:** Ready for planning

## Summary

Phase 7 is no longer just "add an MCP shell". After codebase research and a user clarification on 2026-05-30, this phase now has to do four things together:

1. Close the old structural backlog folded in from `999.1` and `999.2`.
2. Finish the remaining D-07 maintenance debt that would otherwise make `maintain`, `insights`, `memory_health`, and explainability/governance tools shallow or misleading.
3. Add a Mastra-based MCP stdio package that exposes the full declared inventory.
4. Prove tool-level Rust parity with an automated MCP server-to-server harness.

This is a full-surface phase. The safe planning strategy is to build shared DTO/persistence foundations first, then complete maintenance/core facades, then add the MCP transport layer, and only then lock parity at the server boundary.

## Locked Constraints

### From Phase 7 SPEC/CONTEXT

- Full Phase 7 only; no reduced slice.
- Tool delivery may be wave-based, but final scope must reach the full declared inventory.
- Mastra is server/test infrastructure only; Aura domain logic stays in `@aura/*`.
- Startup contract matches Rust: `AURA_BRAIN_PATH`, `AURA_PASSWORD`, default fallback `./aura_brain`.
- MCP entry points must converge on `@aura/core`, not on direct `@aura/*` fan-out from the MCP package.
- Output shape follows Rust MCP externally; when Rust returns text content, TS must also return text content.
- Unsupported handling, if still needed anywhere, must be explicit, deterministic, test-covered, and visible in final verification.

### User Clarification Added During Planning

- The remaining D-07 maintenance algorithm debt is now part of Phase 7.
- The old pending todo items for `MaintenanceService` and Policy surface cleanup were folded into this phase and removed from `.planning/todos/pending/`.

## Current Codebase Reality

### What already exists and can be reused

- `packages/core/src/Aura.ts`
  - Has real `store`, `update`, `delete`, `connect`, `recall`, `recall_structured`, `recall_full`, `runMaintenance`.
- `packages/core/src/MaintenanceService.ts`
  - Has the orchestration skeleton and some real engine sequencing.
- `packages/contract/src/EpistemicRuntime.ts` and `packages/epistemic-runtime/src/EpistemicRuntime.ts`
  - Already expose `belief_instability`, `policy_lifecycle`, contradiction clusters, surfaced concepts, surfaced policy hints, and policy pressure reports.
- `packages/storage/src/PersistenceManifest.ts`
  - Already reserves manifest surface versions for `maintenance_trends` and `reflection_summaries`.
- The workspace is green on `bun run typecheck` as of 2026-05-30, which means this phase starts from a stable compile baseline.

### Structural gaps in TS today

- No `@aura/mcp` package exists.
- No `@mastra/*` or `zod` dependency exists in the workspace yet.
- `Aura.ts` still contains public `Effect.die(new UnimplementedError(...))` methods for MCP-relevant surfaces.
- `MaintenanceService.ts` still contains:
  - 5 `type ... = unknown` placeholders.
  - 15 D-07 deferred/stub markers.
- `packages/policy/src/Surface.ts` still depends on a deprecated local flat adapter shape.
- The TS contract package does not yet define the Rust-like DTO families needed for:
  - explainability bundles
  - correction logs/review queues
  - namespace governance summaries
  - memory-health digests
  - cross-namespace digest payloads

### Persistence/read-model gaps that directly affect MCP parity

- `maintenance_trends` and `reflection_summaries` are present in the manifest version map but have no concrete file helpers yet.
- No TS-side correction-log persistence/read model is exposed today.
- `Aura.runMaintenance()` still runs against a code path that was previously flagged for `BrainAuraRecord`/`AuraRecord` mismatch risk in review.

## Rust-to-TS Surface Mapping

| MCP tool | Rust backing | TS status now | Planning implication |
|----------|--------------|---------------|----------------------|
| `recall` | `Aura::recall` | partial | existing TS method exists, but Rust-shaped MCP response still missing |
| `recall_structured` | `Aura::recall_structured` | partial | existing TS method exists, but output DTO parity still missing |
| `store` | `Aura::store` | partial | existing TS method exists |
| `store_code` | `Aura::store` wrapper | missing | add core helper, then MCP handler |
| `store_decision` | `Aura::store` wrapper | missing | add core helper, then MCP handler |
| `search` | `Aura::search` | missing | add real TS core surface |
| `insights` | `Aura::stats` | missing | add core surface; may need maintenance-derived data |
| `maintain` | maintenance orchestration | partial | TS exists, but maintenance debt must be closed |
| `cross_namespace_digest` | `Aura::cross_namespace_digest_with_options` | missing | requires DTO + facade + algorithm parity |
| `explain_record` | `Aura::explain_record` | defect | currently `Effect.die` |
| `explain_recall` | `Aura::explain_recall` | defect | currently `Effect.die` |
| `explainability_bundle` | `Aura::explainability_bundle` | missing | requires explainability + maintenance history + corrections |
| `correction_log` | correction API | missing | requires persistence/read model |
| `correction_review_queue` | correction API | missing | requires review-priority logic |
| `contradiction_review_queue` | operator/correction API | missing | can reuse contradiction clusters, but queue logic is missing |
| `suggested_corrections` | operator/correction API | missing | requires read-model and prioritization logic |
| `namespace_governance_status` | governance API | missing | depends on instability + correction + maintenance summaries |
| `policy_lifecycle` | operator API | partial | runtime primitives exist; core facade still missing |
| `belief_instability` | operator API | partial | runtime primitives exist; core facade still missing |
| `memory_health` | operator API | missing | depends on maintenance summaries + corrections + instability |
| `consolidate` | `Aura::consolidate` | missing | add core surface and parity checks |

## Backlog Items Now Folded Into This Phase

### Former `999.1`

- Remove `unknown` placeholder types from `MaintenanceService.ts`.
- Replace public `Effect.die(...)` defects in `Aura.ts` with recoverable, typed failures for MCP-facing surfaces.
- Remove or consolidate stale D-07 markers so the remaining TODOs are accurate and searchable.

### Former `999.2`

- Fix `Aura.runMaintenance()` so it operates on contract-compatible record data without unsafe `BrainAuraRecord` casting assumptions.
- Clean up Policy surface type adaptation and remove the zombie adapter path.
- Centralize or eliminate cross-engine xxhash NON-PARITY tracking.

### Newly folded D-07 maintenance debt

The following are not optional anymore because they feed tool-level parity:

- `runInitialPhases` stubs
- `buildSdrLookup` stub
- `runDiscoveryPhases` feedback stub
- `runPostDiscoveryPhases` stubs
- `buildReflectionSummary` stubs
- persisted maintenance trend/reflection outputs

## Mastra Research Notes

### Official docs checked

- Mastra MCP server reference: `https://mastra.ai/en/reference/tools/mcp-server`
- Mastra `createTool` reference: `https://mastra.ai/reference/agents/createTool`

### What is planning-safe to assume from those docs

- Mastra has an official MCP server abstraction and a dedicated tool-definition flow.
- Tool definitions are schema-driven rather than ad hoc string parsing.
- The MCP package should stay thin and primarily do:
  - tool schema declaration
  - env/bootstrap/startup wiring
  - request-to-core mapping
  - core-error to MCP-error mapping

### What still must be re-verified during execution

The exact Mastra bootstrap call names, constructor options, and stdio start API should be re-opened from the official docs immediately before implementation. Phase 7 planning should not hard-code speculative method names if they have not been verified in the live docs on execution day.

## Recommended Architecture Split

### `@aura/contract`

- Add MCP-facing DTOs, enums, and typed error contracts.
- Keep unsupported/error shapes centralized here where cross-package consumers can share them.

### `@aura/storage`

- Add verified file helpers for persisted maintenance artifacts already listed in the manifest.
- Reuse shared JSON snapshot helpers where possible; do not create one-off JSON code paths.

### `@aura/core`

- Be the only layer that the MCP package talks to.
- Own MCP-facing facades and wrappers around `Aura`.
- Reuse `EpistemicRuntime` for read-only inspections.
- Reuse/complete `MaintenanceService` for write-side maintenance and derived artifacts.

### `@aura/mcp`

- New workspace package.
- Mastra-only boundary.
- Owns tool registration, startup binding, and Rust-shaped response serialization.

### Parity harness

- Launch TS MCP and Rust MCP against the same brain fixtures/directories.
- Compare per-call MCP payloads and per-family end-state outputs.

## Wave Recommendation

### Wave 1: Shared foundations and maintenance debt

- Add contract DTOs/errors and storage helpers.
- Finish maintenance parity and persisted maintenance outputs.
- Close `999.1` / `999.2` structural issues in `@aura/core`.

### Wave 2: Missing core facades

- Add governance/inspection surfaces.
- Add explainability/correction surfaces.

### Wave 3: MCP transport layer

- Add `@aura/mcp`.
- Register the full inventory and wire all tool handlers.

### Wave 4: Tool-level parity proof

- Run the MCP server-to-server verifier and close verification gaps.

## Validation Architecture

### Automated gates required for every plan

- `bun run typecheck`
- Targeted vitest package tests
- Tool inventory coverage tests once `@aura/mcp` exists
- MCP stdio smoke tests once the server package exists

### Final Phase 7 parity bar

- Inventory coverage: every declared tool is advertised and invocable.
- Write family parity: at least one `store`-family flow compared against Rust.
- Retrieval family parity: `recall` / `recall_structured` / `search`.
- Maintenance/inspection parity: `maintain` plus at least one governance/health family.
- Explainability/correction parity: explicit comparison rules with normalized noise only.

## Planning Pitfalls

1. Do not let `@aura/mcp` become a second orchestration layer.
2. Do not ship governance/health tools on top of the current maintenance skeleton and call that parity.
3. Do not add DTOs locally in `@aura/core` if they are shared structs/enums; they belong in `@aura/contract`.
4. Do not silently omit tools that lack implementation; omission fails the phase harder than explicit unsupported.
5. Do not hard-code Mastra APIs from memory when the docs can be re-opened during execution.

## Sources

### Primary

- `.planning/phases/07-mcp-polish/07-SPEC.md`
- `.planning/phases/07-mcp-polish/07-CONTEXT.md`
- `.planning/phases/06.2-epistemicruntime-maintain-maintenanceservice-rust/06.2-CONTEXT.md`
- `.planning/phases/06.3-engine-algorithm-parity/06.3-REVIEW.md`
- `packages/core/src/Aura.ts`
- `packages/core/src/MaintenanceService.ts`
- `packages/epistemic-runtime/src/EpistemicRuntime.ts`
- `packages/policy/src/Surface.ts`
- `packages/storage/src/PersistenceManifest.ts`
- `../src/mcp.rs`
- `../src/aura.rs`
- `../src/api_groups.rs`

### Official external docs

- `https://mastra.ai/en/reference/tools/mcp-server`
- `https://mastra.ai/reference/agents/createTool`

## Metadata

- Research mode: inline, code-first, no subagents spawned
- Phase impact: high
- Recommended plan count: 8
- Recommended waves: 4


### Plans to Review
### 07-01-PLAN.md
---
phase: 07-mcp-polish
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/contract/src/*
  - packages/storage/src/*
  - packages/contract/package.json
  - packages/storage/package.json
autonomous: false
requirements: [REQ-001, REQ-012]
must_haves:
  truths:
    - MCP-facing shared structs/enums/errors live in @aura/contract, not ad hoc in @aura/core or @aura/mcp
    - The DTO checklist is treated as exhaustive and is copied from Rust `api_groups.rs` / `aura.rs` before implementation starts; later plans do not infer missing fields ad hoc
    - Unsupported handling is modeled as a typed, recoverable error contract rather than Effect.die defects
    - Maintenance artifact persistence uses shared storage helpers and aligns with manifest-declared surfaces
    - No node:* imports are introduced outside tests and @aura/platform-node
  artifacts:
    - path: packages/contract/src
      provides: "MCP-facing DTOs and typed unsupported/parity error contracts"
    - path: packages/storage/src
      provides: "Typed helpers for maintenance trend/reflection artifact persistence"
---

<objective>
Create the shared contract and storage foundation required by the rest of Phase 7: MCP-facing DTO families, deterministic unsupported/parity error contracts, and concrete storage helpers for persisted maintenance artifacts already declared in the manifest.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@.planning/phases/07-mcp-polish/07-CONTEXT.md
@packages/storage/src/PersistenceManifest.ts
@packages/storage/src/CogJsonSnapshotFile.ts
@packages/contract/src/index.ts
@../src/aura.rs
</context>

<tasks>
- Add shared DTOs to `@aura/contract` for the MCP-facing families that are currently missing in TS. Start by copying an explicit Rust-to-TS checklist from `api_groups.rs` and the concrete struct definitions in `aura.rs`, and keep that checklist in `07-01-SUMMARY.md` so later plans cannot silently omit sub-fields.
- The checklist must be exhaustive for the Phase 7 surfaces, not illustrative. It must include:
  - explainability: `RecallExplanation`, `RecallExplanationItem`, `ProvenanceChain`, `ExplainabilityBundle`
  - explainability bundle members: `explain_record`, `provenance_chain`, `record_corrections`, `belief_corrections`, `causal_corrections`, `policy_corrections`, `reflection_digest`, `related_reflection_findings`, `maintenance_trends`
  - analytics/governance: `CrossNamespaceDigest`, `CrossNamespaceDigestOptions`, compact summary members, `NamespaceGovernanceStatus`, `MemoryHealthDigest`
  - correction/operator review: `CorrectionLogEntry`, `CorrectionReviewCandidate`, `ContradictionReviewCandidate`, `SuggestedCorrection`
  - maintenance artifacts: extend or reuse existing `MaintenanceTrendSnapshot` and `ReflectionSummary` types instead of silently replacing them with parallel shapes
- Define the cross-namespace dimension flag vocabulary from Rust up front so later plans do not invent it locally:
  - `concepts`, `tags`, `structural`, `causal`, `belief_states`, `corrections`
  - export a typed constant/enum-compatible helper surface that `07-04` can use to implement the TS equivalent of `apply_cross_namespace_dimension_flags`
- Lock timestamp/string representation while adding DTOs:
  - prefer the same JSON-safe string/number shapes Rust emits today
  - do not introduce `Date` objects or ad hoc timestamp coercions inside DTOs
- Add a dedicated typed unsupported/parity error contract in its own file under `@aura/contract`, following the existing `Data.TaggedError` pattern and the project rule that planned MCP surfaces must not crash via defect.
- Add verified storage helpers under `@aura/storage` for `maintenance_trends` and `reflection_summaries`, reusing existing JSON snapshot helpers where possible instead of inventing one-off serializers.
- Do not add correction-log file persistence in this plan. Rust keeps correction-log state in memory on `Aura`, so Phase 7 should treat correction log as an in-memory read model unless later Rust research proves a disk contract exists.
- Export all newly added types/helpers and add targeted tests that prove round-trip shape stability and manifest compatibility.
</tasks>

<verification>
- `bun run typecheck`
- `bun run test --filter "@aura/contract"`
- `bun run test --filter "@aura/storage"`
- `rg "maintenance_trends|reflection_summaries" packages/storage packages/contract`
</verification>

<success_criteria>
- Shared MCP-facing DTOs exist in `@aura/contract`.
- Unsupported/parity errors are typed and reusable.
- Persisted maintenance artifact helpers exist for the manifest-declared surfaces.
- Later plans can depend on these types/helpers without redefining shapes locally.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-01-SUMMARY.md` when done.
</output>


### 07-02-PLAN.md
---
phase: 07-mcp-polish
plan: 02
type: execute
wave: 1
depends_on: [07-01]
files_modified:
  - packages/core/src/MaintenanceService.ts
  - packages/core/src/Aura.ts
  - packages/core/src/MaintenanceService.test.ts
  - packages/storage/src/*
autonomous: false
requirements: [REQ-001, REQ-012]
must_haves:
  truths:
    - All remaining MaintenanceService unknown placeholders are replaced with either real typed dependencies or explicit typed shims; the two cases are not conflated
    - D-07 maintenance work is split into a typed-shim pass and an algorithm-completion pass so execution cannot silently sprawl into "build every missing subsystem"
    - `SDRInterpreter` does not end this plan as an empty or identity shim; maintenance must use content-derived vectors via the existing `@aura/recall` interpreter unless a newly discovered layering violation is escalated
    - `TagTaxonomy` does not end this plan as a no-op pass-through; it must provide a bounded deterministic implementation strong enough for `fix_memory_levels` and `guarded_reflect`
    - `Aura` instance state explicitly owns maintenance trend history and reflection summary history; file persistence is a hydrate/mirror path, not the only source of truth
    - Constants, thresholds, and formulas are verified against Rust source during execution rather than copied from planning prose
    - Missing subsystems such as `SDRInterpreter`, `TagTaxonomy`, `NGramIndex`, `CognitiveStore`, and `BackgroundBrain` must each end this plan in one of three explicit states: implemented, typed shim with bounded behavior, or phase-blocking gap escalated to the user
---

<objective>
Finish the maintenance-service debt that was folded into Phase 7 without letting the phase sprawl into undefined subsystem invention: first classify and replace the zombie dependency placeholders with explicit typed contracts/shims, then implement the remaining D-07 maintenance behaviors that are actually required for `maintain`, `insights`, `memory_health`, and downstream explainability/governance parity, and persist maintenance trend/reflection outputs so later APIs have real inputs.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@packages/core/src/MaintenanceService.ts
@packages/core/src/MaintenanceService.test.ts
@packages/storage/src/PersistenceManifest.ts
@../src/maintenance_service.rs
@../src/aura.rs
</context>

<tasks>
- Start with a dependency classification pass for the five placeholder subsystems (`SDRInterpreter`, `TagTaxonomy`, `NGramIndex`, `CognitiveStore`, `BackgroundBrain`). For each one, document which concrete TS implementation already exists, which minimal typed shim is acceptable for Phase 7 parity, or which missing behavior would block meaningful parity and must be escalated.
- Lock the typed-shim ceiling before implementation so Wave 1 cannot sprawl. The acceptable Phase 7 bounded shims are:
  - `SDRInterpreter`: import and use the existing `@aura/recall/SDRInterpreter` as the default outcome; the only acceptable fallback is a deterministic content-derived sparse vector path that still produces non-empty SDRs for non-empty content and is marked `NON-PARITY IMPLEMENTATION:`. Empty arrays are allowed only for blank content.
  - `TagTaxonomy`: bounded deterministic taxonomy built from existing tag strings / namespace / semantic type / level cues. It may be heuristic and read-only, but it must normalize/classify strongly enough for `fix_memory_levels` and `guarded_reflect`; a pure pass-through wrapper is not acceptable.
  - `NGramIndex`: typed adapter over the current TS ngram implementation with explicit candidate-query capability usable by maintenance/consolidation, plus searchable `NON-PARITY IMPLEMENTATION` markers until the Rust-equivalent MinHash+LSH lands
  - `CognitiveStore`: thin typed adapter over the existing cognitive-record load/save path, never a new append-only store rewrite inside this plan
  - `BackgroundBrain`: no autonomous scheduler; only an explicit disabled shim for `discover_cross_connections` / scheduled-task paths that returns deterministic empty outputs and never pretends work was performed
- Replace the `unknown` placeholders in `MaintenanceService.ts` with one of two explicit forms only:
  - real imports to existing TS implementations
  - narrowly scoped typed shims that preserve a bounded, testable subset of Rust behavior and are annotated with searchable parity comments
- Add explicit `Aura` runtime ownership for persisted maintenance artifacts in this plan:
  - hydrate `maintenanceTrendHistory` and `reflectionSummaries` from the new storage helpers during `Aura.open*`
  - update those in-memory arrays during `runMaintenance()`
  - persist them back through storage helpers after mutation
  - keep any cycle-local caches (`Ref`s, temporary maps) local to the maintenance run rather than mixing them into persistent runtime state
- After the classification pass, implement the remaining stubbed sections in priority order, stopping once the Phase 7 downstream surfaces have real inputs:
  - first: `buildSdrLookup`, `fix_memory_levels`, `guarded_reflect`, `update_epistemic_state`, and the minimum `insights::detect_all` parity needed by `maintain`, `insights`, and `memory_health`
  - second: only the `runPostDiscoveryPhases` behaviors that feed `consolidate`, `cross_namespace_digest`, or persisted maintenance summaries
  - never: unrelated Rust maintenance branches that do not affect a declared Phase 7 MCP surface
- Keep Rust-aligned in-memory `Aura` maintenance history as the source of truth, and persist `MaintenanceTrendSnapshot[]` / `ReflectionSummary[]` only as a TS-side derived cache for reopen/introspection. Any disk mirror must be marked with searchable `NON-PARITY IMPLEMENTATION` comments that explain the divergence.
- Remove or consolidate stale D-07 markers so the remaining comments document only real, still-open gaps.
- Add targeted tests covering:
  - placeholder classification and shim behavior
  - `runMaintenance()` on a seeded content fixture produces `sdrVectorsComputed > 0`
  - `runMaintenance()` on a seeded fixture produces at least one non-zero downstream discovery/inspection signal (`insightsFound`, `concept.candidatesFound`, `causal.edgesFound`, or `policy.hintsFound`) so later surfaces are not built on vacuous all-zero output
  - maintenance history persistence
  - reflection/trend generation
  - any newly real algorithms introduced in this plan
- Produce a short implementation table in `07-02-SUMMARY.md` listing each former placeholder subsystem and whether it ended this plan as implemented, typed shim, or still blocked.
</tasks>

<verification>
- `bun run typecheck`
- `bun run test --filter "@aura/core"`
- `rg "type .* = unknown|TODO: Full algorithm deferred per D-07" packages/core/src/MaintenanceService.ts`
- `rg "SDRInterpreter|TagTaxonomy|NGramIndex|CognitiveStore|BackgroundBrain" packages/core/src/MaintenanceService.ts .planning/phases/07-mcp-polish/07-02-SUMMARY.md`
</verification>

<success_criteria>
- `MaintenanceService.ts` no longer relies on `unknown` placeholders.
- The executor can point to an explicit implemented-vs-typed-shim disposition for each formerly unknown subsystem.
- Maintenance outputs required by governance/health/explainability tools exist in Rust-aligned in-memory state and, where needed for TS reopen/introspection, in an explicitly documented derived cache.
- The Phase 7 executor can trust `maintain` to produce usable downstream data rather than just a skeleton report, and the summary includes concrete evidence that the seeded verification fixture is not all-zero.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-02-SUMMARY.md` when done.
</output>


### 07-03-PLAN.md
---
phase: 07-mcp-polish
plan: 03
type: execute
wave: 1
depends_on: [07-01, 07-02]
files_modified:
  - packages/core/src/Aura.ts
  - packages/core/src/index.ts
  - packages/policy/src/Surface.ts
  - packages/core/src/*.test.ts
autonomous: false
requirements: [REQ-001, REQ-012]
must_haves:
  truths:
    - Backlog 999.1 and 999.2 structural fixes are closed in code, not just re-documented
    - `Aura.runMaintenance()` operates on contract-compatible record data
    - `search` has an explicit state owner and population/update path inside `Aura`; this plan does not assume an unspecified future index
    - `consolidate` ends this plan in exactly one explicit state: implemented against available TS primitives or typed unsupported with inventory follow-through; stub success is forbidden
    - Public MCP-facing Aura methods fail recoverably, not via Effect.die defects
    - Policy surface helpers stop depending on the deprecated local flat adapter path
---

<objective>
Align the core facade with Rust for the basic MCP-facing operational surfaces and close the structural debt from former backlogs `999.1` and `999.2`: fix `runMaintenance()` record loading, remove public `Effect.die` defects, add missing write/search/maintain/consolidate entry points, and clean up Policy surface type adaptation.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@packages/core/src/Aura.ts
@packages/policy/src/Surface.ts
@../src/aura.rs
@../src/api_groups.rs
</context>

<tasks>
- Add or complete the Rust-aligned core surfaces required before the MCP layer exists: `store_code`, `store_decision`, `search`, `insights`, `maintain`, and `consolidate`.
- Treat `store_code` and `store_decision` as thin composition wrappers over `store`, matching Rust scope. They should set the Rust-aligned content/tag/metadata defaults without inventing a second persistence path.
- Fix `Aura.runMaintenance()` so it uses the contract-compatible cognitive record path instead of any unsafe `BrainAuraRecord` assumptions, and document the chosen boundary explicitly in code/tests: whether the source of truth is `BrainAuraRecord[]`, normalized `AuraRecord[]`, or a dual-path load/normalize step.
- Lock search ownership explicitly:
  - `Aura` must own a normalized searchable record view in memory
  - that view is populated from the same cognitive-record load/normalize path used by maintenance
  - write operations (`store` / `update` / `delete` / `connect` where relevant) must refresh the same in-memory view
  - `search` implements the concrete Rust semantics over that view: namespace defaulting, optional query substring match, `level`/`tags`/`content_type`/`source_type`/`semantic_type` filters, then Rust-aligned importance ordering and limit truncation
- Replace public `Effect.die(new UnimplementedError(...))` paths in MCP-relevant `Aura` methods with typed `Effect.fail(...)` behavior built on the new error contract from Plan 01.
- Align `insights` to the surface the Rust MCP server actually calls. This plan must decide and document whether the MCP-facing TS method mirrors `Aura.stats()` / analytics summary, `Aura.insights()`, or both via clearly named methods; do not hide the distinction behind one ambiguous helper.
- Add `maintain` as the public typed facade over `runMaintenance()` rather than leaving MCP to call private orchestration details.
- Refactor `packages/policy/src/Surface.ts` so surface helpers consume contract-aligned state directly or through an explicit, non-deprecated adapter that is still justified and tested.
- While cleaning the policy surface path, grep for the same zombie adapter shape inside `packages/epistemic-runtime/src/` and remove or justify it if it survives there.
- Lock the `consolidate` disposition before implementation begins and record it in `07-03-SUMMARY.md`:
  - preferred outcome: implement a deterministic consolidation path if `07-02` delivered usable `NGramIndex` candidate queries plus `CognitiveStore` mutation helpers
  - fallback outcome: return the typed unsupported/parity error from Plan 01 and propagate that explicit unsupported status into `07-07`/`07-08` inventory artifacts
  - forbidden outcome: return dummy success counts (`merged=0`, `checked=0`) without a real algorithm
- Centralize remaining xxhash-related NON-PARITY tracking markers so they can be audited from one reference.
</tasks>

<verification>
- `bun run typecheck`
- `bun run test --filter "@aura/core"`
- `bun run test --filter "@aura/policy"`
- `rg "Effect\\.die\\(" packages/core/src/Aura.ts`
</verification>

<success_criteria>
- Former backlog `999.1` and the structural portion of `999.2` are closed.
- `Aura` exposes the missing operational surfaces that the MCP package will call.
- `search` ownership/population/update behavior is explicit and test-covered.
- `consolidate` is either truly implemented or deliberately unsupported, with no silent stub path.
- Policy surface code no longer depends on the zombie local flat container path.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-03-SUMMARY.md` when done.
</output>


### 07-04-PLAN.md
---
phase: 07-mcp-polish
plan: 04
type: execute
wave: 2
depends_on: [07-01, 07-02, 07-03]
files_modified:
  - packages/core/src/*
  - packages/contract/src/*
  - packages/epistemic-runtime/src/*
  - packages/storage/src/*
autonomous: false
requirements: [REQ-001, REQ-012]
must_haves:
  truths:
    - Governance/inspection read models are exposed through @aura/core, not directly from the MCP package
    - `belief_instability` and `policy_lifecycle` reuse EpistemicRuntime instead of duplicating business logic
    - `namespace_governance_status`, `memory_health`, and `cross_namespace_digest` are backed by real persisted maintenance data where Rust expects it
    - Verification for this plan must prove the seeded multi-namespace fixture produces at least one non-zero digest dimension; a deterministic all-zero digest is treated as a failed baseline, not a pass
    - This plan defines explicit upstream inputs for each facade so `07-04` and `07-05` do not depend on each other circularly
---

<objective>
Build the missing governance and operator-facing core facades needed by the MCP inventory: `belief_instability`, `policy_lifecycle`, `namespace_governance_status`, `memory_health`, and `cross_namespace_digest`, all surfaced through `@aura/core` and backed by real maintenance/runtime data.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@packages/epistemic-runtime/src/EpistemicRuntime.ts
@packages/core/src/Aura.ts
@../src/api_groups.rs
@../src/aura.rs
</context>

<tasks>
- Add core facade methods and any minimal helper files in `packages/core/src/` for governance/inspection APIs rather than letting the future MCP layer compose them manually.
- Reuse `EpistemicRuntime` for the read-only primitives already implemented, and compose them with maintenance history / correction / digest data where the Rust surface expects broader payloads.
- Before coding, lock a per-surface input map in the implementation notes or summary:
  - `cross_namespace_digest`: namespace filters, top concept limits, minimum record counts, pairwise similarity thresholds, dimension flags, compact summary flags
  - `namespace_governance_status`: instability summary, correction counts, suggested corrections, surfaced policy hints, maintenance history by namespace
  - `memory_health`: maintenance trends, instability summary, policy lifecycle summary, correction review pressure
- Copy the exact `MemoryHealthDigest` field checklist from Rust into `07-04-SUMMARY.md` before implementation starts and map each field to its TS data source, including any staged zero/empty baseline fields.
- Implement `cross_namespace_digest` with verified Rust option handling, a dedicated `include_dimensions` helper equivalent, clamping rules, and output shape.
- Treat `namespace_governance_status` and `memory_health` as staged delivery surfaces:
  - Wave 2 baseline in this plan must return complete DTO shapes with deterministic zero/empty correction-derived fields when no correction write path has run yet
  - `07-05` is responsible for backfilling those same fields with non-zero data through the new correction writers and extending tests accordingly
- Implement `namespace_governance_status` and `memory_health` using the maintenance outputs added earlier plus instability/correction/policy data, but do not require any write path from `07-05`; this plan must stand on already-persisted or already-derived read models and document the zero-data baseline explicitly.
- Add targeted tests that prove the new payloads are deterministic and contract-aligned.
</tasks>

<verification>
- `bun run typecheck`
- `bun run test --filter "@aura/core"`
- `bun run test --filter "@aura/epistemic-runtime"`
- targeted seeded multi-namespace fixture test proving `cross_namespace_digest` / `memory_health` are not vacuous all-zero payloads
</verification>

<success_criteria>
- Governance and operator-facing read models exist behind `@aura/core`.
- No Phase 7 governance/health tool still depends on ad hoc MCP-layer composition.
- The payload families needed for later MCP handlers are now test-backed and deterministic, including the documented pre-correction zero/empty baseline for staged fields.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-04-SUMMARY.md` when done.
</output>


### 07-05-PLAN.md
---
phase: 07-mcp-polish
plan: 05
type: execute
wave: 2
depends_on: [07-01, 07-02, 07-03]
files_modified:
  - packages/core/src/*
  - packages/contract/src/*
  - packages/recall/src/*
  - packages/storage/src/*
  - packages/belief/src/*
  - packages/causal/src/*
  - packages/policy/src/*
autonomous: false
requirements: [REQ-001, REQ-012]
must_haves:
  truths:
    - Explainability and correction surfaces are implemented as real core APIs, not placeholders
    - Correction operations and read models are explicit, typed, verifier-visible, and not permanently empty because write paths were omitted
    - `explain_record`, `explain_recall`, and `explainability_bundle` use real upstream evidence and Rust-aligned payload families
    - No explainability tool ships on top of shallow scored-record output alone; this plan must add the evidence bridge first
    - `Aura` instance state explicitly owns the in-memory correction log for parity with Rust, and this plan does not quietly replace that with file-backed persistence
    - Existing engine contracts that already expose correction mutations (`deprecate_belief`, `invalidate_pattern`, `retract_hint`) are wired directly; this plan does not leave them implicit or hypothetical
---

<objective>
Implement the missing explainability and correction-facing core surfaces required by the MCP inventory, but in the correct order: first add a recall/provenance evidence bridge and the correction write/read path needed to populate real data, then expose `explain_record`, `explain_recall`, `explainability_bundle`, `correction_log`, `correction_review_queue`, `contradiction_review_queue`, and `suggested_corrections`.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@packages/core/src/Aura.ts
@../src/aura.rs
@../src/api_groups.rs
</context>

<tasks>
- Split implementation order inside this plan into three explicit passes and record each checkpoint in `07-05-SUMMARY.md`:
  - Pass A: recall evidence bridge
  - Pass B: correction write/read path
  - Pass C: explainability surfaces built on A+B
- Scope the recall evidence bridge before coding and record the mapping in `07-05-SUMMARY.md`. The bridge must reconstruct, at minimum:
  - `record_id -> recall signals` (SDR/tags/ngram/graph/causal/trust/recency contributions and scores)
  - `record_id -> belief hypotheses / contradiction state`
  - `record_id -> concept candidates`
  - `record_id -> causal patterns`
  - `record_id -> policy hints`
  This is a real provenance layer, not a thin wrapper over final scored records.
- Make the bridge concrete rather than post-hoc guesswork:
  - either add a trace-capable helper in `@aura/recall` / `@aura/core` that reruns the existing collectors and walk stages in the same order while accumulating per-record contribution buckets
  - or extend the recall pipeline with a trace variant that returns both final scored results and the intermediate evidence map
  - do not attempt to infer provenance only from the already-collapsed final score array
- Add the missing core methods and helper modules needed to construct Rust-aligned explainability DTOs and correction/governance queue payloads.
- Match Rust's correction-log storage model explicitly: keep correction log state in memory on the core/runtime side, mirroring Rust's `Vec<CorrectionLogEntry>`, and do not introduce file-backed persistence in this plan unless fresh Rust evidence proves it exists.
- Add explicit `Aura` runtime ownership for correction state in this plan:
  - add the in-memory correction log field(s) on `Aura`
  - add append/list/filter helpers on the core side
  - keep correction-log mutation and queue derivation in core/runtime, not in MCP handlers
- Make the correction write path explicit in this plan. The current TS contracts already expose most of the required engine mutations, so the work here is to wire them through `Aura`, append correction-log entries, and persist any changed engine state. At minimum enumerate and implement the hooks for:
  - `deprecate_belief_with_reason`
  - `invalidate_causal_pattern_with_reason`
  - `retract_policy_hint_with_reason`
  - correction-log append/list helpers used by review queues
- Reuse `EpistemicRuntime.getContradictionClusters()` as the source primitive for `contradiction_review_queue`, and add only the prioritization/ranking layer that Rust exposes on top.
- Build `explain_record`, `explain_recall`, and `explainability_bundle` on top of the now-complete maintenance/runtime data and the new evidence bridge rather than returning shrunken success payloads.
- Define a degraded-but-valid output contract in code/tests:
  - empty correction arrays are allowed when no correction events have occurred yet
  - empty reflection-derived lists are allowed when no maintenance reflection has been persisted yet
  - missing fields are not allowed
  - if any evidence bucket is intentionally unsupported, that unsupported status must be explicit in the summary and inventory instead of being silently omitted from the payload family
- Ensure every new method is typed, tested, and reachable from `Aura` without `Effect.die` defects.
- After correction writers land, rerun the relevant `07-04` governance/health tests with non-zero correction events and record the backfill evidence in `07-05-SUMMARY.md`.
- Record in `07-05-SUMMARY.md` which explainability and correction surfaces are fully implemented versus any deliberately unsupported residuals, with the data-source reason for each residual.
</tasks>

<verification>
- `bun run typecheck`
- `bun run test --filter "@aura/core"`
- `rg "explain_recall|explain_record|explainability_bundle|correction_" packages/core/src`
- targeted tests that mutate correction state and then assert non-empty correction log / queue outputs
- rerun of the relevant `07-04` seeded governance/health tests showing correction-derived fields backfill from zero/empty to non-zero when writes occur
</verification>

<success_criteria>
- Explainability and correction surfaces exist in `@aura/core`.
- Explainability surfaces are backed by real provenance/evidence data rather than final-score summaries alone.
- Correction read surfaces can be populated through explicit write paths in tests/fixtures, using a Rust-aligned in-memory correction log model.
- Queue/review outputs are deterministic and test-covered.
- The MCP layer can now wire the full declared explainability/governance inventory without inventing local business logic.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-05-SUMMARY.md` when done.
</output>


### 07-06-PLAN.md
---
phase: 07-mcp-polish
plan: 06
type: execute
wave: 3
depends_on: [07-03]
files_modified:
  - package.json
  - bun.lock
  - packages/mcp/package.json
  - packages/mcp/src/*
autonomous: false
requirements: [REQ-001]
must_haves:
  truths:
    - Mastra remains confined to the new MCP package and its tests
    - Startup binding matches Rust env semantics and opens Aura once at process start
    - The full Phase 7 tool inventory is declared up front and smoke-test visible
    - Package scaffolding may start once the operational core surfaces from `07-03` exist; governance/explainability handlers are wired in `07-07` after `07-04`/`07-05`
    - Exact Mastra bootstrap APIs are re-verified from official docs during execution
    - Bun/ESM compatibility is verified with a minimal stdio spike before the full server scaffold is expanded
    - If Mastra bootstrap fails under Bun/ESM, the fallback is `@modelcontextprotocol/sdk` direct stdio wiring inside `@aura/mcp`, not ad hoc core-layer leakage or an unplanned Node subprocess
---

<objective>
Create the `@aura/mcp` workspace package and Mastra-based stdio server scaffold: dependency wiring, env-based startup, tool schema definitions, explicit full-inventory registration, and a server smoke test that proves the TS MCP server can initialize over stdio.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@../src/mcp.rs
@../src/bin/aura-mcp.rs
@package.json
</context>

<tasks>
- Add the new workspace package and the minimum MCP-side dependencies needed for server startup and tool schema definitions, including any new schema library such as Zod if the chosen transport requires it.
- Start with a minimal compatibility spike: prove that the chosen Mastra bootstrap path starts under Bun/ESM in this workspace before registering the full tool inventory.
- Re-open the official Mastra docs during execution and verify the exact bootstrap/start-stdio APIs before implementation; do not rely on recalled method names from planning.
- If the Bun/ESM spike exposes an incompatibility, stop and switch to the pre-decided fallback: use `@modelcontextprotocol/sdk` directly for stdio transport and tool routing inside `@aura/mcp`, preserving the same inventory and payload semantics. Do not introduce a Node subprocess fallback in this phase unless the user explicitly re-scopes the phase.
- Implement Rust-aligned startup behavior: `AURA_BRAIN_PATH`, `AURA_PASSWORD`, default `./aura_brain`, and fail-fast initialization if the brain cannot be opened.
- Declare the entire Phase 7 tool inventory up front, but keep registration split by tool family if needed so the file structure stays maintainable. Any explicit unsupported mappings must still be centralized and auditable.
- Add a smoke/inventory test that proves the server initializes and reports tool capability over stdio.
</tasks>

<verification>
- `bun run typecheck`
- targeted `@aura/mcp` tests
- server init smoke test over stdio
</verification>

<success_criteria>
- `@aura/mcp` exists as a real workspace package.
- Mastra code stays confined to the MCP layer and tests.
- Bun/ESM startup compatibility is verified or consciously handled with a documented fallback.
- The full declared inventory is registered and discoverable.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-06-SUMMARY.md` when done.
</output>


### 07-07-PLAN.md
---
phase: 07-mcp-polish
plan: 07
type: execute
wave: 3
depends_on: [07-06]
files_modified:
  - packages/mcp/src/*
  - packages/core/src/*
  - packages/mcp/test/*
autonomous: false
requirements: [REQ-001]
must_haves:
  truths:
    - Every declared MCP tool is invocable from the TS server
    - Tool parameters and response shapes follow Rust closely, including text-vs-JSON decisions
    - Any remaining unsupported path is deterministic, explicit, and test-covered rather than silently omitted
---

<objective>
Finish MCP handler implementation for the full declared inventory: parameter mapping, Rust-shaped text payloads, explicit unsupported/error mapping, and invocation coverage tests that exercise every advertised tool.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@packages/mcp/src/*
@packages/core/src/Aura.ts
@../src/mcp.rs
</context>

<tasks>
- Implement all tool handlers by delegating only to `@aura/core` surfaces and translating request/response shapes to match Rust MCP expectations.
- Preserve Rust output media decisions, especially tools that return JSON serialized as text content rather than structured binary/JSON payloads.
- Add deterministic MCP error mapping for unsupported or typed failure conditions using the contracts from earlier plans.
- Add invocation coverage tests that prove every advertised tool can be called and returns either success or the standardized explicit unsupported response.
- Keep a single inventory ledger in the package tests or summary artifacts that marks each tool as implemented or explicitly unsupported, so `07-08` does not have to rediscover the surface state from scratch.
</tasks>

<verification>
- `bun run typecheck`
- targeted `@aura/mcp` tests
- inventory test: every required tool name advertised
- invocation test: every advertised tool invocable
</verification>

<success_criteria>
- No declared Phase 7 tool is silently missing from the server.
- Tool handlers are thin adapters over `@aura/core`.
- Unsupported behavior, if any remains, is explicit and verifier-visible.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-07-SUMMARY.md` when done.
</output>


### 07-08-PLAN.md
---
phase: 07-mcp-polish
plan: 08
type: execute
wave: 4
depends_on: [07-06, 07-07]
files_modified:
  - packages/mcp/test/*
  - recall_parity/*
  - .planning/phases/07-mcp-polish/*
  - .planning/STATE.md
  - .planning/ROADMAP.md
autonomous: false
requirements: [REQ-001, REQ-012]
must_haves:
  truths:
    - Rust and TS MCP servers are launched against the same fixtures/directories
    - Parity is checked at the MCP boundary, not just through library-unit surrogates
    - Verification covers at least one write family, one retrieval family, and one maintenance/inspection or governance family
    - Final closeout explicitly lists implemented vs unsupported tools and leaves no silent inventory gap
    - The parity harness defines how the Rust `aura-mcp` binary is built, discovered, and explicitly skipped when the environment cannot support it
---

<objective>
Build the final Rust-vs-TS MCP parity harness and produce the closeout evidence for Phase 7: shared fixtures, server launchers, normalized tool-level comparisons, final unsupported accounting, and verification artifacts proving the full declared inventory is either implemented or explicitly bounded.
</objective>

<context>
@.planning/phases/07-mcp-polish/07-RESEARCH.md
@packages/mcp/test/*
@recall_parity/*
@../src/mcp.rs
@../src/bin/aura-mcp.rs
</context>

<tasks>
- Add the MCP server-to-server parity harness that launches both implementations against shared fixtures/directories and groups calls by family.
- Define the Rust MCP binary contract inside the harness/docs:
  - a pre-flight check that detects `cargo`, attempts `cargo build --bin aura-mcp --features mcp` when the binary is absent, and records the exact binary path expected on Windows workspaces
  - how an already-built binary is discovered on Windows/Bun workspaces before any build is attempted
  - what exact skip condition is allowed when Cargo/Rust MCP startup is unavailable after pre-flight
  - how skip status is surfaced so parity is never reported as passed silently
- Compare per-call MCP payloads and end-of-family derived state/results with an explicit normalization pass:
  - sort JSON object keys recursively
  - normalize safe float/time formatting differences allowed by D-21
  - ignore insignificant whitespace only in text payloads explicitly allowed by the review rules
  - never ignore media-type changes, missing/extra fields, or materially different text structure
- Record the final implemented-vs-unsupported tool table in Phase 7 verification artifacts; if any unsupported behavior survives, it must be deliberate, explicit, and test-covered.
- Encode the two special verification branches up front:
  - TS-only tools such as `maintain` must be called and validated locally but are excluded from Rust parity comparison with an explicit inventory note
  - when Rust MCP cannot be built/run locally, compare TS MCP responses against saved Rust golden payloads generated from a previous verified run; never collapse this branch into a silent skip
- Update Phase 7 closeout artifacts and any remaining planning state needed to mark the folded backlog work as closed through Phase 7 execution rather than separate backlog items.
</tasks>

<verification>
- `bun run typecheck`
- full targeted MCP parity suite
- inventory coverage check
- explicit binary discovery/build smoke test for Rust MCP harness setup
- final manual review of Phase 7 verification artifact
</verification>

<success_criteria>
- TS MCP and Rust MCP are compared through an automated black-box harness.
- The Rust MCP side has a deterministic build/discovery/skip contract instead of an assumed local environment.
- Verification evidence exists for write, retrieval, and maintenance/governance families.
- Final Phase 7 artifacts make the inventory closure explicit.
</success_criteria>

<output>
Create `.planning/phases/07-mcp-polish/07-08-SUMMARY.md` and Phase 7 verification artifacts when done.
</output>


## Review Instructions

Analyze each plan and provide:

1. **Summary** — One-paragraph assessment
2. **Strengths** — What's well-designed (bullet points)
3. **Concerns** — Potential issues, gaps, risks (bullet points with severity: HIGH/MEDIUM/LOW)
4. **Suggestions** — Specific improvements (bullet points)
5. **Risk Assessment** — Overall risk level (LOW/MEDIUM/HIGH) with justification

Focus on:
- Missing edge cases or error handling
- Dependency ordering issues
- Scope creep or over-engineering
- Security considerations
- Performance implications
- Whether the plans actually achieve the phase goals

Output your review in markdown format.
