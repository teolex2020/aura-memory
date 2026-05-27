import { Effect, Layer, Option } from "effect"
import {
  PolicyEngine,
  PolicyState,
  EpistemicTrace,
  serviceOption,
  Clock,
  type PolicyEngineState,
  type PolicyHint,
  type PolicyReport,
  type CausalEngineState,
  type Record as AuraRecord
} from "@aura/contract"

export { PolicyState } from "@aura/contract"

/**
 * Policy Extraction Layer — extracts actionable hints from causal patterns.
 *
 * 策略提取层：从因果模式中提取可操作的策略提示。
 *
 * Fifth tier of the cognitive hierarchy:
 *   Record → Belief → Concept → Causal Pattern → Policy
 */

let _hintCounter = 0

export class PolicyEngineImpl {
  private state: PolicyEngineState = {
    version: 1 as const,
    hints: {},
    metadata: {}
  }

  discover(
    causal_state: CausalEngineState,
    _records: ReadonlyMap<string, AuraRecord>
  ): Effect.Effect<PolicyReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined
      if (trace) yield* trace.event("policy.discover.start", { patterns: Object.keys(causal_state.patterns).length })

      const nowSeconds = yield* Clock.nowSeconds()
      const patterns = Object.values(causal_state.patterns)

      if (patterns.length === 0) {
        const report: PolicyReport = {
          hints_found: 0,
          hints_active: 0,
          hints_suppressed: 0,
          avg_confidence: 0
        }
        if (trace) yield* trace.event("policy.discover.end", report)
        return report
      }

      const newHints: Record<string, PolicyHint> = {}
      let totalConfidence = 0

      for (const pattern of patterns) {
        // Skip rejected patterns
        if (pattern.state === "Rejected") continue

        const hintState = pattern.state === "Invalidated"
          ? PolicyState.Suppressed
          : pattern.confidence > 0.7
            ? PolicyState.Stable
            : PolicyState.Candidate

        // Preserve existing hint ID if one maps to this pattern
        const existingEntry = Object.entries(self.state.hints).find(
          ([, h]) => h.pattern_id === pattern.id
        )
        const id = existingEntry
          ? existingEntry[0]
          : `ph-${String(++_hintCounter).padStart(8, "0")}-${pattern.id.slice(0, 8)}`

        newHints[id] = {
          id,
          pattern_id: pattern.id,
          condition: `pattern:${pattern.id}`,
          action: "boost:consequent",
          priority: Math.round(pattern.confidence * 10),
          confidence: pattern.confidence,
          state: hintState,
          last_updated: nowSeconds
        }
        totalConfidence += pattern.confidence
      }

      const count = Object.keys(newHints).length
      const active = Object.values(newHints).filter(h => h.state === PolicyState.Stable).length
      const suppressed = Object.values(newHints).filter(h => h.state === PolicyState.Suppressed).length

      self.state = {
        ...self.state,
        hints: { ...self.state.hints, ...newHints }
      }

      const report: PolicyReport = {
        hints_found: count,
        hints_active: active,
        hints_suppressed: suppressed,
        avg_confidence: count > 0 ? Math.round((totalConfidence / count) * 10000) / 10000 : 0
      }

      if (trace) yield* trace.event("policy.discover.end", report)
      return report
    })
  }

  retract_hint(id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const { [id]: _removed, ...remaining } = self.state.hints
      self.state = { ...self.state, hints: remaining }
    })
  }

  stats(): Effect.Effect<PolicyEngineState> {
    return Effect.succeed(this.state)
  }
}

export const PolicyEngineLive = Layer.succeed(PolicyEngine, new PolicyEngineImpl())
