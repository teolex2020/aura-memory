# CONVENTIONS.md — Coding Standards & Practices

## Language & Style

- **TypeScript strict mode** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **ESM only** — no CommonJS
- **No linter/formatter** currently configured; consistency maintained by convention

## Effect-TS Patterns

### Dependency Injection
```typescript
// Service definition (in contract)
export class FileRead extends Context.Tag("FileRead")<FileRead, { readFile(p): Effect<Uint8Array, FileReadError> }>() {}

// Usage
const fs = yield* Effect.service(FileRead)

// Provision
Effect.provide(NodeFileReadLive)
```

### Error Handling
- Normal errors: `Effect.fail(new FileReadError({ path, cause }))`
- Defects (non-main-flow): `Effect.die(new UnimplementedError({ feature: "x" }))`
- TaggedError style: `Data.TaggedError("TagName")<{ readonly field: Type }>`
- **Never** use `unknown`/`any` in `Effect.Effect<_, E, _>` error channels

### Optional Services
```typescript
const maybeReranker = yield* Effect.serviceOption(BoundedReranker)
if (Option.isSome(maybeReranker)) {
  // run rerank
}
```

## Rust Parity Conventions

### Enum Strategy
- Rust enums → TypeScript **string enums** (not union types)
- Example: `export enum Level { Working = "Working", ... }`
- Runtime values required for cross-package testing
- Validation before casting: `Object.values(Level).includes(x)`

### Comment Standards
- **Rust comments preserved** and translated to Chinese where possible
- JSDoc style: `/** ... */` for LSP extraction
- Difference markers (globally searchable):
  - `SIMPLE IMPLEMENTATION:` — simplified approach + reason + Rust reference
  - `NON-PARITY IMPLEMENTATION:` — intentional divergence + reason
  - `UNIMPLEMENTED:` — placeholder + reason + Rust reference
  - `TODO:` — pending work

### File Organization
- Enum/type/record/struct validation → `@aura/contract` or `@aura/utils`
- **No new packages** — reuse existing 14 packages
- `.cog` JSON snapshot parsing → shared helpers (no per-store duplication)

## Naming Conventions

| Construct | Pattern | Example |
|-----------|---------|---------|
| Types / Interfaces | PascalCase | `RecallView`, `StoreOptions` |
| Effect services | PascalCase noun | `FileRead`, `Clock` |
| Live layers | PascalCase + Live | `NodeFileReadLive`, `RecallViewLive` |
| Tagged errors | PascalCase + Error | `FileReadError`, `JsonParseError` |
| Functions | camelCase | `recallScored`, `computeEffectiveTrust` |
| Constants / enums | PascalCase | `Level`, `DEFAULT_NAMESPACE` |
| Type-only imports | `type` keyword explicit | `import type { RecallView }` |

## Time Handling
- **Always** use `nowSecs()` from `@aura/utils/Time` instead of `Date.now() / 1000`
- Ensures consistent seconds-level timestamp behavior across codebase

## Testing Conventions
- Co-located tests: `Feature.test.ts` beside `Feature.ts`
- Parity tests spawn Rust via `spawnSync("cargo", ["run", "--bin", ...])`
- Use `@effect/vitest` for Effect-native assertions
- Tests cover both "service missing" and "service provided" paths for optional services
