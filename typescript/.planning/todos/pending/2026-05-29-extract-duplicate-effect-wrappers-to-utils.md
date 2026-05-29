---
created: 2026-05-29T18:00:00Z
title: 提取重复编写的用Effect包装外部库(如hash)的函数/方法到utils包
area: tooling
files:
  - packages/belief/src/BeliefEngine.ts
  - packages/concept/src/ConceptEngine.ts
  - packages/causal/src/CausalEngine.ts
  - packages/policy/src/PolicyEngine.ts
  - packages/utils/src/
---

## Problem

多个 engine 包中存在重复的工具函数/模式，应该提取到 `@aura/utils` 统一维护：

1. **UnionFind (Disjoint Set)** — `BeliefEngine.ts` 和 `ConceptEngine.ts` 中各复制了 4+2 份 ~20行的 UnionFind 实现（find with path compression + union by root），共 ~120 行重复代码
2. **Polarity Signal Counting** — `CausalEngine.ts:effectPolaritySignalCounts` 和 `PolicyEngine.ts:polaritySignalCounts` 实现了几乎相同的逻辑，仅 keyword list 不同（一个包含 "noise"/"review"，另一个不含）
3. **xxhash Hasher Initialization** — `CausalEngine.ts` 中有模块级 lazy initialization 的 hash 工具，如果其他 engine 也需要 xxhash，应该统一
4. **`toMutable<T>()` helper** — 目前在 `MaintenanceService.ts` 中定义，去掉 readonly 修饰符，其他文件也可能需要

## Solution

1. 在各 engine 包中 audit 所有通用工具函数/class（hash、UnionFind、signal counting、type helpers 等）
2. 评估是否需要迁移到 `packages/utils/src/`（需要确认 utils 包是否对 engine 包可见）
3. 如果 keyword lists 有语义差异，提取为参数化的共享函数而非硬编码两个列表
4. 确保迁移后所有测试通过，typecheck 通过
