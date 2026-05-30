---
created: "2026-05-30T08:55:04.841Z"
title: 将contract包的serviceOption提取到utils包并改进API
area: tooling
files:
  - packages/contract/src/ (serviceOption export)
  - packages/utils/ (目标包)
---

## Problem

`serviceOption` 当前从 `@aura/contract` 导出，但它是通用 Effect 工具函数，不属于 contract 层。API 设计上可以更简洁易用，减少样板代码。

## Solution

1. 将 `serviceOption` 从 contract 包迁移到 `@aura/utils` 包
2. 改进 API 使其更易于使用（减少类型参数、更友好的错误提示等）
3. 更新所有调用点（引擎实现、MaintenanceService 等）的 import 路径
4. 如 contract 包仍有对外的 re-export 需求，保留一个 `@deprecated` 的 re-export 作为过渡
