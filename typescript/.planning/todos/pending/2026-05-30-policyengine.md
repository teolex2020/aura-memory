---
created: "2026-05-30T08:15:30.676Z"
title: 重构PolicyEngine — 剔除不必要的遗留实现
area: policy
files:
  - packages/policy/src/Surface.ts:46-114
  - packages/concept/src/Surface.ts (possibly same pattern)
---

## Problem

`packages/policy/src/Surface.ts` 中存在废弃但仍在使用的类型和适配器：

1. **`PolicyEngine` 接口（line 79-85）** — 标记 `@deprecated` 的本地扁平容器，JSDoc 说 "Use PolicyEngine.Interface from @aura/contract directly"，但 `computeSurfaceHints` 和 `selectTopHints` 仍然以它为参数类型
2. **`policyEngineFromState` 适配器（line 114）** — 未被 `index.ts` 导出，无外部调用者，仅服务于废弃类型转换

设计扭曲：`PolicyEngine.Interface → stats() → PolicyEngineState → policyEngineFromState() → 废弃PolicyEngine → surface函数`，中间两层是多余的。

## Solution

1. 重写 `computeSurfaceHints` / `selectTopHints` 直接接受 `PolicyEngineState`
2. 删除废弃的 `PolicyEngine` 接口和 `policyEngineFromState` 适配器（无调用者）
3. 检查 `packages/concept/src/Surface.ts` 是否存在相同模式，一并清理
