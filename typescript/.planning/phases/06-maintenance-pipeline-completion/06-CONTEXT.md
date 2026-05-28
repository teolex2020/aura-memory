# Phase 6: Maintenance Pipeline Completion - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — previous investigation complete)

<domain>
## Phase Boundary

Full maintenance pipeline (Belief → Concept → Causal → Policy) + bounded reranking + finalize.
Complete the skeleton implementations in @aura/causal (CausalEngine) and @aura/policy (PolicyEngine),
wire the full maintenance pipeline through EpistemicRuntime, integrate bounded reranking into the
recall pipeline, and implement finalize mutations (activate/strengthen/session persistence).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase.
The investigation confirmed:

- **CausalEngine** (`packages/causal/src/CausalEngine.ts`): `discover`, `invalidate_pattern`, `retract_pattern` are all stubs throwing `UnimplementedError`
- **PolicyEngine** (`packages/policy/src/PolicyEngine.ts`): `discover`, `retract_hint` are stubs throwing `UnimplementedError`
- **EpistemicRuntime** (`packages/epistemic-runtime/src/EpistemicRuntime.ts`): DI wiring exists, needs maintenance pipeline hookup
- **Recall Pipeline** (`packages/recall/src/Pipeline.ts`): needs bounded reranking integration
- **Storage layer** has BeliefStoreFile, ConceptStoreFile, CausalStoreFile, PolicyStoreFile ready

### Key Patterns
- Effect-TS Context/Layer DI across all packages
- @aura/contract defines service interfaces (Tags), implementations are in packages
- Rust parity: all output must be deterministic and match Rust reference implementation
- SIMPLE/FULL IMPLEMENTATION comment markers per project conventions (D10)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@aura/belief`: BeliefEngine + BeliefStore fully implemented (reference for Causal/Policy patterns)
- `@aura/concept`: ConceptEngine + ConceptStore fully implemented (reference for Causal/Policy patterns)
- `@aura/contract`: All service interface tags defined (CausalEngine, PolicyEngine, etc.)
- `@aura/storage`: CausalStoreFile, PolicyStoreFile with file persistence
- `@aura/epistemic-runtime`: EpistemicRuntime with Layer wiring
- `@aura/recall`: Pipeline.ts with RRF fusion, GraphWalk, CausalWalk

### Established Patterns
- `Layer.succeed(Tag, new Impl())` for service registration
- Engines implement interfaces from @aura/contract
- Store files follow BrainAuraFile pattern (read/append/flush)

### Integration Points
- Phase 6 engines feed into EpistemicRuntime maintenance loop
- Bounded reranking plugs into recall Pipeline scoring
- Finalize mutations write through storage layer (BeliefStoreFile, etc.)

</code_context>

<specifics>
## Specific Ideas

Based on codebase investigation (2026-05-27):

1. **CausalEngine** needs: `discover()` implementation (causal pattern mining from trace), `invalidate_pattern()` (mark pattern invalid), `retract_pattern()` (remove pattern)
2. **PolicyEngine** needs: `discover()` implementation (policy rule extraction), `retract_hint()` (remove outdated hint)
3. **Maintenance pipeline wiring**: EpistemicRuntime should chain Trace → Belief → Concept → Causal → Policy sequentially
4. **Bounded reranking**: integrate into Pipeline scoring with configurable rerank depth
5. **Finalize mutations**: persist activate/strengthen/session mutations through respective StoreFiles

</specifics>

<deferred>
## Deferred Ideas

None — all scope is Phase 6 implementation.

</deferred>
