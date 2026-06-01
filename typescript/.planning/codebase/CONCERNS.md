# Codebase Concerns

**Analysis Date:** 2026-06-01

## 技术债务

### Aura.ts 单文件过大（God Class）

- **问题:** `packages/core/src/Aura.ts` 达到 4825 行，是整个代码库中最庞大的单体文件。包含 `Aura` 核心类的全部方法（open、store、recall、maintain、get、list、move、update、delete、insights、correction_log 等数十个操作），以及大量私有辅助函数（~70 个独立函数）。该文件同时担负核心业务逻辑与 MCP 透传层的职责。
- **文件:** `packages/core/src/Aura.ts`
- **影响:** 单一文件承载了 `@aura/core` 的几乎所有对外能力，导致：
  - 文件级的 merge conflict 风险极高（多人并发修改同一文件）
  - 测试依赖复杂，`packages/core/src/Aura.test.ts` 同样膨胀至 2045 行
  - 难以独立测试某个功能（需要加载整个 Aura 实例）
  - 导入链下游的任何变更都可能触发该文件的重新编译
- **修复方向:** 按领域拆分 —— Recall（recall/recall_structured）、Store（store/store_code/store_decision）、Maintenance（maintain）、Correction（correction_log/correction_review_queue）等拆分为独立模块或类 Mixin，Aura 类变为轻量 facade。

### 大规模低质量类型逃逸（`as any` 泛滥）

- **问题:** 测试代码中存在大量 `as any` 类型断言，尤其是在 `BeliefEngine.test.ts`、`CausalEngine.test.ts`、`PolicyEngine.test.ts`、`Aura.test.ts` 和 `MaintenanceService.test.ts` 中。生产代码中也存在 `as any` 使用（如 `CausalWalk.ts:16`、`GraphWalk.ts:13`、`Crypto.ts:10`）。
- **文件:** `packages/*/src/**/*.test.ts`（~70+ 处 `as any`）、`packages/recall/src/CausalWalk.ts`、`packages/recall/src/GraphWalk.ts`、`packages/codec/src/Crypto.ts`
- **影响:** 类型安全被系统性绕过，Effect-TS 的类型推导优势无法发挥。测试对生产代码的类型约束覆盖率不足。
- **修复方向:** 优先修复生产代码中的 `as any`（~5 处），再逐步清理测试用例，为测试创建正确的类型封装（factory/fixture 模式替代强制转换）。

### `@ts-nocheck` 禁用整个文件类型检查

- **问题:** `packages/code-extraction/src/extraction/tree-sitter.ts` 在文件头部使用 `// @ts-nocheck TODO 解决类型错误`，完全禁用了整个 2731 行文件的 TypeScript 类型检查。这是全局最严重的类型安全缺口。
- **文件:** `packages/code-extraction/src/extraction/tree-sitter.ts`
- **影响:** 2731 行代码无任何类型保障，其中的 bug 无法通过 `tsc --noEmit` 检测到。该文件是整个 code-extraction 包的核心解析器封装。
- **修复方向:** 按函数/模块分批修复类型错误，移除 `@ts-nocheck` 并用精确的 `@ts-expect-error` 替代仍存疑的位置。

### 锁定文件缺失

- **问题:** 仓库中未提交任何包锁定文件（`pnpm-lock.yaml`、`yarn.lock`、`package-lock.json` 均不存在）。根目录的 `package.json` 声明了 workspace 配置。
- **影响:** 不同开发者和 CI 环境可能安装到不同版本的依赖，存在隐式破坏风险。特别值得注意的是 Effect-TS 使用 beta 版本（`4.0.0-beta.68`），无锁定时版本解析可能出现意外行为。
- **修复方向:** 提交 `pnpm-lock.yaml`（项目使用 pnpm workspace）。

### close() 方法未完全实现

- **问题:** `packages/code-extraction/src/index.ts:284-289` 的 `CodeGraph.close()` 方法包含 `// TODO 后续实现` 注释，未调用 `this.unwatch()` 释放文件监听器。
- **文件:** `packages/code-extraction/src/index.ts`
- **影响:** 显式关闭 CodeGraph 实例时资源泄漏，文件监听器继续运行。
- **修复方向:** 实现 `close()` 方法（调起 `unwatch()`），确保正常关闭所有资源。

