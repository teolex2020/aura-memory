import xxhash from "xxhash-wasm"
import { Effect, Layer, Option } from "effect"
import {
  CausalEngine,
  CausalDiscoveryMode,
  CausalState,
  TemporalBudgetMode,
  EvidenceMode,
  EpistemicTrace,
  serviceOption,
  Clock,
  type BeliefEngine,
  type CausalEngineState,
  type CausalPattern,
  type CausalReport,
  type Record as AuraRecord,
  type SdrLookup
} from "@aura/contract"

export { CausalState } from "@aura/contract"

/**
 * Causal Discovery Layer — extracts record-level causal edges and aggregates
 * into belief-level causal patterns.
 *
 * 因果发现层：从 record 级别提取因果边，聚合为 belief 级别的因果模式。
 *
 * Fourth tier of the cognitive hierarchy:
 *   Record → Belief → Concept → Causal Pattern → Policy
 *
 * NOTE: This implementation is a STUB aligned with the expanded contract types.
 * Full Rust-aligned edge extraction (explicit + temporal) and 20+ field scoring
 * will be implemented in Phase 06.3 Plan 07 (CausalEngine algorithm parity).
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
    discovery_mode: CausalDiscoveryMode.Standard,
    edges_found_total: 0,
    temporal_budget_mode: TemporalBudgetMode.NearbySuccessors,
    evidence_mode: EvidenceMode.StrictRepeatedWindows,
    last_corpus_fingerprint: ""
  }

  discover(
    _belief_engine: BeliefEngine.Interface,
    _records: ReadonlyMap<string, AuraRecord>,
    _sdr_lookup: SdrLookup
  ): Effect.Effect<CausalReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined
      if (trace) yield* trace.event("causal.discover.start", { records: _records.size })

      // ── STUB: full Rust-aligned edge extraction + scoring deferred to Phase 06.3 Plan 07 ──
      // This stub produces a valid CausalReport with zero values so that the
      // contract types compile and the MaintenanceService pipeline can run end-to-end.
      // The actual algorithm will be implemented via Plan 07 (CausalEngine parity).

      if (trace) {
        yield* trace.event("causal.discover.end", {
          patterns_found: 0,
          patterns_active: 0
        })
      }

      const report: CausalReport = {
        patterns_found: 0,
        patterns_active: 0,
        patterns_invalidated: 0,
        avg_confidence: 0,
        avg_lift: 0,
        explicit_edges: 0,
        temporal_edges: 0,
        temporal_namespaces_scanned: 0,
        temporal_pairs_considered: 0,
        temporal_pairs_skipped_by_budget: 0,
        temporal_edges_capped: 0,
        temporal_namespaces_hit_cap: 0,
        patterns_meeting_support_gate: 0,
        patterns_meeting_repeated_window_gate: 0,
        patterns_meeting_counterfactual_gate: 0,
        patterns_blocked_by_evidence_gates: 0,
        patterns_blocked_by_counterfactual_gate: 0,
        avg_causal_strength: 0,
        stable_count: 0,
        rejected_count: 0
      }

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
