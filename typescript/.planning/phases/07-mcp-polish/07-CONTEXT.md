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
- `2026-05-30-policyengine.md` 以外的其余 pending todos 未折叠进入本 phase：它们与当前 MCP inventory、`999.1` / `999.2` 闭环无直接强耦合，保持 backlog 状态，避免 Phase 7 范围继续膨胀。

</deferred>

---

*Phase: 07-mcp-polish*
*Context gathered: 2026-05-30*