### rust 参考代码注释维护风险

- **问题:** 整个代码库散布的大量 Rust parity 参考注释（`// Rust reference: ...`、`// NON-PARITY IMPLEMENTATION: ...`）虽然有助于理解映射关系，但这类注释极易在重构后过期。例如 `packages/core/src/Aura.ts` 中的 ~30 处 Rust 引用注释。
- **文件:** `packages/core/src/Aura.ts`、`packages/causal/src/CausalEngine.ts`、`packages/belief/src/BeliefEngine.ts` 等
- **影响:** Rust 端更新 API 后，TS 端的注释可能成为误导性信息。
- **修复方向:** 不需要立即修复，但应在 Phase 8 parity 关闭后系统性地清理。

### zigzag 的 import 组织

- **问题:** `packages/core/src/Aura.ts` 的 import 块跨越 ~466 行（第 1-465 行），混合了类型导入和值导入，且大量 import 来自同一个包但分散在多个 import 语句中。
- **影响:** 增加文件维护难度，导入依赖关系不够清晰。
- **修复方向:** 使用统一导入风格（grouped by package），分离 `import type`。

## 已知 Rust/TS 差异（NON-PARITY）

### 加密功能未接入

- **问题:** `Aura.open_with_password()` 在 `password !== undefined` 时直接返回 `UnsupportedSurfaceError`，明确声明加密管线未实现。
- **文件:** `packages/core/src/Aura.ts:620-641`
- **症状:** 调用 `Aura.open_with_password(brainPath, password)` 会失败。
- **影响:** 无法使用加密存储，与 Rust 版本行为不兼容。
- **修复方向:** 实现基于 `Crypto` Service 的加密 AuraStorage 管线。

### xxh3 哈希对齐状态

- **状态:** 已完成核心维护链路的稳定 ID / fingerprint 对齐。`@aura/utils` 提供纯 TS `xxh3_64`，并被 `BeliefEngine`、`ConceptEngine`、`CausalEngine`、`PolicyEngine`、`EpistemicRuntime`、`NGramIndex` 复用。
- **文件:**
  - `packages/utils/src/Xxh3.ts`
  - `packages/belief/src/BeliefEngine.ts`
  - `packages/concept/src/ConceptEngine.ts`
  - `packages/causal/src/CausalEngine.ts`
  - `packages/policy/src/PolicyEngine.ts`
  - `packages/epistemic-runtime/src/EpistemicRuntime.ts`
- **剩余注意:** `packages/recall/src/SDRInterpreter.ts` 仍直接使用 `xxhash-wasm`，该项单独由 BACKLOG 的 SDRInterpreter gap 跟踪。

### recall 分数差异

- **问题:** MCP parity test 确认 TS 的 recall scoring pipeline 与 Rust 端存在数值偏差，需要在 parity 测试中进行 normalization。
- **文件:** `packages/mcp/src/Parity.test.ts:295-302`
- **影响:** recall 结果的 `score` 字段在 TS 和 Rust 间不完全一致，需要 normalization step。
- **修复方向:** 对齐 TS recall finalizer/reranker 中的 score 计算逻辑与 Rust 端算法。

### Recall 结构化查询未完全实现

- **问题:** `Aura.recall()` 方法注释明确说明返回 `RecallScored` 而非 Rust 的更丰富的 `RecallItem`，structured recall 和 explainability 路径尚未完全实现。
- **文件:** `packages/core/src/Aura.ts:1464-1467`
- **影响:** recall_structured 和 explain_recall 的返回数据不如 Rust 端丰富。
- **修复方向:** 实现 Rust 端 RecallItem 的完整字段映射。

## 性能瓶颈

### 大型 WASM 编译导致的 OOM 风险

- **问题:** tree-sitter grammars 作为大体积 WebAssembly 模块，在 Node >= 22 的 V8 turboshaft 优化编译器下可能导致 per-compilation Zone arena OOM。已在 `wasm-runtime-flags.ts` 中详细记录。Node 25 已完全被 blocking。
- **文件:** `packages/code-extraction/src/extraction/wasm-runtime-flags.ts`
- **影响:** 在 Node 22+/24+ 上解析大型代码库时进程崩溃。Node 25 上完全无法运行。需要 `--liftoff-only` flag。
- **变通方案:** 已在 CLI 中实现通过 re-exec 自身注入 `--liftoff-only` flag 的机制。但 bundled launcher 之外的其他启动路径需要手动处理。
- **修复方向:** 跟踪 V8 修复进展；考虑在 Node 25 上的 alternative WASM parser。

