# STACK.md — Technology Stack

## Runtime & Package Manager
- **Runtime**: Bun (preferred) / Node.js compatible
- **Package Manager**: Bun (uses `bun.lock`)
- **Module System**: ESM (`"type": "module"` in all packages)

## Language & Compiler
- **Language**: TypeScript 5.6+
- **Target**: ES2022
- **Module Resolution**: Bundler
- **Strictness**: Maximum strictness enabled
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`

## Core Framework
- **Effect-TS** (`effect@4.0.0-beta.68`) — Functional effect system for dependency injection, error handling, concurrency
- **@effect/vitest** (`4.0.0-beta.68`) — Effect-aware Vitest integration

## Testing
- **Vitest** 2.0+ with globals enabled
- **Environment**: Node
- Test alias resolution mirroring TypeScript path mapping

## Binary / Crypto Libraries
- **@noble/ciphers** (^0.5.3) — Pure-JS cryptographic ciphers
- **@noble/hashes** (^1.5.0) — Pure-JS cryptographic hashes
- **argon2-wasm-edge** (^1.0.23) — Argon2 via WASM
- **roaring-wasm** (^1.1.0) — Roaring bitmaps via WASM
- **xxhash-wasm** (^1.1.0) — xxHash via WASM

## Workspace Structure
- Monorepo via native Bun workspaces (`packages/*`)
- 14 internal packages under `@aura/*` namespace
- No external bundler (TypeScript directly + Bun runtime)

## Notable Absences
- No linter configured (no ESLint, Prettier, Biome, or dprint found)
- No CI/CD configuration in repository root
- No HTTP server framework (project scope excludes HTTP server per AGENTS.md)
