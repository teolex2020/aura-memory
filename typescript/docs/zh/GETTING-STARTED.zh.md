<!-- generated-by: gsd-doc-writer -->

# 快速入门

本指南带你完成 AuraSDK TypeScript monorepo 的环境搭建，并使用公开的 `Aura` 外观运行第一个知识图谱操作。

## 前置条件

- **Bun**（推荐）—— 从 [bun.sh](https://bun.sh) 安装，或
- **Node.js** >= 22（已在 `@types/node` v22 上测试）
- **TypeScript** 5.6+

项目可选依赖 WASM 包用于核心原语：

| WASM 包 | 用途 |
|--------------|---------|
| `roaring-wasm` | 倒排索引的 Roaring bitmap 操作 |
| `xxhash-wasm` | 高速指纹哈希 |
| `argon2-wasm-edge` | 加密操作的内存硬密钥派生 |

这些包随依赖树一起提供，不需要单独的 WASM 运行时。

## 安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/yuyi919/AuraSDK.git
   cd AuraSDK/typescript
   ```

2. 安装依赖：

   ```bash
   bun install
   ```

   工作区根由 Bun 管理。`packages/` 下的所有 14 个包共享一个 `bun.lock`。

## 项目结构概览

```
typescript/
├── package.json           # 工作区根、脚本
├── tsconfig.json          # TypeScript 配置（含 @aura/* 路径别名）
├── vitest.config.ts       # 测试配置
├── bun.lock               # Bun 锁文件
├── packages/
│   ├── contract/          # 领域类型、枚举、上下文标签、错误
│   ├── utils/             # 纯工具函数（ID、十六进制、CRC32）
│   ├── codec/             # 二进制序列化和加密原语
│   ├── indexing/          # 带 Roaring bitmap 存储的倒排索引
│   ├── storage/           # 持久化层（brain.aura、brain.cog）
│   ├── recall/            # 召回管道（信号、RRF 融合、评分）
│   ├── core/              # 公开外观：Aura、DefaultLayer
│   ├── belief/            # 信念引擎和存储
│   ├── concept/           # 概念引擎和存储
│   ├── causal/            # 因果引擎和存储
│   ├── policy/            # 策略引擎和存储
│   ├── epistemic-runtime/ # Belief -> Concept -> Causal -> Policy 链
│   ├── platform-node/     # Node.js 平台实现（核心中无 node:* 导入）
│   └── code-extraction/   # 基于 Tree-sitter 的代码图谱提取
└── test/
    └── fixtures/          # 共享测试用的 brain 镜像
```

架构遵循 **Effect-TS 分层依赖注入**模式：领域服务在 `@aura/contract` 中定义为 `Context.Tag`，核心逻辑绝不直接导入 `node:*`，实际实现仅存在于 `@aura/platform-node` 中。

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 初步操作

验证工作区编译和测试通过：

### 对整个工作区进行类型检查

```bash
bun run typecheck
```

运行 `tsc -p tsconfig.json --noEmit` 对所有 14 个包进行类型检查。这确认 TypeScript 编译正确性而不生成输出文件。

### 运行测试套件

```bash
bun run test
```

使用 Vitest 运行整个工作区的所有测试文件。测试使用 `@effect/vitest` 进行 Effect-TS 集成，在临时目录中运行，不会在两次运行之间保留状态。

### 监听模式运行测试（开发循环）

```bash
bun run test:watch
```

文件变更时重新运行受影响的测试，开发期间使用。

### 对单个包运行测试

```bash
bun vitest run packages/core
```

将测试执行范围限定到特定包目录。

## 最小工作示例

以下示例打开一个 Aura brain，存储一条记录并召回它。它展示了项目中使用的标准 Effect-TS Layer 组合模式：

```typescript
import { Aura, DefaultLayer } from "@aura/core";
import {
  NodeFileReadLive,
  NodeFileWriteLive,
  NodeClockLive,
  NodeCryptoLive,
} from "@aura/platform-node";
import { Effect, Layer } from "effect";

// 第 1 步：组装平台层。
// 这是唯一可导入 node:* API 的层。
const platformLive = Layer.mergeAll(
  NodeFileReadLive,
  NodeFileWriteLive,
  NodeClockLive,
  NodeCryptoLive,
);

// 第 2 步：使用 Effect.gen 定义应用逻辑。
const program = Effect.gen(function* () {
  // 在给定路径打开一个 brain。
  // 如果 brain 不存在，它将在第一次 store 时创建。
  const aura = yield* Aura.open("./my_brain");

  // 存储一条纯文本记录。
  const record = yield* aura.store("用户偏好深色模式");
  console.log("已存储:", record.id);

  // 存储一条带标签和选项的记录。
  const tagged = yield* aura.store("会议记录：Q1 回顾", {
    tags: ["会议", "回顾", "Q1"],
    level: "Important",
  });
  console.log("已存储带标签:", tagged.id);

  // 召回匹配查询的记录。
  const results = yield* aura.recall_structured("用户偏好", {
    top_k: 5,
  });
  console.log("已召回:", results.length, "条记录");

  return results;
});

// 第 3 步：将平台层与 Aura 认知层组合。
const mainLayer = platformLive.pipe(
  Layer.provideMerge(DefaultLayer("./my_brain")),
);

// 第 4 步：运行程序。
Effect.runPromise(Effect.provide(program, mainLayer));
```

**此示例中的关键概念：**

- **`Aura.open(path)`** —— 打开 brain 目录。读取 `brain.aura` 获取记录索引并验证持久化清单。
- **`aura.store(content, options?)`** —— 将记录写入追加式认知日志（`brain.cog`），可选标签、级别、命名空间和元数据。
- **`aura.recall_structured(query, options?)`** —— 运行多信号召回管道（标签索引、SDR 相似度、n-gram 匹配、RRF 融合、图扩展）并返回已评分的完整记录。
- **Layer 组合** —— `platformLive` 层（文件 I/O、时钟、加密）与 `DefaultLayer`（信念/概念/因果/策略引擎）合并。核心逻辑保持纯函数；平台细节被注入。

关于可配置选项（brain 路径、召回管道参数、存储设置）的详细信息，见 [CONFIGURATION.md](./CONFIGURATION.md)。

## 常见搭建问题

### Bun 或 Node.js 版本错误

项目要求 **Node.js >= 22**。如果看到有关缺失 API（如 `ReadableStream`、`fetch` 或更新的 `node:fs` 行为）的错误，请检查运行时版本：

```bash
node --version  # 应输出版本 v22.x.x 或更高
bun --version   # 应为 1.x 或更高
```

如果使用 `nvm`，在安装依赖前运行 `nvm install 22 && nvm use 22`。

### WASM 构建失败

如果看到与 `roaring-wasm`、`xxhash-wasm` 或 `argon2-wasm-edge` 相关的错误，请确保你的平台支持 WebAssembly。WASM 包以预编译二进制形式发布 —— 标准的 Bun 或 Node.js 22+ 安装应开箱支持 WASM。

### IDE 中的路径别名解析错误

工作区使用 TypeScript 路径别名（如 `@aura/core` 映射到 `packages/core/src/index.ts`）。如果你的 IDE（VS Code、IntelliJ）报告"Cannot find module"错误：

1. 确保工作区根 `tsconfig.json` 是活动的 TypeScript 项目（VS Code：将 `typescript/` 文件夹作为工作区根打开，而非子包）。
2. 运行 `tsc -p tsconfig.json --noEmit` 以验证别名在命令行中正确解析。

### 打开新 brain 时缺少 `temporal.bin`

`Aura.open()` 期望一个包含 `temporal.bin` 文件的有效 brain 目录。如果你正在创建新 brain 进行实验，请复制最小 fixture：

```bash
cp -r test/fixtures/minimal_brain ./my_brain
```

或者，以编程方式使用 `BrainAuraFile.open()` 和 `BrainAuraFile.append()` 来初始化新 brain（模式见 `packages/core/src/Aura.test.ts`）。

## 下一步

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** —— 系统设计、数据流和核心抽象。
- **[CONFIGURATION.md](./CONFIGURATION.md)** —— 环境变量、brain 路径和召回管道调优。
- **包 README** 在 `packages/*/` 下查看逐包 API 详情。
- **测试文件** 在 `packages/core/src/*.test.ts` 中查看公开 API 的可执行使用示例。