### Aura.ts 中启动时全量加载 cognitive records

- **问题:** `Aura.open()` 路径中调用 `loadCognitiveRecords()` 会读取并反序列化所有 cognitive records 到内存。未分页或惰性加载。
- **文件:** `packages/core/src/Aura.ts`（`loadCognitiveRecords` 调用）、`packages/storage/src/CognitiveStoreFile.ts`
- **影响:** 大量 record 时（>100,000）启动时间和内存占用显著增加。
- **修复方向:** 实现惰性加载、分页、或基于 mmap 的按需读取。

### storage 文件格式未版本化控制

- **问题:** `BrainAuraFile.ts` 和 `Cognitive.ts` 的二进制格式使用硬编码的 magic number 和常量，无显式的向前/向后兼容策略。
- **文件:** `packages/storage/src/BrainAuraFile.ts`、`packages/storage/src/Cognitive.ts`
- **影响:** 格式变更会导致已有 brain 文件不可读，无迁移路径。
- **修复方向:** 实现版本化序列化 + 迁移策略（类似 Rust 端的 AuraStorage versioning）。

## 安全考虑

### 密码派生参数较弱

- **问题:** `Crypto.ts` 中的 argon2id 使用 `iterations: 2` 和 `memorySize: 19456`（~19MB），仅 2 次迭代。对于密钥派生来说，迭代次数偏低。
- **文件:** `packages/codec/src/Crypto.ts:14-16`
- **影响:** 虽然此代码路径（password-based encryption）目前处于未接入状态（`open_with_password` 直接失败），但若未来启用，弱参数可能导致暴力破解抵抗力不足。
- **修复方向:** 在接入加密管线时提高 iterations（建议 >= 3）和 memory（>= 64 MiB）。

### 随机 ID 生成

- **问题:** `store_with_channel` 中使用 `id12()` 生成随机 record ID，注释说明需要确定性 ID。
- **文件:** `packages/core/src/Aura.ts:1157-1160`
- **影响:** 随机 ID 导致跨平台不可移植性，且无法基于内容去重。
- **修复方向:** 实现基于内容哈希的确定性 ID 生成。

## 脆弱区域

### 代码提取包（code-extraction）类型不稳

- **问题:** `tree-sitter.ts` 使用 `@ts-nocheck` 禁用了整个文件的类型检查，且该文件达 2731 行，依赖 WebAssembly grammars、多语言解析器、复杂的节点遍历逻辑。
- **文件:** `packages/code-extraction/src/extraction/tree-sitter.ts`
- **脆弱原因:** 无类型检查 + 高度复杂的异步 WASM 操作 + 多语言支持（TypeScript、Rust、Python 等数十种语言）使得任何修改都可能引入不易察觉的运行时错误。
- **安全修改:** 任何修改应先在类型检查打开的子范围验证，逐步缩小 `@ts-nocheck` 覆盖范围。
- **测试覆盖:** code-extraction 整体缺少独立的 unit test（仓库中 54 个 test 文件主要集中在 core、belief、causal、concept、policy）。

### `Effect.runPromise` 在 MCP runtime 中的使用

- **问题:** `packages/mcp/src/runtime.ts:67` 使用了 `Effect.runPromise`（同步运行 Effect），绕过了 Effect 的依赖注入和错误处理管道。虽然 MCP 层需要 Promise 接口，但 `runPromise` 的使用削弱了 Effect 对错误传播的约束。
- **文件:** `packages/mcp/src/runtime.ts`
- **影响:** 如果未正确处理 Effect 错误，可能导致未捕获的异常。
- **安全修改:** 确保 `runPromise` 调用被正确的 `.catch()` 或 try/catch 包装。

### Cross-package 内存引用（Mutable State）

