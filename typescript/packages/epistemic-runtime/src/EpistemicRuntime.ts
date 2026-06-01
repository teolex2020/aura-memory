import { Effect, Layer, Ref } from "effect"
import { xxh3_64 } from "@aura/utils"
import {
  EpistemicRuntime,
  BeliefEngine,
  ConceptEngine,
  CausalEngine,
  PolicyEngine,
  ConceptSurfaceMode,
  BeliefState,
  ConceptState,
  CausalState,
  PolicyState,
  PolicyActionKind,
  DEFAULT_NAMESPACE,
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

  private conceptSurfaceEnabled(): boolean {
    return this.conceptSurfaceMode === ConceptSurfaceMode.Inspect
      || this.conceptSurfaceMode === ConceptSurfaceMode.Limited
  }

  // ── Belief layer (6 methods) ──

  getBeliefs(stateFilter?: string): Effect.Effect<ReadonlyArray<Belief>, never, BeliefEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const state = yield* engine.stats()
      const beliefs = Object.values(state.beliefs)
      return beliefs.filter((belief) => matchesBeliefStateFilter(belief.state, stateFilter))
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
      const maxLimit = rustLimit(limit, 20, 100)
      const beliefs = Object.values(state.beliefs)
        .filter((b) => b.volatility >= minVola)
        .sort((a, b) => (b.volatility - a.volatility) || (a.stability - b.stability))
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
      const maxStab = Math.max(0, maxStability ?? 1.0)
      const maxLimit = rustLimit(limit, 20, 100)
      const beliefs = Object.values(state.beliefs)
        .filter((b) => b.stability <= maxStab)
        .sort((a, b) => (a.stability - b.stability) || (b.volatility - a.volatility))
        .slice(0, maxLimit)
      return beliefs
    })
  }

  getBeliefInstabilitySummary(
    records: ReadonlyMap<string, AuraRecord>
  ): Effect.Effect<BeliefInstabilitySummary, never, BeliefEngine> {
    const self = this
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
        if (b.volatility >= 0.20) highBand++
        else if (b.volatility >= 0.05) mediumBand++
        else lowBand++
      }
      const contradictionClusters = yield* self.getContradictionClusters(records)
      return {
        totalBeliefs: total,
        resolved, unresolved, singleton, empty,
        contradictionClusterCount: contradictionClusters.length,
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
      const maxLimit = rustLimit(limit, 20, 100)
      const nodes: Array<{
        belief: Belief
        recordIds: ReadonlyArray<string>
        tags: ReadonlySet<string>
        namespace: string
      }> = []

      for (const belief of Object.values(state.beliefs)) {
        const beliefNamespace = namespaceFromBeliefKey(belief.key)
        if (namespace !== undefined && namespace !== beliefNamespace) continue
        if (
          belief.state !== BeliefState.Unresolved &&
          belief.volatility < 0.20 &&
          belief.stability > 1.0 &&
          belief.conflict_mass <= 0
        ) {
          continue
        }

        const recordIds = sortedUnique(
          belief.hypothesis_ids.flatMap((hid) => state.hypotheses[hid]?.prototype_record_ids ?? [])
        )
        const tags = new Set<string>()
        for (const rid of recordIds) {
          const record = records.get(rid)
          if (record) {
            for (const tag of record.tags) tags.add(tag)
          }
        }
        nodes.push({ belief, recordIds, tags, namespace: beliefNamespace })
      }

      const visited = Array<boolean>(nodes.length).fill(false)
      const results: ContradictionCluster[] = []

      for (let idx = 0; idx < nodes.length; idx++) {
        if (visited[idx]) continue

        const stack = [idx]
        const component: number[] = []
        visited[idx] = true

        while (stack.length > 0) {
          const current = stack.pop()!
          component.push(current)
          for (let next = 0; next < nodes.length; next++) {
            if (visited[next] || nodes[current]!.namespace !== nodes[next]!.namespace) continue
            if (
              intersects(nodes[current]!.recordIds, nodes[next]!.recordIds) ||
              intersects(nodes[current]!.tags, nodes[next]!.tags)
            ) {
              visited[next] = true
              stack.push(next)
            }
          }
        }

        const clusterNamespace = nodes[component[0]!]!.namespace
        const beliefIds = component.map((index) => nodes[index]!.belief.id).sort()
        const beliefKeys = component.map((index) => nodes[index]!.belief.key)
        const recordIds = sortedUnique(component.flatMap((index) => nodes[index]!.recordIds))
        const tagCounts = new Map<string, number>()
        for (const index of component) {
          for (const tag of nodes[index]!.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
          }
        }
        const tagEntries = [...tagCounts.entries()].sort(([a], [b]) => a.localeCompare(b))
        let sharedTags = tagEntries
          .filter(([, count]) => count >= 2)
          .map(([tag]) => tag)
        if (sharedTags.length === 0) {
          sharedTags = tagEntries.slice(0, 3).map(([tag]) => tag)
        }

        const cBeliefs = component.map((index) => nodes[index]!.belief)
        const unresolvedCount = cBeliefs.filter((b) => b.state === BeliefState.Unresolved).length
        const highVolCount = cBeliefs.filter((b) => b.volatility >= 0.20).length
        const avgVol = cBeliefs.reduce((s, b) => s + b.volatility, 0) / cBeliefs.length
        const avgStab = cBeliefs.reduce((s, b) => s + b.stability, 0) / cBeliefs.length
        const totalCM = cBeliefs.reduce((s, b) => s + b.conflict_mass, 0)
        const maxCM = cBeliefs.reduce((max, b) => Math.max(max, b.conflict_mass), 0)
        const clusterKey = `${clusterNamespace}\0${beliefIds.join("\0")}`
        results.push({
          id: xxh3_64(clusterKey).toString(16).padStart(12, "0"),
          namespace: clusterNamespace,
          beliefIds,
          beliefKeys,
          recordIds,
          sharedTags,
          unresolvedBeliefCount: unresolvedCount,
          highVolatilityBeliefCount: highVolCount,
          avgVolatility: avgVol,
          avgStability: avgStab,
          totalConflictMass: totalCM,
          maxConflictMass: maxCM,
        })
      }

      results.sort((a, b) =>
        (b.avgVolatility - a.avgVolatility) ||
        (b.totalConflictMass - a.totalConflictMass) ||
        (b.beliefIds.length - a.beliefIds.length)
      )
      return results.slice(0, maxLimit)
    })
  }

  // ── Concept layer (4 methods) ──

  getConcepts(stateFilter?: string): Effect.Effect<ReadonlyArray<ConceptCandidate>, never, ConceptEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(ConceptEngine)
      const state = yield* engine.stats()
      const concepts = Object.values(state.concepts)
      return concepts.filter((concept) => matchesConceptStateFilter(concept.state, stateFilter))
    })
  }

  getSurfacedConcepts(limit?: number): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    const self = this
    return Effect.gen(function* () {
      if (!self.conceptSurfaceEnabled()) return []
      const engine = yield* Effect.service(ConceptEngine)
      const surfaced = yield* surfaceConcepts(engine, limit)
      yield* self.trackGlobalCall(surfaced.length)
      return surfaced
    })
  }

  getSurfacedConceptsForNamespace(
    namespace: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    const self = this
    return Effect.gen(function* () {
      if (!self.conceptSurfaceEnabled()) return []
      const engine = yield* Effect.service(ConceptEngine)
      const surfaced = yield* surfaceConceptsFiltered(engine, limit, namespace)
      yield* self.trackNamespaceCall(surfaced.length)
      return surfaced
    })
  }

  getSurfacedConceptsForRecord(
    recordId: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, ConceptEngine> {
    const self = this
    return Effect.gen(function* () {
      if (!self.conceptSurfaceEnabled()) return []
      const engine = yield* Effect.service(ConceptEngine)
      const max = Math.min(3, Math.max(1, limit ?? 3))
      const surfaced = (yield* surfaceConcepts(engine))
        .filter((concept) => concept.recordIds.includes(recordId))
        .slice(0, max)
      yield* self.trackRecordCall(surfaced.length)
      return surfaced
    })
  }

  // ── Causal layer (1 method) ──

  getCausalPatterns(stateFilter?: string): Effect.Effect<ReadonlyArray<CausalPattern>, never, CausalEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(CausalEngine)
      const state = yield* engine.stats()
      const patterns = Object.values(state.patterns)
      return patterns.filter((pattern) => matchesCausalStateFilter(pattern.state, stateFilter))
    })
  }

  // ── Policy layer (7 methods) ──

  getPolicyHints(stateFilter?: string): Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      const hints = Object.values(state.hints)
      return hints.filter((hint) => matchesPolicyStateFilter(hint.state, stateFilter))
    })
  }

  getSuppressedPolicyHints(
    namespace?: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      return collectPolicyHintsByState(Object.values(state.hints), PolicyState.Suppressed, namespace, limit)
    })
  }

  getRejectedPolicyHints(
    namespace?: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<PolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      return collectPolicyHintsByState(Object.values(state.hints), PolicyState.Rejected, namespace, limit)
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
      const actMax = rustLimit(actionLimit, 8, 16)
      const domMax = rustLimit(domainLimit, 12, 32)

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
      const actionGroups = new Map<string, {
        totalHints: number
        stableHints: number
        candidateHints: number
        suppressedHints: number
        rejectedHints: number
        totalPolicyStrength: number
        totalRiskScore: number
      }>()
      const domainGroups = new Map<string, {
        namespace: string
        domain: string
        totalHints: number
        stableHints: number
        candidateHints: number
        suppressedHints: number
        rejectedHints: number
        totalPolicyStrength: number
        totalRiskScore: number
        advisoryPressure: number
      }>()

      for (const h of hints) {
        switch (h.state) {
          case PolicyState.Stable: stableCount++; break
          case PolicyState.Candidate: candidateCount++; break
          case PolicyState.Suppressed: suppressedCount++; break
          case PolicyState.Rejected: rejectedCount++; break
        }
        sumStrength += h.policyStrength
        sumRisk += h.riskScore

        const ak = policyActionKindName(h.actionKind)
        let action = actionGroups.get(ak)
        if (!action) {
          action = {
            totalHints: 0,
            stableHints: 0,
            candidateHints: 0,
            suppressedHints: 0,
            rejectedHints: 0,
            totalPolicyStrength: 0,
            totalRiskScore: 0,
          }
          actionGroups.set(ak, action)
        }
        action.totalHints++
        action.totalPolicyStrength += h.policyStrength
        action.totalRiskScore += h.riskScore
        switch (h.state) {
          case PolicyState.Stable: action.stableHints++; break
          case PolicyState.Candidate: action.candidateHints++; break
          case PolicyState.Suppressed: action.suppressedHints++; break
          case PolicyState.Rejected: action.rejectedHints++; break
        }

        const dk = `${h.namespace}\x00${h.domain}`
        let domain = domainGroups.get(dk)
        if (!domain) {
          domain = {
            namespace: h.namespace,
            domain: h.domain,
            totalHints: 0,
            stableHints: 0,
            candidateHints: 0,
            suppressedHints: 0,
            rejectedHints: 0,
            totalPolicyStrength: 0,
            totalRiskScore: 0,
            advisoryPressure: 0,
          }
          domainGroups.set(dk, domain)
        }
        domain.totalHints++
        domain.totalPolicyStrength += h.policyStrength
        domain.totalRiskScore += h.riskScore
        if (h.state === PolicyState.Stable || h.state === PolicyState.Candidate) {
          domain.advisoryPressure += h.policyStrength * policyActionPressureWeight(h.actionKind)
        }
        switch (h.state) {
          case PolicyState.Stable: domain.stableHints++; break
          case PolicyState.Candidate: domain.candidateHints++; break
          case PolicyState.Suppressed: domain.suppressedHints++; break
          case PolicyState.Rejected: domain.rejectedHints++; break
        }
      }

      const actionSummaries: PolicyActionSummary[] = []
      for (const [ak, acc] of actionGroups) {
        actionSummaries.push({
          actionKind: ak,
          totalHints: acc.totalHints,
          stableHints: acc.stableHints,
          candidateHints: acc.candidateHints,
          suppressedHints: acc.suppressedHints,
          rejectedHints: acc.rejectedHints,
          avgPolicyStrength: acc.totalHints > 0 ? acc.totalPolicyStrength / acc.totalHints : 0,
          avgRiskScore: acc.totalHints > 0 ? acc.totalRiskScore / acc.totalHints : 0,
        })
      }
      actionSummaries.sort((a, b) =>
        (b.totalHints - a.totalHints) ||
        (b.avgPolicyStrength - a.avgPolicyStrength) ||
        a.actionKind.localeCompare(b.actionKind)
      )

      const domainSummaries: PolicyDomainSummary[] = []
      for (const acc of domainGroups.values()) {
        domainSummaries.push({
          namespace: acc.namespace,
          domain: acc.domain,
          totalHints: acc.totalHints,
          activeHints: acc.stableHints + acc.candidateHints,
          stableHints: acc.stableHints,
          candidateHints: acc.candidateHints,
          suppressedHints: acc.suppressedHints,
          rejectedHints: acc.rejectedHints,
          avgPolicyStrength: acc.totalHints > 0 ? acc.totalPolicyStrength / acc.totalHints : 0,
          avgRiskScore: acc.totalHints > 0 ? acc.totalRiskScore / acc.totalHints : 0,
          advisoryPressure: acc.advisoryPressure,
        })
      }
      domainSummaries.sort((a, b) =>
        (b.advisoryPressure - a.advisoryPressure) ||
        (b.activeHints - a.activeHints) ||
        a.namespace.localeCompare(b.namespace) ||
        a.domain.localeCompare(b.domain)
      )

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
      const maxLimit = rustLimit(limit, 10, 25)

      const groups = new Map<string, {
        namespace: string
        domain: string
        advisoryPressure: number
        activeHints: number
        suppressedHints: number
        rejectedHints: number
        strongestHintId: string
        strongestActionKind: string
        strongestPolicyStrength: number
      }>()
      for (const h of hints) {
        if (namespace !== undefined && h.namespace !== namespace) continue
        const key = `${h.namespace}\x00${h.domain}`
        let entry = groups.get(key)
        if (!entry) {
          entry = {
            namespace: h.namespace,
            domain: h.domain,
            advisoryPressure: 0,
            activeHints: 0,
            suppressedHints: 0,
            rejectedHints: 0,
            strongestHintId: "",
            strongestActionKind: "",
            strongestPolicyStrength: 0,
          }
          groups.set(key, entry)
        }
        switch (h.state) {
          case PolicyState.Stable:
          case PolicyState.Candidate:
            entry.activeHints++
            entry.advisoryPressure += h.policyStrength * policyActionPressureWeight(h.actionKind)
            if (
              h.policyStrength > entry.strongestPolicyStrength ||
              (h.policyStrength === entry.strongestPolicyStrength && h.id < entry.strongestHintId)
            ) {
              entry.strongestHintId = h.id
              entry.strongestActionKind = policyActionKindName(h.actionKind)
              entry.strongestPolicyStrength = h.policyStrength
            }
            break
          case PolicyState.Suppressed:
            entry.suppressedHints++
            break
          case PolicyState.Rejected:
            entry.rejectedHints++
            break
        }
      }

      const results: PolicyPressureArea[] = []
      for (const entry of groups.values()) {
        if (entry.activeHints === 0 && entry.suppressedHints === 0 && entry.rejectedHints === 0) {
          continue
        }
        results.push({
          namespace: entry.namespace,
          domain: entry.domain,
          advisoryPressure: entry.advisoryPressure,
          activeHints: entry.activeHints,
          suppressedHints: entry.suppressedHints,
          rejectedHints: entry.rejectedHints,
          strongestHintId: entry.strongestHintId,
          strongestActionKind: entry.strongestActionKind,
          strongestPolicyStrength: entry.strongestPolicyStrength,
        })
      }

      results.sort((a, b) =>
        (b.advisoryPressure - a.advisoryPressure) ||
        (b.activeHints - a.activeHints) ||
        a.namespace.localeCompare(b.namespace) ||
        a.domain.localeCompare(b.domain)
      )
      return results.slice(0, maxLimit)
    })
  }

  getSurfacedPolicyHints(
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      return yield* surfacePolicyHints(state, limit)
    })
  }

  getSurfacedPolicyHintsForNamespace(
    namespace: string,
    limit?: number
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, PolicyEngine> {
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const state = yield* engine.stats()
      return yield* surfacePolicyHintsFiltered(state, limit, namespace)
    })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function rustLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (value === undefined || !Number.isFinite(value)) return defaultValue
  return Math.max(0, Math.min(maxValue, Math.trunc(value)))
}

