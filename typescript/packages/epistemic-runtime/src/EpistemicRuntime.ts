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
  type PolicyActionSummary,
  type PolicyDomainSummary,
} from "@aura/contract"
import type { Belief } from "@aura/contract"
import type { ConceptCandidate } from "@aura/contract"
import type { CausalPattern } from "@aura/contract"
import type { PolicyHint } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import { surfaceConcepts, surfaceConceptsFiltered } from "@aura/concept"
import { surfacePolicyHints, surfacePolicyHintsFiltered } from "@aura/policy"
import type { PolicyHint as SurfacePolicyHint } from "@aura/policy"
import type { PolicyEngine as SurfacePolicyEngine } from "@aura/policy"

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
      const beliefs = Object.values(state.beliefs)
      const total = beliefs.length
      if (total === 0) {
        return {
          totalBeliefs: 0, resolved: 0, unresolved: 0, singleton: 0, empty: 0,
          contradictionClusterCount: 0, highVolatilityCount: 0, lowStabilityCount: 0,
          avgVolatility: 0, avgStability: 0,
          volatilityBands: { low: 0, medium: 0, high: 0 },
        }
      }
      let resolved = 0, unresolved = 0, singleton = 0, empty = 0
      let sumVolatility = 0, sumStability = 0
      let highVolatilityCount = 0, lowStabilityCount = 0
      let lowBand = 0, mediumBand = 0, highBand = 0
      for (const b of beliefs) {
        switch (b.state) {
          case "Resolved": resolved++; break
          case "Unresolved": unresolved++; break
          case "Singleton": singleton++; break
          case "Empty": empty++; break
        }
        sumVolatility += b.volatility
        sumStability += b.stability
        if (b.volatility >= 0.20) highVolatilityCount++
        if (b.stability <= 1.0) lowStabilityCount++
        if (b.volatility < 0.20) lowBand++
        else if (b.volatility <= 0.50) mediumBand++
        else highBand++
      }
      return {
        totalBeliefs: total,
        resolved, unresolved, singleton, empty,
        contradictionClusterCount: 0,
        highVolatilityCount,
        lowStabilityCount,
        avgVolatility: sumVolatility / total,
        avgStability: sumStability / total,
        volatilityBands: { low: lowBand, medium: mediumBand, high: highBand },
      }
    })
  }

  getContradictionClusters(
    records: ReadonlyMap<string, AuraRecord>,
    namespace?: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<ContradictionCluster>, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const state = yield* engine.stats()
      const beliefs = Object.values(state.beliefs)
      const hypotheses = Object.values(state.hypotheses)
      const maxLimit = Math.min(100, Math.max(1, limit ?? 20))
      if (beliefs.length === 0) return []

      // Build belief → record IDs mapping from hypotheses
      const beliefRecords = new Map<string, Set<string>>()
      for (const h of hypotheses) {
        if (!beliefRecords.has(h.belief_id)) beliefRecords.set(h.belief_id, new Set())
        const rs = beliefRecords.get(h.belief_id)!
        for (const rid of h.prototype_record_ids) rs.add(rid)
      }
      for (const b of beliefs) {
        if (!beliefRecords.has(b.id)) beliefRecords.set(b.id, new Set())
      }

      // Build adjacency graph: two beliefs connected if they share any record ID
      const beliefIds = beliefs.map((b) => b.id)
      const adj = new Map<string, Set<string>>()
      for (const id of beliefIds) adj.set(id, new Set())
      for (let i = 0; i < beliefIds.length; i++) {
        for (let j = i + 1; j < beliefIds.length; j++) {
          const ri = beliefRecords.get(beliefIds[i]!)!
          const rj = beliefRecords.get(beliefIds[j]!)!
          let connected = false
          for (const rid of ri) {
            if (rj.has(rid)) { connected = true; break }
          }
          if (connected) {
            adj.get(beliefIds[i]!)!.add(beliefIds[j]!)
            adj.get(beliefIds[j]!)!.add(beliefIds[i]!)
          }
        }
      }

      // BFS connected components
      const visited = new Set<string>()
      const components: Array<{ ids: string[]; recordIds: string[]; namespace: string }> = []
      for (const id of beliefIds) {
        if (visited.has(id)) continue
        const component: string[] = []
        const queue = [id]
        visited.add(id)
        while (queue.length > 0) {
          const cur = queue.shift()!
          component.push(cur)
          for (const neighbor of adj.get(cur)!) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor)
              queue.push(neighbor)
            }
          }
        }
        const compRecordIds = new Set<string>()
        let compNamespace = "default"
        for (const bid of component) {
          const rids = beliefRecords.get(bid)!
          for (const rid of rids) {
            compRecordIds.add(rid)
            const rec = records.get(rid)
            if (rec && compNamespace === "default" && rec.namespace) {
              compNamespace = rec.namespace
            }
          }
        }
        components.push({ ids: component, recordIds: [...compRecordIds], namespace: compNamespace })
      }

      // Filter by namespace
      let filtered = components
      if (namespace !== undefined) {
        filtered = components.filter((c) => c.namespace === namespace)
      }

      // Build cluster results
      const beliefMap = new Map(beliefs.map((b) => [b.id, b]))
      const results: ContradictionCluster[] = []
      for (const comp of filtered) {
        const cBeliefs = comp.ids.map((id) => beliefMap.get(id)!).filter(Boolean)
        const unresolvedCount = cBeliefs.filter((b) => b.state === "Unresolved").length
        const highVolCount = cBeliefs.filter((b) => b.volatility >= 0.20).length
        const avgVol = cBeliefs.reduce((s, b) => s + b.volatility, 0) / cBeliefs.length
        const avgStab = cBeliefs.reduce((s, b) => s + b.stability, 0) / cBeliefs.length
        const totalCM = cBeliefs.reduce((s, b) => s + b.conflict_mass, 0)
        const maxCM = Math.max(...cBeliefs.map((b) => b.conflict_mass))
        const sharedTags = computeSharedTags(cBeliefs, records, beliefRecords)
        results.push({
          id: comp.ids[0]!,
          namespace: comp.namespace,
          beliefIds: comp.ids,
          beliefKeys: cBeliefs.map((b) => b.key),
          recordIds: comp.recordIds,
          sharedTags,
          unresolvedBeliefCount: unresolvedCount,
          highVolatilityBeliefCount: highVolCount,
          avgVolatility: avgVol,
          avgStability: avgStab,
          totalConflictMass: totalCM,
          maxConflictMass: maxCM,
        })
      }

      results.sort((a, b) => b.totalConflictMass - a.totalConflictMass)
      return results.slice(0, maxLimit)
    })
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

  getSurfacedConcepts(limit?: number): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(ConceptEngine)
      return yield* surfaceConcepts(engine, limit)
    })
  }

  getSurfacedConceptsForNamespace(
    namespace: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(ConceptEngine)
      return yield* surfaceConceptsFiltered(engine, limit, namespace)
    })
  }

  getSurfacedConceptsForRecord(
    recordId: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(ConceptEngine)
      const state = yield* engine.stats()
      const max = Math.max(1, limit ?? 3)
      const concepts = Object.values(state.concepts)
        .filter(
          (c) =>
            (c.state === "Stable" || c.state === "Candidate") &&
            c.record_ids.includes(recordId)
        )
        .sort((a, b) => b.abstraction_score - a.abstraction_score)
        .slice(0, max)
      return concepts.map((c) => ({
        id: c.id,
        key: c.key,
        state: c.state,
        namespace: c.namespace,
        abstractionScore: c.abstraction_score,
        beliefCount: c.belief_ids.length,
        recordCount: c.record_ids.length,
        coreTerms: c.core_terms,
        recordIds: c.record_ids,
      }))
    })
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
    actionLimit?: number,
    domainLimit?: number
  ): Effect.Effect<PolicyLifecycleSummary, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const hints = Object.values(state.hints)
      const actMax = Math.min(50, Math.max(1, actionLimit ?? 10))
      const domMax = Math.min(50, Math.max(1, domainLimit ?? 10))

      if (hints.length === 0) {
        return {
          totalHints: 0, activeHints: 0,
          stableHints: 0, candidateHints: 0, suppressedHints: 0, rejectedHints: 0,
          avgPolicyStrength: 0, avgRiskScore: 0,
          actionSummaries: [], domainSummaries: [],
        }
      }

      let stableCount = 0, candidateCount = 0, suppressedCount = 0, rejectedCount = 0
      let sumStrength = 0, sumRisk = 0
      const actionGroups = new Map<string, PolicyHint[]>()
      const domainGroups = new Map<string, PolicyHint[]>()

      for (const h of hints) {
        switch (h.state) {
          case "Stable": stableCount++; break
          case "Candidate": candidateCount++; break
          case "Suppressed": suppressedCount++; break
          case "Rejected": rejectedCount++; break
        }
        sumStrength += h.policyStrength
        sumRisk += h.riskScore

        const ak = h.actionKind || "unknown"
        if (!actionGroups.has(ak)) actionGroups.set(ak, [])
        actionGroups.get(ak)!.push(h)

        const dk = `${h.namespace}\x00${h.domain}`
        if (!domainGroups.has(dk)) domainGroups.set(dk, [])
        domainGroups.get(dk)!.push(h)
      }

      // Action summaries
      const actionSummaries: PolicyActionSummary[] = []
      for (const [ak, group] of actionGroups) {
        let aStable = 0, aCand = 0, aSupp = 0, aRej = 0, aStr = 0, aRisk = 0
        for (const h of group) {
          switch (h.state) {
            case "Stable": aStable++; break
            case "Candidate": aCand++; break
            case "Suppressed": aSupp++; break
            case "Rejected": aRej++; break
          }
          aStr += h.policyStrength
          aRisk += h.riskScore
        }
        actionSummaries.push({
          actionKind: ak,
          totalHints: group.length,
          stableHints: aStable, candidateHints: aCand,
          suppressedHints: aSupp, rejectedHints: aRej,
          avgPolicyStrength: aStr / group.length,
          avgRiskScore: aRisk / group.length,
        })
      }
      actionSummaries.sort((a, b) => b.totalHints - a.totalHints)

      // Domain summaries
      const domainSummaries: PolicyDomainSummary[] = []
      for (const [dk, group] of domainGroups) {
        const [ns, dom] = dk.split("\x00")
        let dStable = 0, dCand = 0, dSupp = 0, dRej = 0, dStr = 0, dRisk = 0
        for (const h of group) {
          switch (h.state) {
            case "Stable": dStable++; break
            case "Candidate": dCand++; break
            case "Suppressed": dSupp++; break
            case "Rejected": dRej++; break
          }
          dStr += h.policyStrength
          dRisk += h.riskScore
        }
        const activeDomain = dStable + dCand
        domainSummaries.push({
          namespace: ns!, domain: dom!,
          totalHints: group.length,
          activeHints: activeDomain,
          stableHints: dStable, candidateHints: dCand,
          suppressedHints: dSupp, rejectedHints: dRej,
          avgPolicyStrength: dStr / group.length,
          avgRiskScore: dRisk / group.length,
          advisoryPressure: activeDomain / Math.max(1, group.length),
        })
      }
      domainSummaries.sort((a, b) => b.totalHints - a.totalHints)

      return {
        totalHints: hints.length,
        activeHints: stableCount + candidateCount,
        stableHints: stableCount, candidateHints: candidateCount,
        suppressedHints: suppressedCount, rejectedHints: rejectedCount,
        avgPolicyStrength: sumStrength / hints.length,
        avgRiskScore: sumRisk / hints.length,
        actionSummaries: actionSummaries.slice(0, actMax),
        domainSummaries: domainSummaries.slice(0, domMax),
      }
    })
  }

  getPolicyPressureReport(
    namespace?: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<PolicyPressureArea>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const hints = Object.values(state.hints)
      const maxLimit = Math.min(100, Math.max(1, limit ?? 20))

      const groups = new Map<string, PolicyHint[]>()
      for (const h of hints) {
        if (namespace !== undefined && h.namespace !== namespace) continue
        const key = `${h.namespace}\x00${h.domain}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(h)
      }

      const results: PolicyPressureArea[] = []
      for (const [, group] of groups) {
        let active = 0, suppressed = 0, rejected = 0
        let strongest: PolicyHint | null = null
        for (const h of group) {
          switch (h.state) {
            case "Stable": case "Candidate": active++; break
            case "Suppressed": suppressed++; break
            case "Rejected": rejected++; break
          }
          if (!strongest || h.policyStrength > strongest.policyStrength) {
            strongest = h
          }
        }
        results.push({
          namespace: group[0]!.namespace,
          domain: group[0]!.domain,
          advisoryPressure: active / Math.max(1, group.length),
          activeHints: active,
          suppressedHints: suppressed,
          rejectedHints: rejected,
          strongestHintId: strongest?.id ?? "",
          strongestActionKind: strongest?.actionKind ?? "",
          strongestPolicyStrength: strongest?.policyStrength ?? 0,
        })
      }

      results.sort((a, b) => b.advisoryPressure - a.advisoryPressure)
      return results.slice(0, maxLimit)
    })
  }

  getSurfacedPolicyHints(
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const hints = new Map<string, SurfacePolicyHint>()
      const keyIndex = new Map<string, string>()
      for (const [id, h] of Object.entries(state.hints)) {
        const surf = toSurfacePolicyHint(h)
        hints.set(id, surf)
        keyIndex.set(surf.key, id)
      }
      const adapter: SurfacePolicyEngine = { hints, keyIndex }
      const surfaced = yield* surfacePolicyHints(adapter, limit)
      return surfaced.map(toContractSurfacedPolicyHint)
    })
  }

  getSurfacedPolicyHintsForNamespace(
    namespace: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const hints = new Map<string, SurfacePolicyHint>()
      const keyIndex = new Map<string, string>()
      for (const [id, h] of Object.entries(state.hints)) {
        const surf = toSurfacePolicyHint(h)
        hints.set(id, surf)
        keyIndex.set(surf.key, id)
      }
      const adapter: SurfacePolicyEngine = { hints, keyIndex }
      const surfaced = yield* surfacePolicyHintsFiltered(adapter, limit, namespace)
      return surfaced.map(toContractSurfacedPolicyHint)
    })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function computeSharedTags(
  beliefs: Belief[],
  records: ReadonlyMap<string, AuraRecord>,
  beliefRecords: Map<string, Set<string>>
): ReadonlyArray<string> {
  const allRecordIds = new Set<string>()
  for (const b of beliefs) {
    const rids = beliefRecords.get(b.id)
    if (rids) for (const rid of rids) allRecordIds.add(rid)
  }
  if (allRecordIds.size === 0) return []
  const tagCounts = new Map<string, number>()
  for (const rid of allRecordIds) {
    const rec = records.get(rid)
    if (rec?.tags) {
      for (const tag of rec.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
  }
  return [...tagCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([tag]) => tag)
}

function toSurfacePolicyHint(h: PolicyHint): SurfacePolicyHint {
  const stateMap: Record<string, "Stable" | "Candidate" | "Suppressed" | "Rejected"> = {
    Stable: "Stable", Candidate: "Candidate",
    Suppressed: "Suppressed", Rejected: "Rejected",
  }
  const actionKind = (h.actionKind as SurfacePolicyHint["actionKind"]) ?? "recommend"
  const hintState = stateMap[h.state] ?? "Candidate"
  return {
    id: h.id,
    key: h.pattern_id ?? h.id,
    namespace: h.namespace,
    domain: h.domain,
    actionKind,
    recommendation: h.action,
    triggerCausalIds: h.pattern_id ? [h.pattern_id] : [],
    triggerConceptIds: [],
    triggerBeliefIds: [],
    supportingRecordIds: [],
    causeRecordIds: [],
    confidence: h.confidence,
    utilityScore: h.priority / 100,
    riskScore: h.riskScore,
    policyStrength: h.policyStrength,
    state: hintState,
    lastUpdated: h.last_updated,
  } as SurfacePolicyHint
}

function toContractSurfacedPolicyHint(s: {
  id: string; state: string; actionKind: string; namespace: string; domain: string
  recommendation: string; policyStrength: number; riskScore: number
  triggerCausalIds: ReadonlyArray<string>
}): SurfacedPolicyHint {
  return {
    id: s.id, state: s.state, actionKind: s.actionKind,
    namespace: s.namespace, domain: s.domain,
    recommendation: s.recommendation, policyStrength: s.policyStrength,
    riskScore: s.riskScore, triggerCausalIds: s.triggerCausalIds,
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