- **问题:** 各引擎（BeliefEngine、ConceptEngine、CausalEngine、PolicyEngine）的实现在 `packages/*/src/` 中持有可变内部状态（普通 TypeScript 对象），而非通过 Effect Ref 管理。例如 `CausalEngineImpl` 中的 `this.state` 是变异对象的属性。
- **文件:** `packages/causal/src/CausalEngine.ts`、`packages/belief/src/BeliefEngine.ts`、`packages/concept/src/ConceptEngine.ts`、`packages/policy/src/PolicyEngine.ts`
- **影响:** 缺乏 Effect `Ref` 的事务性保证（如 `Ref.modify` 的原子性）。在并发调用相同引擎方法时可能产生 race condition。
- **安全修改:** 仅在 Effect 的 `gen` 块中通过 yield 访问状态，避免跨 Effect 的共享可变引用。

## 测试覆盖缺口

### MCP parity 测试仅覆盖部分工具

- **问题:** `TOOL_INVENTORY` 定义了 22 个工具，其中 `consolidate` 标记为 `unsupported`。MCP parity test 运行 3 个 family（write、retrieval、governance），但并非所有 implemented 工具都被 parity test 覆盖。
- **文件:** `packages/mcp/src/inventory.ts`、`packages/mcp/src/Parity.test.ts`
- **未覆盖:** parity test 的 family 定义未覆盖所有 implemented 工具的全部调用组合。
- **风险:** 某些工具可能在 TS 端正确实现但与 Rust 响应格式存在细微差异。
- **优先级:** 中

### code-extraction 和 storage 包测试不足

- **问题:** `packages/code-extraction`（~50+ 源文件，6399 总行）和 `packages/storage`（13 个源文件）的测试覆盖非常有限。code-extraction 的测试基本只存在于辅助工具类中。
- **文件:** `packages/code-extraction/*`、`packages/storage/*`
- **风险:** 文件格式变更（如 brain.aura 二进制格式）和解析器修改可能导致回归而无法及时发现。
- **优先级:** 中

### 无 E2E 或集成测试

- **问题:** 仓库中 54 个测试文件全部为 unit test 级别，无 E2E 测试验证 Aura 完整生命周期（open → store → recall → maintain → close）。
- **影响:** 完整工作流的回归风险由手动测试覆盖。
- **优先级:** 低（项目早期阶段合理）

## 依赖风险

### Effect-TS beta 版本

- **问题:** `"effect": "4.0.0-beta.68"` 和 `"@effect/vitest": "4.0.0-beta.68"` —— 使用 beta 版本，API 可能在后续版本中不兼容。beta 版本无语义化版本保证。
- **影响:** 升级 effect 版本可能需要进行大量 API 迁移。锁定文件缺失加剧此风险。
- **迁移计划:** 跟踪 effect 4.0 stable 发布后统一升级。

### tree-sitter WASM 生态

- **问题:** 依赖 `"tree-sitter-wasms": "^0.1.11"` 和 `"web-tree-sitter": "0.25.10"`。tree-sitter WASM 生态处于活跃开发中，API 变化频繁。
- **影响:** grammar 包版本与 web-tree-sitter 版本需严格匹配，升级需同步。
- **迁移计划:** 固定版本号而非使用 `^` range。

### @mastra 依赖版本

- **问题:** `@mastra/core: ^0.21.0` 和 `@mastra/mcp: ^0.13.3` —— Mastra 是一个较新的框架，可能处于活跃开发中。
- **影响:** minor 版本升级可能包含 API 变更。
- **迁移计划:** 版本锁定 + 定期评估升级。

## 缺失关键功能

### consolidate 操作未实现

- **问题:** MCP 工具 `consolidate` 被标记为 `unsupported`，在 TS 端没有实现。
- **文件:** `packages/mcp/src/inventory.ts:39`
- **阻塞:** 用户无法通过 TS MCP 服务执行 memory consolidation。
- **优先级:** 低（已有 maintain 替代）

### HPP（Host Process PID）Watchdog 仅在 code-extraction CLI 中实现

- **问题:** WASM runtime flag relaunch 机制引入了中间进程，需要通过 `CODEGRAPH_HOST_PPID` 环境变量传递原始 host PID 以实现 PPID watchdog。但这仅适用于 code-extraction CLI 场景。
- **文件:** `packages/code-extraction/src/extraction/wasm-runtime-flags.ts:53-60`
- **影响:** MCP server 在 relaunch 后无法检测 host 进程死亡，可能导致僵尸进程。
- **优先级:** 低

---

*Concerns audit: 2026-06-01*