function stateFilter(value: string | undefined): string | undefined {
  return value?.toLowerCase()
}

function matchesBeliefStateFilter(state: BeliefState, filter: string | undefined): boolean {
  switch (stateFilter(filter)) {
    case "resolved": return state === BeliefState.Resolved
    case "unresolved": return state === BeliefState.Unresolved
    case "singleton": return state === BeliefState.Singleton
    case "empty": return state === BeliefState.Empty
    default: return true
  }
}

function matchesConceptStateFilter(state: ConceptState, filter: string | undefined): boolean {
  switch (stateFilter(filter)) {
    case "stable": return state === ConceptState.Stable
    case "candidate": return state === ConceptState.Candidate
    case "rejected": return state === ConceptState.Rejected
    default: return true
  }
}

function matchesCausalStateFilter(state: CausalState, filter: string | undefined): boolean {
  switch (stateFilter(filter)) {
    case "stable": return state === CausalState.Stable
    case "candidate": return state === CausalState.Candidate
    case "rejected": return state === CausalState.Rejected
    default: return true
  }
}

function matchesPolicyStateFilter(state: PolicyState, filter: string | undefined): boolean {
  switch (stateFilter(filter)) {
    case "stable": return state === PolicyState.Stable
    case "candidate": return state === PolicyState.Candidate
    case "suppressed": return state === PolicyState.Suppressed
    case "rejected": return state === PolicyState.Rejected
    default: return true
  }
}

