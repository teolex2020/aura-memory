---
created: "2026-05-29T05:43:09.329Z"
title: 移除 MaintenanceService 僵尸 TODO 类型占位
area: core
files:
  - packages/core/src/MaintenanceService.ts:40-56
---

## Problem

`MaintenanceService.ts:40-55` 有 5 个 placeholder 类型全部声明为 `unknown`：

```ts
type SDRInterpreter = unknown   // TODO: import from @aura/recall or @aura/core
type TagTaxonomy = unknown      // TODO: import from @aura/concept or @aura/index
type NGramIndex = unknown       // TODO: import from @aura/index
type CognitiveStore = unknown   // TODO: import from @aura/storage
type BackgroundBrain = unknown  // TODO: import from @aura/core
```

Phase 06.3 的研究遗漏了逐项核实这 5 个依赖是否已实现，导致僵尸 TODO 残留。实际核实结果：

| Placeholder | 状态 | 实际位置 |
|-------------|------|---------|
| `SDRInterpreter` | **已实现** | `packages/recall/src/SDRInterpreter.ts` — `class SDRInterpreter` |
| `CognitiveStore` | **已实现** | `packages/storage/src/CognitiveStoreFile.ts` — `class CognitiveStoreFile` |
| `TagTaxonomy` | **未实现** | 全仓库仅 MaintenanceService.ts 引用 |
| `NGramIndex` | **未实现** | 无独立 class（recall Pipeline.ts 有嵌入的 NGram 逻辑） |
| `BackgroundBrain` | **未实现** | 仅 `Aura.ts` 中作为 `undefined as never` 占位 |

## Solution

1. 替换 `SDRInterpreter` 的 `unknown` 为 `import type { SDRInterpreter } from "@aura/recall"`
2. 替换 `CognitiveStore` 的 `unknown` 为 `import type { CognitiveStoreFile as CognitiveStore } from "@aura/storage"`
3. 剩余 3 个 (TagTaxonomy / NGramIndex / BackgroundBrain) 保留 TODO 但标注为"等待 Rust 侧对应 TS 实现"
