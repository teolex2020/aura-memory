import xxhash from "xxhash-wasm"
import { Effect, Layer, Option } from "effect"
import {
  CausalEngine,
  CausalDiscoveryMode,
  CausalState,
  EpistemicTrace,
  serviceOption,
  Clock,
  type CausalEngineState,
  type CausalPattern,
  type CausalReport,
  type ConceptEngineState,
  type Record as AuraRecord,
  type SdrLookup
} from "@aura/contract"

export { CausalState } from "@aura/contract"

/**
 * Causal Discovery Layer — finds co-occurrence patterns between concepts.
 *
 * 因果发现层：从概念共现中挖掘因果模式。
 *
 * Fourth tier of the cognitive hierarchy:
 *   Record → Belief → Concept → Causal Pattern → Policy
 */

let _hasher: { h64: (input: string) => bigint } | null = null

async function getHasher(): Promise<{ h64: (input: string) => bigint }> {
  if (!_hasher) _hasher = await xxhash()
  return _hasher
}

async function deterministicPatternId(
  hasher: { h64: (input: string) => bigint },
  a: string,
  b: string
): Promise<string> {
  const [first, second] = a < b ? [a, b] : [b, a]
  const h = hasher.h64(`${first}|${second}`) & ((1n << 64n) - 1n)
  const hex = h.toString(16).padStart(16, "0")
  return `cp-${hex.slice(-12)}`
}

export class CausalEngineImpl {
  private state: CausalEngineState = {
    version: 1 as const,
    patterns: {},
    discovery_mode: CausalDiscoveryMode.Standard
  }

  discover(
    concept_state: ConceptEngineState,
    _records: ReadonlyMap<string, AuraRecord>,
    _sdr_lookup: SdrLookup
  ): Effect.Effect<CausalReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined
      if (trace) yield* trace.event("causal.discover.start", { concepts: Object.keys(concept_state.concepts).length })

      const nowSeconds = yield* Clock.nowSeconds()
      const concepts = Object.values(concept_state.concepts)

      if (concepts.length < 2) {
        const report: CausalReport = {
          patterns_found: 0,
          patterns_active: 0,
          patterns_invalidated: 0,
          avg_confidence: 0,
          avg_lift: 0
        }
        if (trace) yield* trace.event("causal.discover.end", report)
        return report
      }

      // Build reverse index: record_id → [concept_ids]
      const recordToConcepts = new Map<string, string[]>()
      for (const concept of concepts) {
        for (const recordId of concept.record_ids) {
          const list = recordToConcepts.get(recordId)
          if (list) list.push(concept.id)
          else recordToConcepts.set(recordId, [concept.id])
        }
      }

      // Count concept record sizes for lift computation
      const conceptRecordCounts = new Map<string, number>()
      for (const concept of concepts) {
        conceptRecordCounts.set(concept.id, concept.record_ids.length)
      }
      const totalRecords = concepts.reduce((sum, c) => sum + c.record_ids.length, 0)

      // Collect co-occurrence pairs
      interface PairEntry { a: string; b: string; records: Set<string> }
      const pairSharedRecords = new Map<string, PairEntry>()
      for (const [recordId, conceptIds] of recordToConcepts) {
        if (conceptIds.length < 2) continue
        for (let i = 0; i < conceptIds.length; i++) {
          for (let j = i + 1; j < conceptIds.length; j++) {
            const a = conceptIds[i]!
            const b = conceptIds[j]!
            const [first, second] = a < b ? [a, b] as const : [b, a] as const
            const key = `${first}|${second}`
            const entry = pairSharedRecords.get(key)
            if (entry) entry.records.add(recordId)
            else pairSharedRecords.set(key, { a, b, records: new Set([recordId]) })
          }
        }
      }

      // Build patterns from co-occurrence pairs
      const hasher = yield* Effect.promise(() => getHasher())
      const newPatterns: Record<string, CausalPattern> = {}
      let totalConfidence = 0
      let totalLift = 0

      for (const [, { a, b, records }] of pairSharedRecords) {
        const support = records.size
        if (support === 0) continue

        const aRecordCount = conceptRecordCounts.get(a) ?? 1
        const bRecordCount = conceptRecordCounts.get(b) ?? 1
        const avgRecordsPerConcept = totalRecords / concepts.length
        const confidence = Math.min(1.0, support / aRecordCount)
        const bProb = bRecordCount / Math.max(1, avgRecordsPerConcept)
        const lift = bProb > 0 ? confidence / Math.min(bProb, 1.0) : 1.0

        // Preserve existing ID if pattern already known
        const existingKey = Object.entries(self.state.patterns).find(
          ([, p]) => {
            const ants = p.antecedent_concept_ids
            const conss = p.consequent_concept_ids
            return ants.includes(a) && conss.includes(b) && ants.length === 1 && conss.length === 1
          }
        )
        const id = existingKey
          ? existingKey[0]
          : yield* Effect.promise(() => deterministicPatternId(hasher, a, b))

        const state = confidence > 0.7 ? CausalState.Stable : CausalState.Candidate
        newPatterns[id] = {
          id,
          antecedent_concept_ids: [a],
          consequent_concept_ids: [b],
          support,
          confidence: Math.round(confidence * 10000) / 10000,
          lift: Math.round(lift * 10000) / 10000,
          state,
          last_updated: nowSeconds
        }
        totalConfidence += confidence
        totalLift += lift
      }

      const count = Object.keys(newPatterns).length
      const activeCount = Object.values(newPatterns).filter(p => p.state === CausalState.Stable).length

      self.state = {
        ...self.state,
        patterns: { ...self.state.patterns, ...newPatterns }
      }

      const report: CausalReport = {
        patterns_found: count,
        patterns_active: activeCount,
        patterns_invalidated: 0,
        avg_confidence: count > 0 ? Math.round((totalConfidence / count) * 10000) / 10000 : 0,
        avg_lift: count > 0 ? Math.round((totalLift / count) * 10000) / 10000 : 0
      }

      if (trace) yield* trace.event("causal.discover.end", report)
      return report
    })
  }

  invalidate_pattern(id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const pattern = self.state.patterns[id]
      if (pattern) {
        self.state = {
          ...self.state,
          patterns: {
            ...self.state.patterns,
            [id]: { ...pattern, state: CausalState.Invalidated }
          }
        }
      }
    })
  }

  retract_pattern(id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const { [id]: _removed, ...remaining } = self.state.patterns
      self.state = { ...self.state, patterns: remaining }
    })
  }

  stats(): Effect.Effect<CausalEngineState> {
    return Effect.succeed(this.state)
  }
}

export const CausalEngineLive = Layer.succeed(CausalEngine, new CausalEngineImpl())
