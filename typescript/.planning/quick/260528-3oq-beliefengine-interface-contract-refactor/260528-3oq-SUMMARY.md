---
quick_id: 260528-3oq
slug: beliefengine-interface-contract-refactor
status: complete
date: 2026-05-27
commit: 5c07e41
---

## Quick Task: BeliefEngine.Interface Contract Refactor

**Objective:** Adopt `namespace.Interface` pattern for BeliefEngine contract definition.

### Changes

- Replaced `export type BeliefEngineImpl` with `export namespace BeliefEngine { export interface Interface { ... } }` in Belief.ts
- Moved all method JSDoc from implementation to contract interface (LSP-visible to callers)
- `BeliefEngineImpl` now `implements BeliefEngine.Interface` explicitly
- Updated consumers: ConceptEngine.ts, ConceptEngine.test.ts, EpistemicRuntime.test.ts

### Pattern (for rollout to all modules)

```typescript
// contract: namespace.Interface merged with Tag class
export namespace XxxEngine {
  export interface Interface { /* methods with JSDoc */ }
}
export class XxxEngine extends Tag("...")<XxxEngine, XxxEngine.Interface>() {}

// implementation: explicit implements
export class XxxEngineImpl implements XxxEngine.Interface { /* ... */ }
```

### Verification
- `bun run typecheck`: 0 errors
- `bun run test`: 26/26 pass across belief/concept/causal/policy/epistemic-runtime
- Skill created: `.claude/skills/contract-interface-pattern/SKILL.md`
