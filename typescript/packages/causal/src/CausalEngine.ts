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
  type CausalEdge,
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
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants (aligned with Rust causal.rs lines 25, 51, 54)
// ═══════════════════════════════════════════════════════════════════════════

/** 7 days in seconds — matches Rust MAX_CAUSAL_WINDOW_SECS */
export const MAX_CAUSAL_WINDOW_SECS = 7 * 86400

/** Max edges per namespace — matches Rust MAX_EDGES_PER_NAMESPACE */
export const MAX_EDGES_PER_NAMESPACE = 5000

/** Max temporal successors per cause record — matches Rust MAX_TEMPORAL_SUCCESSORS_PER_RECORD */
export const MAX_TEMPORAL_SUCCESSORS_PER_RECORD = 16

// ═══════════════════════════════════════════════════════════════════════════
// Edge extraction stats (mirrors Rust EdgeExtractionStats)
// ═══════════════════════════════════════════════════════════════════════════

export type EdgeStats = {
  explicit_edges_found: number
  temporal_edges_found: number
  temporal_namespaces_scanned: number
  temporal_pairs_considered: number
  temporal_pairs_skipped_by_budget: number
  temporal_edges_capped: number
  temporal_namespaces_hit_cap: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure edge extraction functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract record-level causal edges from 3 signal sources:
 *   (A) Explicit: caused_by_id links
 *   (B) Explicit: connection_type == "causal"
 *   (C) Temporal: same namespace, created_at within 7-day window
 *
 * Pure function — no Effect needed. Matches Rust causal.rs extract_edges (lines 609-761).
 */
export function extractEdges(
  records: ReadonlyMap<string, AuraRecord>
): { edges: CausalEdge[]; stats: EdgeStats } {
  const edges: CausalEdge[] = []
  const seen = new Set<string>()
  let explicit_edges_found = 0
  let temporal_edges_found = 0
  let temporal_namespaces_scanned = 0
  let temporal_pairs_considered = 0
  let temporal_pairs_skipped_by_budget = 0
  let temporal_edges_capped = 0
  let temporal_namespaces_hit_cap = 0

  // ── Phase A: Explicit edges — caused_by_id ──
  for (const [rid, rec] of records) {
    if (rec.caused_by_id != null) {
      // Self-loop guard
      if (rec.caused_by_id === rid) continue
      const causeRec = records.get(rec.caused_by_id)
      if (causeRec && causeRec.namespace === rec.namespace) {
        const edgeKey = `${rec.caused_by_id}→${rid}`
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey)
          edges.push({
            cause_record_id: rec.caused_by_id,
            effect_record_id: rid,
            namespace: rec.namespace,
            edge_kind: "explicit",
            gap_seconds: rec.created_at - causeRec.created_at,
            created_at: rec.created_at,
          })
          explicit_edges_found++
        }
      }
    }

    // ── Phase B: Explicit edges — connection_type == "causal" ──
    for (const [connId, connType] of Object.entries(rec.connection_types)) {
      if (connType === "causal") {
        // Self-loop guard
        if (connId === rid) continue
        const connRec = records.get(connId)
        if (connRec && connRec.namespace === rec.namespace) {
          // Direction: earlier created_at is cause
          const recIsEarlier = rec.created_at <= connRec.created_at
          const causeId = recIsEarlier ? rid : connId
          const effectId = recIsEarlier ? connId : rid
          const causeTs = recIsEarlier ? rec.created_at : connRec.created_at
          const effectTs = recIsEarlier ? connRec.created_at : rec.created_at

          const edgeKey = `${causeId}→${effectId}`
          if (!seen.has(edgeKey)) {
            seen.add(edgeKey)
            edges.push({
              cause_record_id: causeId,
              effect_record_id: effectId,
              namespace: rec.namespace,
              edge_kind: "explicit_causal",
              gap_seconds: effectTs - causeTs,
              created_at: effectTs,
            })
            explicit_edges_found++
          }
        }
      }
    }
  }

  // ── Phase C: Temporal edges within namespace ──
  // Partition by namespace
  const byNs = new Map<string, Array<[string, AuraRecord]>>()
  for (const [rid, rec] of records) {
    let arr = byNs.get(rec.namespace)
    if (!arr) {
      arr = []
      byNs.set(rec.namespace, arr)
    }
    arr.push([rid, rec])
  }

  for (const [, nsRecs] of byNs) {
    temporal_namespaces_scanned++
    // Sort by created_at ascending
    nsRecs.sort((a, b) => a[1].created_at - b[1].created_at)

    let nsEdgeCount = 0
    let nsHitCap = false
    for (let i = 0; i < nsRecs.length; i++) {
      if (nsEdgeCount >= MAX_EDGES_PER_NAMESPACE) {
        break
      }
      const [causeId, causeRec] = nsRecs[i]!
      let budgetedSuccessors = 0
      for (let j = i + 1; j < nsRecs.length; j++) {
        // NearbySuccessors budgeting
        if (budgetedSuccessors >= MAX_TEMPORAL_SUCCESSORS_PER_RECORD) {
          temporal_pairs_skipped_by_budget += nsRecs.length - j
          break
        }
        temporal_pairs_considered++
        budgetedSuccessors++
        const [effectId, effectRec] = nsRecs[j]!
        const gap = effectRec.created_at - causeRec.created_at
        if (gap > MAX_CAUSAL_WINDOW_SECS) {
          break // sorted, all further will exceed window
        }
        if (gap <= 0) {
          continue
        }
        const edgeKey = `${causeId}→${effectId}`
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey)
          edges.push({
            cause_record_id: causeId,
            effect_record_id: effectId,
            namespace: causeRec.namespace,
            edge_kind: "temporal",
            gap_seconds: gap,
            created_at: effectRec.created_at,
          })
          nsEdgeCount++
          temporal_edges_found++
          if (nsEdgeCount >= MAX_EDGES_PER_NAMESPACE) {
            nsHitCap = true
            break
          }
        }
      }
    }
    if (nsHitCap) {
      temporal_namespaces_hit_cap++
      const remaining = nsRecs.length - 1 - nsEdgeCount
      temporal_edges_capped += Math.max(0, remaining)
    }
  }

  return {
    edges,
    stats: {
      explicit_edges_found,
      temporal_edges_found,
      temporal_namespaces_scanned,
      temporal_pairs_considered,
      temporal_pairs_skipped_by_budget,
      temporal_edges_capped,
      temporal_namespaces_hit_cap,
    },
  }
}

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
