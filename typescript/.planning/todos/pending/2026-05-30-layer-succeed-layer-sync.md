---
created: "2026-05-30T09:03:01.018Z"
title: 顶级模块 Layer.succeed 反模式 — 改用 Layer.sync / Layer.effect
area: core
files:
  - packages/core/src/Aura.ts
  - packages/core/src/MaintenanceService.ts
---

## Problem

在顶级模块作用域使用 `Layer.succeed(ServiceTag, instance)` 会导致服务实例在模块加载时立即创建，而非按需初始化。这使得：

1. 服务无法独立复用（实例已绑定到 layer）
2. 测试中无法替换实例
3. 模块加载顺序敏感
4. 违反 Effect 的 lazy DI 原则

## Solution

1. 审计所有 `Layer.succeed(X, x)` 顶级声明
2. 替换为 `Layer.sync(X, () => x)` (同步) 或 `Layer.effect(X, Effect.succeed(x))` (含副作用)
3. 确保每个服务可通过 `Layer.fresh` 获得独立实例
