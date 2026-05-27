<!-- generated-by: gsd-doc-writer -->

---

title: 配置
description: Aura monorepo 项目配置参考

---

## 包管理器

项目使用 **Bun** 作为主要包管理器。锁文件为 `bun.lock`。

根 `package.json` 声明了 `"workspaces": ["packages/*"]` 字段。项目根目录还有一个可选的 `pnpm-workspace.yaml`，但 Bun 是当前提交的主要包管理器（以 tracked 的 `bun.lock` 为准）。

### 安装依赖

```bash
bun install
```

在根目录运行 `bun install` 会一次性安装所有工作区包，无需逐包安装。

## TypeScript 配置

所有 TypeScript 设置位于根 `tsconfig.json` 中。没有逐包的 `tsconfig.json` 覆盖。

### 编译选项

| 选项 | 值 | 用途 |
|---|---|---|
| `target` | `ES2022` | 生成现代 JS；Bun、Node >= 18 支持 |
| `module` | `ESNext` | 生成 ES 模块语法 |
| `moduleResolution` | `Bundler` | 以 Bun/打包器相同方式解析模块 |
| `strict` | `true` | 启用所有严格类型检查标志 |
| `noUncheckedIndexedAccess` | `true` | 将 `T[key]` 视为 `T[key] \| undefined` |
| `skipLibCheck` | `true` | 跳过 `.d.ts` 验证以加速类型检查 |
| `types` | `["node", "vitest/globals"]` | 包含 Node 和 Vitest 全局类型声明 |
| `baseUrl` | `"."` | 路径映射解析的根目录 |

### 路径别名

所有包在 `@aura/*` 作用域下映射，每个包的入口指向 `packages/<name>/src/index.ts`：

| 别名 | 映射到 |
|---|---|
| `@aura/codec` | `packages/codec/src/index.ts` |
| `@aura/storage` | `packages/storage/src/index.ts` |
| `@aura/core` | `packages/core/src/index.ts` |
| `@aura/contract` | `packages/contract/src/index.ts` |
| `@aura/utils` | `packages/utils/src/index.ts` |
| `@aura/platform-node` | `packages/platform-node/src/index.ts` |
| `@aura/indexing` | `packages/indexing/src/index.ts` |
| `@aura/recall` | `packages/recall/src/index.ts` |
| `@aura/belief` | `packages/belief/src/index.ts` |
| `@aura/concept` | `packages/concept/src/index.ts` |
| `@aura/causal` | `packages/causal/src/index.ts` |
| `@aura/policy` | `packages/policy/src/index.ts` |
| `@aura/epistemic-runtime` | `packages/epistemic-runtime/src/index.ts` |

每个包也配置了通配子路径别名（`@aura/<name>/*`），映射到对应的 `src/*` 子目录。

### 包含的文件

编译器包含：

- `./*.ts`（根级别的 TypeScript 文件）
- `packages/**/*.ts`（所有工作区包）
- `vitest.config.ts`（测试运行配置）

### 类型检查

```bash
bun run typecheck
```

这运行 `tsc -p tsconfig.json --noEmit`，执行完整的类型检查但不生成输出文件。

## 测试运行配置

测试使用 **Vitest** 运行（配置在项目根目录的 `vitest.config.ts` 中）。

### Vitest 设置

| 设置 | 值 | 用途 |
|---|---|---|
| `test.globals` | `true` | 无需导入即可全局使用 `describe`、`it`、`expect` |
| `test.environment` | `"node"` | 在 Node.js 环境中运行测试（无 DOM） |
| `resolve.alias` | （见下方） | 与 `tsconfig.json` 的 `@aura/*` 路径别名保持一致 |

### 解析别名

Vitest 配置为核心包和共享包定义了路径别名，使 `@aura/<name>` 导入在测试运行期间正确解析：

- `@aura/codec`、`@aura/storage`、`@aura/core`、`@aura/contract`、`@aura/utils`、`@aura/platform-node`、`@aura/indexing`、`@aura/recall`

其他包（belief、concept、causal、policy、epistemic-runtime）仅在 `tsconfig.json` 中有别名，Vitest 配置中未重复。

### 测试命令

| 命令 | 描述 |
|---|---|
| `bun run test` | 单次运行完整测试套件（`vitest run --passWithNoTests`） |
| `bun run test:watch` | 监听模式下运行测试（`vitest --passWithNoTests`） |

`--passWithNoTests` 标志确保即使未找到测试文件，套件也能成功退出，这对测试覆盖不均衡的 monorepo 很重要。

### 测试全局变量

