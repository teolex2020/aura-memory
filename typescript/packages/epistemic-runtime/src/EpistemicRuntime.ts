import { Effect, Layer, Ref } from "effect"
import {
  EpistemicRuntime,
  BeliefEngine,
  ConceptEngine,
  CausalEngine,
  PolicyEngine,
  ConceptSurfaceMode,
  type SurfacedConcept,
  type SurfacedPolicyHint,
  type BeliefInstabilitySummary,
  type ContradictionCluster,
  type PolicyLifecycleSummary,
  type PolicyPressureArea,
} from "@aura/contract"
import type { Belief } from "@aura/contract"
import type { ConceptCandidate } from "@aura/contract"
import type { CausalPattern } from "@aura/contract"
import type { PolicyHint } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"

// ── Telemetry infrastructure ────────────────────────────────────────

export class EpistemicRuntimeImpl implements EpistemicRuntime.Interface {
  constructor(
    private readonly conceptSurfaceMode: ConceptSurfaceMode,
    private readonly globalCalls: Ref.Ref<number>,
    private readonly namespaceCalls: Ref.Ref<number>,
    private readonly recordCalls: Ref.Ref<number>,
    private readonly conceptsReturned: Ref.Ref<number>,
    private readonly recordAnnotationsReturned: Ref.Ref<number>,
  ) {}

  // ── Telemetry tracking methods ──

  private trackGlobalCall(returned: number): Effect.Effect<void> {
    const globalRef = this.globalCalls
    const conceptsRef = this.conceptsReturned
    return Effect.gen(function* () {
      yield* Ref.update(globalRef, (n: number) => n + 1)
      yield* Ref.update(conceptsRef, (n: number) => n + returned)
    })
  }

  private trackNamespaceCall(returned: number): Effect.Effect<void> {
    const nsRef = this.namespaceCalls
    const conceptsRef = this.conceptsReturned
    return Effect.gen(function* () {
      yield* Ref.update(nsRef, (n: number) => n + 1)
      yield* Ref.update(conceptsRef, (n: number) => n + returned)
    })
  }

  private trackRecordCall(returned: number): Effect.Effect<void> {
    const recordRef = this.recordCalls
    const annotationsRef = this.recordAnnotationsReturned
    return Effect.gen(function* () {
      yield* Ref.update(recordRef, (n: number) => n + 1)
      yield* Ref.update(annotationsRef, (n: number) => n + returned)
    })
  }

  private trackConceptsReturned(n: number): Effect.Effect<void> {
    return Ref.update(this.conceptsReturned, (c: number) => c + n)
  }

  private trackRecordAnnotationsReturned(n: number): Effect.Effect<void> {
    return Ref.update(this.recordAnnotationsReturned, (r: number) => r + n)
  }

  // ── Belief layer (6 methods) ──