function namespaceFromBeliefKey(key: string): string {
  return key.split(":")[0] || DEFAULT_NAMESPACE
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

function intersects<T>(left: Iterable<T>, right: Iterable<T>): boolean {
  const rightSet = right instanceof Set ? right : new Set(right)
  for (const value of left) {
    if (rightSet.has(value)) return true
  }
  return false
}

function policyActionKindName(actionKind: PolicyActionKind): string {
  switch (actionKind) {
    case PolicyActionKind.Prefer: return "prefer"
    case PolicyActionKind.Recommend: return "recommend"
    case PolicyActionKind.VerifyFirst: return "verify_first"
    case PolicyActionKind.Avoid: return "avoid"
    case PolicyActionKind.Warn: return "warn"
  }
}

function policyActionPressureWeight(actionKind: PolicyActionKind): number {
  switch (actionKind) {
    case PolicyActionKind.Avoid: return 1.30
    case PolicyActionKind.Warn: return 1.15
    case PolicyActionKind.VerifyFirst: return 1.00
    case PolicyActionKind.Recommend: return 0.85
    case PolicyActionKind.Prefer: return 0.75
  }
}

function collectPolicyHintsByState(
  hints: ReadonlyArray<PolicyHint>,
  state: PolicyState,
  namespace: string | undefined,
  limit: number | undefined
): ReadonlyArray<PolicyHint> {
  const max = rustLimit(limit, 20, 100)
  return hints
    .filter((hint) => hint.state === state)
    .filter((hint) => namespace === undefined || hint.namespace === namespace)
    .sort((a, b) =>
      (b.policyStrength - a.policyStrength) ||
      a.cause_key.localeCompare(b.cause_key)
    )
    .slice(0, max)
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