因为 `test.globals` 已启用且 TypeScript `types` 数组中包含 `vitest/globals`，测试文件可以直接使用 `describe`、`it`、`expect` 等 Vitest 全局变量，无需显式导入。

`@effect/vitest` 工具作为依赖可用，用于测试基于 Effect 的代码；在测试 Effect 服务和层的文件中按需导入。

## Monorepo 工作区设置

### 工作区结构

根 `package.json` 声明了单个工作区 glob：

```
packages/*
```

匹配以下包：

| 包目录 | 作用域名称 | 描述 |
|---|---|---|
| `packages/belief` | `@aura/belief` | 信念推理模块 |
| `packages/causal` | `@aura/causal` | 因果推理模块 |
| `packages/codec` | `@aura/codec` | 编解码原语 |
| `packages/code-extraction` | `@aura/code-extraction` | 源代码解析和提取 |
| `packages/concept` | `@aura/concept` | 概念建模 |
| `packages/contract` | `@aura/contract` | 类型合约和 Schema |
| `packages/core` | `@aura/core` | 核心抽象 |
| `packages/epistemic-runtime` | `@aura/epistemic-runtime` | 认知运行时引擎 |
| `packages/indexing` | `@aura/indexing` | 数据索引工具 |
| `packages/platform-node` | `@aura/platform-node` | Node.js 平台绑定 |
| `packages/policy` | `@aura/policy` | 策略评估 |
| `packages/recall` | `@aura/recall` | 召回/记忆模块 |
| `packages/storage` | `@aura/storage` | 存储层 |
| `packages/utils` | `@aura/utils` | 共享工具函数 |

### 包约定

所有工作区包：

- **私有**（每个 `package.json` 中 `"private": true`）—— 不发布到 npm。
- **ESM**（每个 `package.json` 中 `"type": "module"`）。
- **入口导出** 使用 `"exports": { ".": "./src/index.ts" }`，直接指向 TypeScript 源码。Bun（和 Vitest）原生解析 `.ts` 文件。

### 备用工作区配置

项目根目录存在一个 `pnpm-workspace.yaml` 文件，包含相同的 `packages: ["packages/*"]` glob 和 `better-sqlite3` 的构建依赖覆盖。此文件允许项目同时使用 pnpm，但 Bun 是主要包管理器。

## 环境变量

项目不附带 `.env.example` 文件。环境变量主要由 `@aura/code-extraction` 包用于控制调试输出和运行时行为。

### 运行时可用的变量

| 变量 | 必需 | 默认值 | 描述 |
|---|---|---|---|
| `CODEGRAPH_DEBUG` | 可选 | （未设置） | 设置为任意真值后，在 code-extraction 包的默认日志器中启用 debug 级别日志输出到 `console.debug`。 |
| `CODEGRAPH_RESOLVER_CACHE_SIZE` | 可选 | `5000` | 设置 `@aura/code-extraction` 中导入解析器的每缓存条目限制。必须为正整数。小于 1 的值会被忽略并使用默认值。 |
| `CODEGRAPH_NO_RELAUNCH` | 可选 | （未设置） | 设置为任意真值后，阻止 `@aura/code-extraction` 中的 WASM 运行时标志重新启动机制。当 Node.js 进程已具有所需的 V8 标志时有用。 |
| `CODEGRAPH_WASM_RELAUNCHED` | 内部 | （自动设置） | WASM 重启过程中设置的内部保护标志。不要手动设置。 |
| `CODEGRAPH_HOST_PPID` | 内部 | （自动设置） | WASM 重启过程中保存父进程 PID 的内部变量。不要手动设置。 |

### 无启动关键变量

所有环境变量都不是项目启动或通过类型检查所必需的。所有变量仅控制 `@aura/code-extraction` 包中的可选行为。

## 构建配置

项目不定义构建步骤。每个工作区包直接从 `src/index.ts` 导出 TypeScript 源码，Bun 在运行时原生解析 `.ts` 文件，无需单独的编译阶段。

根 `package.json` 脚本中不包含 `build` 命令。类型检查（`bun run typecheck`）是最接近构建验证步骤的等效操作。

## 代码检查与格式化

项目根目录不存在代码检查器或格式化器配置文件（ESLint、Prettier、Biome、`.editorconfig`）。代码风格由 TypeScript 编译器的 `strict` 模式强制执行。

## CI/CD

仓库中未找到 CI/CD 工作流配置。目前没有 `.github/workflows/` 目录。

<!-- VERIFY: CI/CD 管道状态 -- 仓库中未找到工作流文件，但外部 CI 可能在仓库外配置 -->
