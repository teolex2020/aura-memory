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
  BeliefState,
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

// ═══════════════════════════════════════════════════════════════════════════
// Belief-level pattern aggregation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build reverse index: record_id → belief_id.
 * Only maps records that belong to Resolved or Singleton beliefs.
 * Matches Rust causal.rs build_record_to_belief (lines 935-950).
 *
 * TS note: In TS, record_index maps record_id → belief_id directly
 * (unlike Rust where it maps record_id → hypothesis_id → belief_id).
 */
export function buildRecordToBelief(
  beliefState: { beliefs: Readonly<Record<string, { state: string; id: string }>>; record_index: Readonly<Record<string, string>> }
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const [rid, beliefId] of Object.entries(beliefState.record_index)) {
    const belief = beliefState.beliefs[beliefId]
    if (belief) {
      const state = belief.state
      if (state === BeliefState.Resolved || state === BeliefState.Singleton) {
        map.set(rid, beliefId)
      }
      // skip Unresolved / Empty
    }
  }
  return map
}

/**
 * Aggregate record-level edges into belief-level causal patterns.
 *
 * Matches Rust causal.rs aggregate_to_patterns (lines 767-929).
 */
export function aggregateToPatterns(
  edges: ReadonlyArray<CausalEdge>,
  _records: ReadonlyMap<string, AuraRecord>,
  beliefState: { beliefs: Readonly<Record<string, { state: string; id: string }>>; record_index: Readonly<Record<string, string>> }
): Effect.Effect<CausalPattern[], never, EpistemicTrace> {
  return Effect.gen(function* () {
    const recordToBelief = buildRecordToBelief(beliefState)

    // Accumulate edges by (cause_belief_id, effect_belief_id, namespace) group
    interface PatternKey {
      namespace: string
      causeBeliefId: string
      effectBeliefId: string
    }

    interface PatternAccum {
      causeRecordIds: Set<string>
      effectRecordIds: Set<string>
      timeGaps: number[]
      explicitCount: number
      temporalCount: number
      temporalWindowBuckets: Set<number>
    }

    const accum = new Map<string, { key: PatternKey; acc: PatternAccum }>()

    for (const edge of edges) {
      const causeBeliefId = recordToBelief.get(edge.cause_record_id)
      const effectBeliefId = recordToBelief.get(edge.effect_record_id)

      // If either record has no belief mapping (unresolved/empty), use orphan key
      const causeKey = causeBeliefId ?? `orphan:${edge.cause_record_id}`
      const effectKey = effectBeliefId ?? `orphan:${edge.effect_record_id}`

      // Skip self-loops at belief level
      if (causeKey === effectKey) continue

      const pk: PatternKey = {
        namespace: edge.namespace,
        causeBeliefId: causeKey,
        effectBeliefId: effectKey,
      }

      const groupKey = `${pk.namespace}:${pk.causeBeliefId}:${pk.effectBeliefId}`

      let entry = accum.get(groupKey)
      if (!entry) {
        entry = {
          key: pk,
          acc: {
            causeRecordIds: new Set(),
            effectRecordIds: new Set(),
            timeGaps: [],
            explicitCount: 0,
            temporalCount: 0,
            temporalWindowBuckets: new Set(),
          },
        }
        accum.set(groupKey, entry)
      }

      entry.acc.causeRecordIds.add(edge.cause_record_id)
      entry.acc.effectRecordIds.add(edge.effect_record_id)
      entry.acc.timeGaps.push(edge.gap_seconds)

      if (edge.edge_kind === "explicit" || edge.edge_kind === "explicit_causal") {
        entry.acc.explicitCount++
      } else {
        entry.acc.temporalCount++
        // Bucket by 1-hour windows for temporal window counting
        entry.acc.temporalWindowBuckets.add(Math.floor(edge.created_at / 3600))
      }
    }

    // Compute per-cause totals for counterevidence
    const causeExplicitSupportTotals = new Map<string, number>()
    const causeExplicitVariantCounts = new Map<string, number>()
    for (const [, { key, acc }] of accum) {
      const causeTotalKey = `${key.namespace}:${key.causeBeliefId}`
      causeExplicitSupportTotals.set(
        causeTotalKey,
        (causeExplicitSupportTotals.get(causeTotalKey) ?? 0) + acc.explicitCount
      )
      if (acc.explicitCount > 0) {
        causeExplicitVariantCounts.set(
          causeTotalKey,
          (causeExplicitVariantCounts.get(causeTotalKey) ?? 0) + 1
        )
      }
    }

    // Convert to CausalPattern[]
    const patterns: CausalPattern[] = []
    const now = Math.floor(Date.now() / 1000)

    for (const [, { key, acc }] of accum) {
      const supportCount = acc.timeGaps.length
      const totalExplicitForCause = causeExplicitSupportTotals.get(
        `${key.namespace}:${key.causeBeliefId}`
      ) ?? acc.explicitCount

      // Build pattern key and deterministic ID
      const edgeHash = deterministicEdgeHash(
        key.namespace,
        key.causeBeliefId,
        key.effectBeliefId,
        Array.from(acc.timeGaps)
      )
      const patternKeyStr = patternKey(
        key.namespace,
        key.causeBeliefId,
        key.effectBeliefId
      )
      const id = deterministicPatternIdFromKey(patternKeyStr, edgeHash)

      patterns.push({
        id,
        cause_belief_id: key.causeBeliefId,
        effect_belief_id: key.effectBeliefId,
        cause_key: patternKeyStr,
        effect_key: key.effectBeliefId,
        edge_hash: edgeHash,
        support: supportCount,
        confidence: 0, // computed in Plan 08 scoring
        lift: 0,       // computed in Plan 08 scoring
        state: CausalState.Candidate,
        last_updated: now,
        transition_lift: 0,
        temporal_consistency: acc.timeGaps.length > 0
          ? acc.timeGaps.filter((g) => g > 0).length / acc.timeGaps.length
          : 0,
        outcome_stability: 0,
        causal_strength: 0,
        support_count: supportCount,
        explicit_support_count: acc.explicitCount,
        counterevidence_count: totalExplicitForCause - acc.explicitCount,
        temporal_windows: acc.temporalWindowBuckets.size,
        namespace: key.namespace,
        cause_record_ids: Array.from(acc.causeRecordIds),
        effect_record_ids: Array.from(acc.effectRecordIds),
      })
    }

    return patterns
  })
}

