# Phase 07: mcp-polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-30
**Phase:** 07-mcp-polish
**Areas discussed:** 启动与 brain 目录绑定, MCP 工具应走哪一层入口, 响应 shape 与 parity 粒度, maintain 与 unsupported contract, E2E parity harness 的比较边界

---

## 启动与 brain 目录绑定

| Option | Description | Selected |
|--------|-------------|----------|
| 启动时绑定单一 brain | 与 Rust 一致，进程启动时读取 `AURA_BRAIN_PATH` / `AURA_PASSWORD` 并绑定单个 `Aura` 实例 | ✓ |
| 启动时有默认 brain，但允许 tool 调用时覆盖 | 增加动态性，但会让 lifecycle 和 parity 更复杂 | |
| 完全无状态，每次 tool 调用都显式传 brain 路径 | 重新设计 API，偏离 Rust 当前模型 | |

**User's choice:** 启动时绑定单一 brain
**Notes:** 用户连续锁定了四个相关决定：严格复刻 Rust 的 env 契约；server 启动时打开一次 `Aura` 并长期复用；如果路径不存在、密码错误、或格式损坏则启动即失败退出。

---

## MCP 工具应走哪一层入口

| Option | Description | Selected |
|--------|-------------|----------|
| 尽量统一走 `@aura/core` 的 `Aura` 门面 | 由 core 暴露 MCP-facing surface，MCP 包只做 transport 和参数映射 | ✓ |
| 混合入口 | 写入/召回走 `Aura`，inspection/analytics 直连 runtime/surface/store | |
| MCP 包直接自由拼装 | `@aura/mcp` 自己变成第二编排层 | |

**User's choice:** 统一走 `@aura/core`，以对齐 Rust 优先避免转移注意力
**Notes:** 用户随后补充并锁定：
- Rust MCP 所需缺口直接补到 core / `Aura`，不要留在 MCP 包里拼装。
- `@aura/core` 既覆盖本 phase inventory，又尽量向 Rust `Aura` 相关 public surface 靠齐；不相关 graph/entity/project 能力可先定义接口并显式 unsupported。
- core 内部允许委托 `EpistemicRuntime` 与 surface helper；MCP 层不能直连底层。
- 具体落地形态采用“两层收敛”：先在 `packages/core/src/` 增加少量 facade / helper，再由 `Aura` 实例方法委托出去。
- `Aura` 上新增方法名尽量贴 Rust 原名。
- 过程中用户特别要求确认：`Aura` 当前缺失的一部分 surface 已经在 `EpistemicRuntime` 中实现，尤其是 `belief_instability`、`policy_lifecycle`、`policy pressure`、`contradiction clusters` 等 inspection primitives。

---

## 响应 shape 与 parity 粒度

| Option | Description | Selected |
|--------|-------------|----------|
| 优先对齐 Rust MCP 的外部响应 shape | 尽量复刻 tool 名、参数名、text/JSON 形态 | ✓ |
| 优先对齐语义，不强求 wire shape 完全一致 | 可统一返回 JSON，再在 verifier 里归一化 | |
| 双层：对外尽量贴 Rust，验证时有限归一化 | 允许更宽松的 wire-level 差异 | |

**User's choice:** 优先对齐 Rust MCP 的外部响应 shape
**Notes:** 用户进一步锁定：
- Rust 返回 `Content::text(...)` 时，TS 也必须返回 text，即使内容是 JSON 字符串。
- 正常返回和错误返回都尽量贴 Rust 外部风格。
- 错误必须使用 Effect 提供的 `TaggedError` 建模。
- 缺关键数据/算法时宁可整 tool unsupported，也不返回缩水成功。
- verifier 只允许忽略纯表示层噪音。
- 如不得不做非严格实现，必须保留可检索注释，便于后续统计待办事项。

---

## maintain 与 unsupported contract

| Option | Description | Selected |
|--------|-------------|----------|
| 工具清单冲突时以 `07-SPEC.md` 为准 | 完整 inventory 以 phase spec 为最终边界 | ✓ |
| 工具清单冲突时以 Rust 当前 `mcp.rs` 为准 | 回头修改 SPEC，贴现状 | |
| 只取交集 | 缩小范围，弱化 full coverage | |

**User's choice:** 以 `07-SPEC.md` 为准
**Notes:** 用户随后补充并锁定：
- TS Phase 7 要显式提供 `maintain` tool，即使 Rust 当前 `mcp.rs` 没有独立同名 tool；新增不冲突功能不会破坏对齐目标。
- 标准化 unsupported contract 在 `@aura/core` 定义，使用单独文件承载 `TaggedError`，MCP 层只负责映射。
- 只有在缺少完成 Rust/SPEC 所需的关键数据或关键算法时，才允许 tool 返回 unsupported；不能因为实现麻烦就 unsupported。
- unsupported 必须在代码、测试、最终验证 artifact 三处都显式可见。
- 用户强调：定下的目标要严肃、坚决，不能用 unsupported 稀释完成标准。

---

## E2E parity harness 的比较边界

| Option | Description | Selected |
|--------|-------------|----------|
| 黑盒 MCP server-to-server 对比 | 启动 Rust MCP 与 TS MCP，对比同一组工具调用的外部响应 | ✓ |
| 主要比较 core/library 结果，MCP 只做 smoke test | library parity 替代 server parity | |
| 双轨同权重 | 同时重压 library 和 server 两层 | |

**User's choice:** 黑盒 MCP server-to-server 对比
**Notes:** 用户进一步锁定：
- E2E 用例按工具家族分组：写入、检索、维护/inspection、explainability/governance。
- fixture 以 MCP 专用 fixture 为主，原因是可控性更强，不容易为了复用而妥协。
- 允许家族内顺序累积状态，不强制每个用例隔离新 brain；状态污染本身是发现真实偏差的好时机。
- 比较标准同时包含“每次调用响应比对”与“家族末尾状态/派生读取比对”两层。

---

## the agent's Discretion

- `packages/core/src/` 下 facade / helper 的具体文件名和拆分粒度。
- MCP 专用 fixture 的目录结构、生成方式、以及家族测试顺序。
- 哪些 inspection tool 直接委托 `EpistemicRuntime`，哪些需要新增 core facade 组合层。

## Deferred Ideas

- graph/entity/project 类 Rust public API 不在本 phase 范围内，如需补齐应单独起 phase。
