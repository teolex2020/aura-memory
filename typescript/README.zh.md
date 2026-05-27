<!-- generated-by: gsd-doc-writer -->

# AuraSDK (TypeScript)

一个实现 Aura 认知架构的 TypeScript monorepo —— 为 AI agent 提供持久记忆、可解释性和受控适应的本地知识图谱运行时，从 Rust 核心重写而来，用于学习、研究和跨平台对等。

基于 [Effect-TS](https://effect.website/) 构建，实现分层依赖注入和函数式错误处理。目标运行环境为 Bun 和 Node.js。

## 核心特性

- **双层记忆**：认知记忆（临时）+ 核心记忆（永久），支持衰减、提升和维护
- **多信号召回管道**：标签倒排索引、SDR Tanimoto 相似度、n-gram 匹配、RRF 融合、图/因果遍历扩展、信任/新近度评分
- **认知运行时**：Belief -> Concept -> Causal -> Policy 链条，用于有界认知重排序
- **磁盘格式与 Rust 对等**：TypeScript 可读写与 Rust 相同的 `brain.aura` 和 `brain.cog` 文件格式
- **Effect-TS 依赖注入**：纯核心逻辑通过 Context Tags 和 Layer 组合与平台关注点分离 —— `@aura/platform-node` 以外禁止直接 `node:*` 导入
- **读模型优先设计**：召回管道在读路径上操作只读视图，不依赖写路径
- **WASM 驱动原语**：通过 WASM 使用 Roaring bitmaps、xxHash、Argon2id

## 包概览

| 包 | 职责 |
|---------|------|
| `@aura/contract` | 领域类型、枚举（`Level`、`Record`、`SourceType`）、上下文标签（`FileRead`、`FileWrite`、`Clock`、`Crypto`）、错误类型 |
| `@aura/utils` | 纯工具函数：字节/十六进制编解码、CRC32、ID 生成（`id12`）、时间辅助 |
| `@aura/codec` | 二进制序列化原语（bincode 风格）、加解密操作 |
| `@aura/indexing` | 基于 Roaring bitmap 存储的倒排索引，用于标签和 SDR 查找 |
| `@aura/storage` | 持久化层：`brain.aura` 解析、`brain.cog` 快照追加日志、召回视图组装 |
| `@aura/recall` | 召回管道：信号收集器 -> RRF 融合 -> 图/因果扩展 -> 信任/新近度评分 |
| `@aura/core` | 公开外观：`Aura.open()`、`recallScored()`、`recallRecords()`、`DefaultLayer` 组装 |
| `@aura/belief` | 信念引擎和存储，用于有界信念重排序 |
| `@aura/concept` | 概念引擎和存储，用于概念标注和涌现 |
| `@aura/causal` | 因果引擎和存储，用于因果链跟踪 |
| `@aura/policy` | 策略引擎和存储，用于策略提示（Prefer/Avoid/Warn） |
| `@aura/epistemic-runtime` | Belief->Concept->Causal->Policy 维护链的编排 |
| `@aura/platform-node` | **唯一可导入 `node:*` 的层** —— 提供 `FileRead`、`FileWrite`、`Clock`、`Crypto` 的实际实现 |
| `@aura/code-extraction` | 基于 Tree-sitter 的 AST 代码图谱提取，用于死代码检测和符号索引 |

## 快速开始

### 前置条件

- **Bun**（推荐）或 **Node.js** >= 22
- **TypeScript** 5.6+

### 安装

```bash
# 克隆仓库
git clone https://github.com/yuyi919/AuraSDK.git
cd AuraSDK/typescript

# 安装依赖
bun install
```

### 验证构建

```bash
# 对整个工作区进行类型检查
bun run typecheck

# 运行测试套件
bun run test
```

### 最小使用示例

```typescript
import { Aura, DefaultLayer } from "@aura/core";
import { FileRead, FileWrite, Clock, Crypto } from "@aura/contract";
import { NodeFileRead, NodeFileWrite, NodeClock, NodeCrypto } from "@aura/platform-node";
import { Effect, Layer } from "effect";

// 组装平台层（唯一可导入 node:* 的层）
const platformLive = Layer.mergeAll(
  NodeFileRead.Live,
  NodeFileWrite.Live,
  NodeClock.Live,
  NodeCrypto.Live,
);

// 与 Aura 默认认知层组合并运行
const program = Effect.gen(function* () {
  const aura = yield* Aura.open("./my_brain");

  // 存储一条记录
  const record = yield* aura.store("用户偏好深色模式");
  console.log("已存储:", record.id);

  // 召回相关记录
  const results = yield* aura.recall_structured("用户偏好", { top_k: 5 });
  console.log("已召回:", results.length, "条记录");

  return results;
});

const mainLayer = platformLive.pipe(
  Layer.provideMerge(DefaultLayer("./my_brain")),
);

Effect.runPromise(Effect.provide(program, mainLayer));
```

## 项目结构

```
typescript/
├── package.json           # 工作区根配置、脚本
├── tsconfig.json          # TypeScript 配置（含路径别名）
├── vitest.config.ts       # 测试配置
├── bun.lock               # Bun 锁文件
├── packages/
│   ├── contract/          # 领域类型和上下文标签
│   ├── utils/             # 纯工具函数
│   ├── codec/             # 二进制 / 加密原语
│   ├── indexing/          # 倒排索引和 Roaring bitmaps
│   ├── storage/           # 持久化和读模型
│   ├── recall/            # 召回管道算法
│   ├── core/              # Aura 外观和公开 API
│   ├── belief/            # 信念引擎
│   ├── concept/           # 概念引擎
│   ├── causal/            # 因果引擎
│   ├── policy/            # 策略引擎
│   ├── epistemic-runtime/ # 维护链编排
│   ├── platform-node/     # Node.js 平台实现
│   └── code-extraction/   # Tree-sitter 代码图谱提取
└── test/
    └── fixtures/          # 共享测试数据
```

## 脚本

| 命令 | 描述 |
|---------|-------------|
| `bun run test` | 通过 Vitest 运行所有测试 |
| `bun run test:watch` | 监听模式运行测试 |
| `bun run typecheck` | 使用 `tsc --noEmit` 对整个工作区进行类型检查 |

## 架构要点

- **分层 DI**：服务在 `@aura/contract` 中定义为 `Context.Tag`，实际实现在 `@aura/platform-node` 中。核心逻辑绝不直接导入 `node:*`。
- **召回管道**：`Query -> SDRInterpreter -> 信号收集器 -> RRF 融合 -> 图/因果遍历 -> 信任/新近度 -> 评分结果`
- **维护链**：`Record -> Belief -> Concept -> Causal -> Policy -> EpistemicRuntime/EpistemicTrace`
- **错误处理**：带标签的错误，在 Effect `E` 通道中有显式类型；缺陷（`Effect.die`）用于未实现的功能

## 贡献

这是一个面向 AuraSDK 认知架构的研究/学习项目。TypeScript monorepo 的重点在于与 Rust 核心的磁盘格式对等和跨平台认知运行时能力。

## 许可证

MIT。详见[父仓库 LICENSE](https://github.com/yuyi919/AuraSDK/blob/main/LICENSE)。

该项目对核心架构概念已申请专利（US 63/969,703）—— 有关完整的专利和商业许可信息，请参见父仓库。