// ── Pattern key and ID helpers ──

/** Build pattern key: namespace:cause_belief:effect_belief */
function patternKey(namespace: string, causeBid: string, effectBid: string): string {
  return `${namespace}:${causeBid}:${effectBid}`
}

/** Build a deterministic edge hash from edge data. */
function deterministicEdgeHash(
  namespace: string,
  causeBid: string,
  effectBid: string,
  timeGaps: number[]
): string {
  const sortedGaps = [...timeGaps].sort((a, b) => a - b)
  const raw = `${namespace}:${causeBid}:${effectBid}:${sortedGaps.join(",")}`
  // Simple hash — full xxhash in Plan 08 scoring
  let h = 0
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0
  }
  return `h${(h >>> 0).toString(16).padStart(8, "0")}`
}

/** Generate deterministic pattern ID from pattern key and edge hash. */
function deterministicPatternIdFromKey(patternKeyStr: string, edgeHash: string): string {
  const raw = `${patternKeyStr}|${edgeHash}`
  let h = 0
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0")
  return `cp-${hex.slice(-8)}`
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

      // Phase 1: Extract edges from records
      const { edges, stats: edgeStats } = extractEdges(_records)

      // Phase 2: Get belief state for record-to-belief mapping
      const beliefState = yield* _belief_engine.stats()

      // Phase 3: Aggregate edges to belief-level patterns
      const patterns = yield* aggregateToPatterns(edges, _records, beliefState)

      // Update engine state
      const patternsMap: Record<string, CausalPattern> = {}
      for (const p of patterns) {
        patternsMap[p.id] = p
      }
      self.state = {
        ...self.state,
        patterns: patternsMap,
        edges_found_total: self.state.edges_found_total + edges.length,
        last_corpus_fingerprint: `${_records.size}-${edges.length}-${patterns.length}`,
      }

      // Compute report stats
      const totalExplicit = edgeStats.explicit_edges_found
      const totalTemporal = edgeStats.temporal_edges_found
      const stableCount = patterns.filter((p) => p.state === CausalState.Stable).length
      const rejectedCount = patterns.filter((p) => p.state === CausalState.Rejected).length
      const avgCausalStrength = patterns.length > 0
        ? patterns.reduce((sum, p) => sum + p.causal_strength, 0) / patterns.length
        : 0

      if (trace) {
        yield* trace.event("causal.discover.end", {
          patterns_found: patterns.length,
          patterns_active: patterns.filter((p) => p.state === CausalState.Stable || p.state === CausalState.Candidate).length,
        })
      }

      const report: CausalReport = {
        patterns_found: patterns.length,
        patterns_active: patterns.filter((p) => p.state === CausalState.Stable || p.state === CausalState.Candidate).length,
        patterns_invalidated: 0,
        avg_confidence: 0,
        avg_lift: 0,
        explicit_edges: totalExplicit,
        temporal_edges: totalTemporal,
        temporal_namespaces_scanned: edgeStats.temporal_namespaces_scanned,
        temporal_pairs_considered: edgeStats.temporal_pairs_considered,
        temporal_pairs_skipped_by_budget: edgeStats.temporal_pairs_skipped_by_budget,
        temporal_edges_capped: edgeStats.temporal_edges_capped,
        temporal_namespaces_hit_cap: edgeStats.temporal_namespaces_hit_cap,
        patterns_meeting_support_gate: 0,
        patterns_meeting_repeated_window_gate: 0,
        patterns_meeting_counterfactual_gate: 0,
        patterns_blocked_by_evidence_gates: 0,
        patterns_blocked_by_counterfactual_gate: 0,
        avg_causal_strength: avgCausalStrength,
        stable_count: stableCount,
        rejected_count: rejectedCount,
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