  getBeliefs(stateFilter?: string): Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const state = yield* engine.stats()
      const beliefs = Object.values(state.beliefs)
      if (stateFilter) return beliefs.filter((b) => b.state === stateFilter)
      return beliefs
    })
  }

  getBeliefForRecord(recordId: string): Effect.Effect<Belief | null, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const beliefId = yield* engine.belief_for_record(recordId)
      if (!beliefId) return null
      const state = yield* engine.stats()
      return state.beliefs[beliefId] ?? null
    })
  }

  getHighVolatilityBeliefs(
    minVolatility?: number,
    limit?: number
  ): Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const state = yield* engine.stats()
      const minVola = Math.max(0, Math.min(1, minVolatility ?? 0.20))
      const maxLimit = Math.max(1, Math.min(100, limit ?? 20))
      const beliefs = Object.values(state.beliefs)
        .filter((b) => b.volatility >= minVola)
        .sort((a, b) => b.volatility - a.volatility)
        .slice(0, maxLimit)
      return beliefs
    })
  }

  getLowStabilityBeliefs(
    maxStability?: number,
    limit?: number
  ): Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const state = yield* engine.stats()
      const maxStab = Math.max(0, Math.min(1, maxStability ?? 1.0))
      const maxLimit = Math.max(1, Math.min(100, limit ?? 20))
      const beliefs = Object.values(state.beliefs)
        .filter((b) => b.stability <= maxStab)
        .sort((a, b) => a.stability - b.stability)
        .slice(0, maxLimit)
      return beliefs
    })
  }

  getBeliefInstabilitySummary(): Effect.Effect<BeliefInstabilitySummary, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const state = yield* engine.stats()
      return {} as BeliefInstabilitySummary
    })
  }

  getContradictionClusters(
    _records: ReadonlyMap<string, AuraRecord>,
    _namespace?: string,
    _limit?: number
  ): Effect.Effect<ReadonlyArray<ContradictionCluster>, never, BeliefEngine> {
    return Effect.succeed([])
  }

  // ── Concept layer (4 methods) ──

  getConcepts(stateFilter?: string): Effect.Effect<ReadonlyArray<ConceptCandidate>, never, ConceptEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(ConceptEngine)
      const state = yield* engine.stats()
      const concepts = Object.values(state.concepts)
      if (stateFilter) return concepts.filter((c) => c.state === stateFilter)
      return concepts
    })
  }

  getSurfacedConcepts(_limit?: number): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    return Effect.succeed([])
  }

  getSurfacedConceptsForNamespace(
    _namespace: string,
    _limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    return Effect.succeed([])
  }

  getSurfacedConceptsForRecord(
    _recordId: string,
    _limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    return Effect.succeed([])
  }

  // ── Causal layer (1 method) ──

  getCausalPatterns(stateFilter?: string): Effect.Effect<ReadonlyArray<CausalPattern>, never, CausalEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(CausalEngine)
      const state = yield* engine.stats()
      const patterns = Object.values(state.patterns)
      if (stateFilter) return patterns.filter((p) => p.state === stateFilter)
      return patterns
    })
  }

  // ── Policy layer (7 methods) ──

  getPolicyHints(stateFilter?: string): Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const hints = Object.values(state.hints)
      if (stateFilter) return hints.filter((h) => h.state === stateFilter)
      return hints
    })
  }

  getSuppressedPolicyHints(
    namespace?: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const maxLimit = Math.max(1, Math.min(100, limit ?? 20))
      let hints = Object.values(state.hints).filter((h) => h.state === "Suppressed")
      if (namespace) hints = hints.filter((h) => h.namespace === namespace)
      hints.sort((a, b) => b.last_updated - a.last_updated)
      return hints.slice(0, maxLimit)
    })
  }

  getRejectedPolicyHints(
    namespace?: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const maxLimit = Math.max(1, Math.min(100, limit ?? 20))
      let hints = Object.values(state.hints).filter((h) => h.state === "Rejected")
      if (namespace) hints = hints.filter((h) => h.namespace === namespace)
      hints.sort((a, b) => b.last_updated - a.last_updated)
      return hints.slice(0, maxLimit)
    })
  }

  getPolicyLifecycleSummary(
    _actionLimit?: number,
    _domainLimit?: number
  ): Effect.Effect<PolicyLifecycleSummary, never, PolicyEngine> {
    return Effect.succeed({} as PolicyLifecycleSummary)
  }

  getPolicyPressureReport(
    _namespace?: string,
    _limit?: number
  ): Effect.Effect<ReadonlyArray<PolicyPressureArea>, never, PolicyEngine> {
    return Effect.succeed([])
  }

  getSurfacedPolicyHints(
    _limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine> {
    return Effect.succeed([])
  }

  getSurfacedPolicyHintsForNamespace(
    _namespace: string,
    _limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine> {
    return Effect.succeed([])
  }
}

// ── Live Layer ──────────────────────────────────────────────────────

export const EpistemicRuntimeLive = Layer.effect(
  EpistemicRuntime,
  Effect.gen(function* () {
    const globalCalls = yield* Ref.make(0)
    const namespaceCalls = yield* Ref.make(0)
    const recordCalls = yield* Ref.make(0)
    const conceptsReturned = yield* Ref.make(0)
    const recordAnnotationsReturned = yield* Ref.make(0)
    return new EpistemicRuntimeImpl(
      ConceptSurfaceMode.Inspect,
      globalCalls, namespaceCalls, recordCalls,
      conceptsReturned, recordAnnotationsReturned
    )
  })
)

export { EpistemicTraceLive } from "./EpistemicTrace"
