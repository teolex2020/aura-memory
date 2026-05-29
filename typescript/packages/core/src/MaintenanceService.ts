// ═══════════════════════════════════════════════════════════════════════
// MaintenanceService — full maintenance cycle orchestration
//
// Rust → TS semantic projection: maps `maintenance_service.rs` (978 lines).
// Placed in @aura/core per D-05.  Effect functions per D-06 (NOT Context.Tag).
//
// Stub algorithm phases are deferred per D-07.
// Concept/causal parallel discovery via Effect.all concurrency: 2 (D-13).
// ═══════════════════════════════════════════════════════════════════════

import { Effect, Ref } from "effect"
import {
  EpistemicTrace,
  BeliefEngine, BeliefStore,
  ConceptEngine, ConceptStore,
  CausalEngine, CausalStore,
  PolicyEngine, PolicyStore,
} from "@aura/contract"
import type {
  MaintenanceConfig, PhaseTimings, MaintenanceHotspots,
  LayerStability, LayerChurn,
  InitialMaintenancePhaseResult, DiscoveryPhaseResult, PostDiscoveryPhaseResult,
  ConceptSurfaceCounters, ConceptSurfaceMode,
  DecayReport, ReflectReport, EpistemicPhaseReport,
  BeliefPhaseReport, ConceptPhaseReport, CausalPhaseReport, PolicyPhaseReport,
  FeedbackAuditReport, FeedbackAuditEntry, ConsolidationReport,
  MaintenanceTrendSnapshot, MaintenanceTrendSummary,
  ConceptSurfaceTelemetry,
  ReflectionSummary, ReflectionFinding, ReflectionJobReport, ReflectionDigest, ReflectionKindSummary,
  MaintenanceReport
} from "@aura/contract"
import type { ContradictionCluster } from "@aura/contract"
import type { SdrLookup } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import type { BeliefEngineState, ConceptEngineState, CausalEngineState, PolicyEngineState } from "@aura/contract"
import type { FileWrite } from "@aura/contract"
import type { FileWriteError } from "@aura/contract"

// ═══════════════════════════════════════════════════════════════════════
// Placeholder types — TODO: import from proper module once available
// ═══════════════════════════════════════════════════════════════════════

// TODO: import from @aura/recall or @aura/core
type SDRInterpreter = unknown

// TODO: import from @aura/concept or @aura/index
type TagTaxonomy = unknown

// TODO: import from @aura/index
type NGramIndex = unknown

// TODO: import from @aura/storage
type CognitiveStore = unknown

// TODO: import from @aura/core
type BackgroundBrain = unknown

// ═══════════════════════════════════════════════════════════════════════
// Constants (aligned with Rust maintenance_service.rs)
// ═══════════════════════════════════════════════════════════════════════

export const MAINTENANCE_TREND_LIMIT = 32
export const REFLECTION_SUMMARY_LIMIT = 16
const REFLECTION_FINDING_LIMIT = 6
const REFLECTION_KIND_LIMIT = 12
const REFLECTION_NAMESPACE_LIMIT = 8

// ═══════════════════════════════════════════════════════════════════════
// Internal mutable type aliases
// Contract types use readonly fields.  During a maintenance cycle the Rust
// originals accept `&mut` — we mirror that with writable aliases.
// ═══════════════════════════════════════════════════════════════════════

type _PhaseTimings = { -readonly [K in keyof PhaseTimings]: PhaseTimings[K] }
type _MaintenanceHotspots = { -readonly [K in keyof MaintenanceHotspots]: MaintenanceHotspots[K] }

// ═══════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════

/** Compute LayerChurn from a previous key set and current key list. */
function layerChurn(prevKeys: ReadonlySet<string>, currentKeys: ReadonlyArray<string>): LayerChurn {
  const currentSet = new Set(currentKeys)
  let retained = 0
  let newCount = 0
  for (const k of currentKeys) {
    if (prevKeys.has(k)) retained++
    else newCount++
  }
  const dropped = prevKeys.size - retained
  const churn = (newCount + dropped) / Math.max(1, prevKeys.size)
  return { retained, newCount, dropped, churn }
}

/** Map engine BeliefReport → Maintenance BeliefPhaseReport. */
function toBeliefPhase(report: { beliefs_built: number }, state: BeliefEngineState): BeliefPhaseReport {
  return {
    beliefsCreated: report.beliefs_built,
    beliefsPruned: 0,
    revisions: 0,
    resolved: 0,
    unresolved: 0,
    totalBeliefs: Object.keys(state.beliefs).length,
    totalHypotheses: Object.keys(state.hypotheses).length,
    churnRate: 0,
  }
}

/** Map engine ConceptReport → Maintenance ConceptPhaseReport. */
function toConceptPhase(report: {
  seeds_found: number; candidates_found: number; stable_count: number; rejected_count: number;
  avg_abstraction_score: number; centroids_built: number; partitions_with_multiple_seeds: number;
  multi_seed_partition_sizes: ReadonlyArray<number>; cluster_sizes: ReadonlyArray<number>;
  clusters_with_multiple_beliefs: number; largest_cluster_size: number; pairwise_comparisons: number;
  pairwise_above_threshold: number; tanimoto_min: number; tanimoto_max: number; tanimoto_avg: number;
  avg_centroid_size: number; seeds_capped: number
}): ConceptPhaseReport {
  return {
    seedsFound: report.seeds_found,
    candidatesFound: report.candidates_found,
    stableCount: report.stable_count,
    rejectedCount: report.rejected_count,
    avgAbstractionScore: report.avg_abstraction_score,
    centroidsBuilt: report.centroids_built,
    partitionsWithMultipleSeeds: report.partitions_with_multiple_seeds,
    multiSeedPartitionSizes: report.multi_seed_partition_sizes,
    clusterSizes: report.cluster_sizes,
    clustersWithMultipleBeliefs: report.clusters_with_multiple_beliefs,
    largestClusterSize: report.largest_cluster_size,
    pairwiseComparisons: report.pairwise_comparisons,
    pairwiseAboveThreshold: report.pairwise_above_threshold,
    tanimotoMin: report.tanimoto_min,
    tanimotoMax: report.tanimoto_max,
    tanimotoAvg: report.tanimoto_avg,
    avgCentroidSize: report.avg_centroid_size,
    seedsCapped: report.seeds_capped,
  }
}

/** Map engine CausalReport → Maintenance CausalPhaseReport. */
function toCausalPhase(report: {
  patterns_found: number; patterns_active: number; patterns_invalidated: number;
  avg_confidence: number; avg_lift: number;
  explicit_edges: number; temporal_edges: number;
  temporal_namespaces_scanned: number; temporal_pairs_considered: number;
  temporal_pairs_skipped_by_budget: number; temporal_edges_capped: number;
  temporal_namespaces_hit_cap: number;
  patterns_meeting_support_gate: number; patterns_meeting_repeated_window_gate: number;
  patterns_meeting_counterfactual_gate: number;
  patterns_blocked_by_evidence_gates: number; patterns_blocked_by_counterfactual_gate: number;
  avg_causal_strength: number; stable_count: number; rejected_count: number;
}): CausalPhaseReport {
  return {
    skipped: false,
    edgesFound: report.patterns_found,
    explicitEdgesFound: report.explicit_edges,
    temporalEdgesFound: report.temporal_edges,
    temporalNamespacesScanned: report.temporal_namespaces_scanned,
    temporalPairsConsidered: report.temporal_pairs_considered,
    temporalPairsSkippedByBudget: report.temporal_pairs_skipped_by_budget,
    temporalEdgesCapped: report.temporal_edges_capped,
    temporalNamespacesHitCap: report.temporal_namespaces_hit_cap,
    candidatesFound: report.patterns_active,
    patternsMeetingSupportGate: report.patterns_meeting_support_gate,
    patternsMeetingRepeatedWindowGate: report.patterns_meeting_repeated_window_gate,
    patternsMeetingCounterfactualGate: report.patterns_meeting_counterfactual_gate,
    patternsBlockedByEvidenceGates: report.patterns_blocked_by_evidence_gates,
    patternsBlockedByCounterfactualGate: report.patterns_blocked_by_counterfactual_gate,
    stableCount: report.stable_count,
    rejectedCount: report.rejected_count,
    avgCausalStrength: report.avg_causal_strength,
  }
}

/** Map engine PolicyReport → Maintenance PolicyPhaseReport. */
function toPolicyPhase(report: { hints_found: number; hints_active: number; hints_suppressed: number; avg_confidence: number }): PolicyPhaseReport {
  return {
    seedsFound: 0,
    hintsFound: report.hints_found,
    stableHints: report.hints_active,
    suppressedHints: report.hints_suppressed,
    rejectedHints: 0,
    avgPolicyStrength: report.avg_confidence,
  }
}

/** Stub FeedbackAuditReport for phases that haven't been fully implemented yet. */
const stubFeedback: FeedbackAuditReport = {
  beliefsTouched: 0, beliefsBoosted: 0, beliefsDampened: 0,
  netConfidenceDelta: 0, netVolatilityDelta: 0, entries: [],
}

// ═══════════════════════════════════════════════════════════════════════
// Simple functions — Task 1
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a trend snapshot from individual phase telemetry values.
 *
 * Pure function (no Effect) — simply constructs the snapshot from its 14 params.
 * Aligned with Rust `MaintenanceService::build_trend_snapshot()`.
 */
export function buildTrendSnapshot(
  timestamp: string,
  totalRecords: number,
  recordsArchived: number,
  insightsFound: number,
  epistemic: EpistemicPhaseReport,
  belief: BeliefPhaseReport,
  causal: CausalPhaseReport,
  policy: PolicyPhaseReport,
  feedback: FeedbackAuditReport,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots,
  cumulativeCorrections: number,
  previousCumulativeCorrections: number
): MaintenanceTrendSnapshot {
  const correctionEvents = cumulativeCorrections - previousCumulativeCorrections
  // Causal rejection rate: rejected / (rejected + stable + candidates)
  const causalTotal = causal.rejectedCount + causal.stableCount + causal.candidatesFound
  const causalRejectionRate = causalTotal > 0 ? causal.rejectedCount / causalTotal : 0
  // Policy suppression rate: suppressed / (suppressed + stable + candidate)
  const policyTotal = policy.suppressedHints + policy.stableHints + policy.hintsFound
  const policySuppressionRate = policyTotal > 0 ? policy.suppressedHints / policyTotal : 0

  return {
    timestamp,
    totalRecords,
    recordsArchived,
    insightsFound,
    volatileRecords: epistemic.volatileRecords,
    beliefChurn: belief.churnRate,
    causalRejectionRate,
    policySuppressionRate,
    feedbackBeliefsTouched: feedback.beliefsTouched,
    feedbackNetConfidenceDelta: feedback.netConfidenceDelta,
    feedbackNetVolatilityDelta: feedback.netVolatilityDelta,
    correctionEvents,
    cumulativeCorrections,
    cycleTimeMs: timings.totalMs,
    dominantPhase: hotspots.dominantPhase,
  }
}

/**
 * Push a trend snapshot into the bounded history.
 *
 * If the history exceeds {@link MAINTENANCE_TREND_LIMIT} (32), the oldest entry is shifted off.
 * Returns `Effect<void>` to support use inside `Effect.gen` pipelines.
 */
export function pushTrendSnapshot(
  history: MaintenanceTrendSnapshot[],
  snapshot: MaintenanceTrendSnapshot
): Effect.Effect<void> {
  return Effect.sync(() => {
    history.push(snapshot)
    while (history.length > MAINTENANCE_TREND_LIMIT) {
      history.shift()
    }
  })
}

/**
 * Summarise the bounded trend history into a compact trend summary.
 *
 * Pure function (no Effect).  Computes averages over the most recent
 * {@link REFLECTION_FINDING_LIMIT} snapshots, plus window-level aggregates.
 */
export function summarizeTrends(
  history: ReadonlyArray<MaintenanceTrendSnapshot>
): MaintenanceTrendSummary {
  const snapshotCount = history.length
  const recent = history.slice(Math.max(0, snapshotCount - REFLECTION_FINDING_LIMIT))

  if (recent.length === 0) {
    return {
      snapshotCount,
      recent: [],
      avgBeliefChurn: 0,
      avgCausalRejectionRate: 0,
      avgPolicySuppressionRate: 0,
      avgCycleTimeMs: 0,
      avgCorrectionEvents: 0,
      totalCorrectionsInWindow: 0,
      latestDominantPhase: "",
    }
  }

  const avg = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length
  return {
    snapshotCount,
    recent,
    avgBeliefChurn: avg(recent.map((s) => s.beliefChurn)),
    avgCausalRejectionRate: avg(recent.map((s) => s.causalRejectionRate)),
    avgPolicySuppressionRate: avg(recent.map((s) => s.policySuppressionRate)),
    avgCycleTimeMs: avg(recent.map((s) => s.cycleTimeMs)),
    avgCorrectionEvents: avg(recent.map((s) => s.correctionEvents)),
    totalCorrectionsInWindow: recent.reduce((sum, s) => sum + s.correctionEvents, 0),
    latestDominantPhase: recent[recent.length - 1]?.dominantPhase ?? "",
  }
}

/**
 * Push a reflection summary into the bounded history.
 *
 * If the history exceeds {@link REFLECTION_SUMMARY_LIMIT} (16), the oldest entry is shifted off.
 * Returns `Effect<void>` to support use inside `Effect.gen` pipelines.
 */
export function pushReflectionSummary(
  history: ReflectionSummary[],
  summary: ReflectionSummary
): Effect.Effect<void> {
  return Effect.sync(() => {
    history.push(summary)
    while (history.length > REFLECTION_SUMMARY_LIMIT) {
      history.shift()
    }
  })
}

/**
 * Aggregate the full reflection history into a digest.
 *
 * Pure function (no Effect).  Groups findings by kind and namespace, isolates
 * the top {@link REFLECTION_FINDING_LIMIT} highest-scoring findings.
 */
export function summarizeReflections(
  history: ReadonlyArray<ReflectionSummary>
): ReflectionDigest {
  const summaryCount = history.length

  let totalFindings = 0
  let highSeverityFindings = 0
  const kindMap = new Map<string, { count: number; highSeverityCount: number; totalScore: number }>()
  const namespaceSet = new Set<string>()

  for (const summary of history) {
    totalFindings += summary.report.totalFindings
    namespaceSet.add(summary.dominantPhase)
    for (const f of summary.findings) {
      if (f.severity === "high") highSeverityFindings++
      const entry = kindMap.get(f.kind)
      if (entry) {
        entry.count++
        entry.totalScore += f.score
        if (f.severity === "high") entry.highSeverityCount++
      } else {
        kindMap.set(f.kind, { count: 1, highSeverityCount: f.severity === "high" ? 1 : 0, totalScore: f.score })
      }
    }
  }

  // Gather top findings across all summaries
  const allFindings: ReflectionFinding[] = []
  for (const summary of history) {
    for (const f of summary.findings) {
      allFindings.push(f)
    }
  }
  allFindings.sort((a, b) => b.score - a.score)
  const topFindings = allFindings.slice(0, REFLECTION_FINDING_LIMIT)

  // Build kind summaries
  const kinds: ReflectionKindSummary[] = []
  for (const [kind, entry] of kindMap) {
    kinds.push({
      kind,
      count: entry.count,
      highSeverityCount: entry.highSeverityCount,
      avgScore: entry.count > 0 ? entry.totalScore / entry.count : 0,
    })
  }
  kinds.sort((a, b) => b.count - a.count)

  // Limit namespaces
  const namespaces = Array.from(namespaceSet).slice(0, REFLECTION_NAMESPACE_LIMIT)

  return {
    summaryCount,
    totalFindings,
    highSeverityFindings,
    latestTimestamp: history[history.length - 1]?.timestamp ?? "",
    latestDominantPhase: history[history.length - 1]?.dominantPhase ?? "",
    kinds: kinds.slice(0, REFLECTION_KIND_LIMIT),
    namespaces,
    topFindings,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Orchestration Effect functions — Task 2
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the five initial maintenance sub-phases:
 *   level_fix → decay → reflect → epistemic_state → insights
 *
 * Sub-phase algorithms are stubbed per D-07.  This function implements
 * the orchestration skeleton with proper Effect.gen and EpistemicTrace
 * events, returning stub defaults for computation-heavy sub-phases.
 */
export function runInitialPhases(
  records: Map<string, AuraRecord>,
  config: MaintenanceConfig,
  _taxonomy: TagTaxonomy,
  _cognitiveStore: CognitiveStore,
  cycle: number,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<InitialMaintenancePhaseResult, never, EpistemicTrace> {
  return Effect.gen(function* () {
    const trace = yield* Effect.service(EpistemicTrace)
    const mt = timings as unknown as _PhaseTimings
    const mh = hotspots as unknown as _MaintenanceHotspots

    yield* trace.event("maintenance.initial.start", { records: records.size, cycle })

    let t = Date.now()

    // Phase 0: Level fix
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, NGramIndex, CognitiveStore completion
    const _shouldFix = config.levelFixInterval > 0 && cycle % config.levelFixInterval === 0
    mt.levelFixMs = Date.now() - t
    t = Date.now()

    // Phase 1: Decay
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, CognitiveStore completion
    const decay: DecayReport = { decayed: 0, archived: 0 }
    mt.decayMs = Date.now() - t
    t = Date.now()

    // Phase 2: Reflect
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, CognitiveStore completion
    const reflect: ReflectReport = { promoted: 0, archived: 0 }
    mt.reflectMs = Date.now() - t
    t = Date.now()

    // Phase 2.5: Epistemic state update
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, NGramIndex, CognitiveStore completion
    const epistemic: EpistemicPhaseReport = {
      updatedRecords: 0,
      totalSupportLinks: 0,
      totalConflictLinks: 0,
      volatileRecords: 0,
    }
    mt.epistemicMs = Date.now() - t
    t = Date.now()

    // Phase 3: Insights
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, CognitiveStore completion
    const insightsFound = 0
    mt.insightsMs = Date.now() - t

    yield* trace.event("maintenance.initial.end", {
      decay: decay.decayed,
      reflect: reflect.promoted,
      epistemic: epistemic.updatedRecords,
      insights: insightsFound,
    })

    return {
      totalRecords: records.size,
      decay,
      reflect,
      epistemic,
      insightsFound,
    }
  })
}

/**
 * Build (or refresh) the SDR lookup cache from a belief snapshot.
 *
 * Cached SDR vectors are reused across records whenever possible.  New records
 * that have not been computed yet are passed through the SDR interpreter (stub).
 * Entries no longer present in the belief snapshot are pruned.
 */
export function buildSdrLookup(
  _sdr: SDRInterpreter,
  sdrLookupCache: Ref.Ref<Map<string, ReadonlyArray<number>>>,
  beliefSnapshot: Map<string, AuraRecord>,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<SdrLookup, never, EpistemicTrace> {
  return Effect.gen(function* () {
    const trace = yield* Effect.service(EpistemicTrace)
    const mt = timings as unknown as _PhaseTimings
    const mh = hotspots as unknown as _MaintenanceHotspots

    yield* trace.event("maintenance.sdr.build.start", { records: beliefSnapshot.size })

    const t0 = Date.now()
    const cache = yield* Ref.get(sdrLookupCache)

    const sdrSourceBytes = 0
    let built = 0
    let computed = 0
    let reused = 0

    // Compute SDR for new records (stub: return empty array per D-07)
    // TODO: Full algorithm deferred per D-07 — requires SDRInterpreter implementation
    for (const [rid] of beliefSnapshot) {
      if (!cache.has(rid)) {
        built++
        computed++
        cache.set(rid, [])
      } else {
        reused++
      }
    }

    // Prune entries no longer in the snapshot
    for (const rid of cache.keys()) {
      if (!beliefSnapshot.has(rid)) {
        cache.delete(rid)
      }
    }

    yield* Ref.set(sdrLookupCache, cache)

    mh.sdrSourceBytes = sdrSourceBytes
    mh.sdrVectorsBuilt = built
    mh.sdrVectorsComputed = computed
    mh.sdrVectorsReused = reused

    mt.sdrBuildMs = Date.now() - t0

    yield* trace.event("maintenance.sdr.build.end", { built, computed, reused })

    return cache
  })
}

/**
 * Compute per-layer identity stability (retained / new / dropped / churn).
 *
 * This is the only orchestration function that is fully implemented (not stubbed).
 * It reads each engine's current key set, diffs it with the previous-cycle set
 * stored in a `Ref<Set<string>>`, and produces a `LayerStability` record.
 */
export function computeLayerStability(
  beliefEng: BeliefEngine.Interface,
  conceptEng: ConceptEngine.Interface,
  causalEng: CausalEngine.Interface,
  policyEng: PolicyEngine.Interface,
  prevBeliefKeys: Ref.Ref<Set<string>>,
  prevConceptKeys: Ref.Ref<Set<string>>,
  prevCausalKeys: Ref.Ref<Set<string>>,
  prevPolicyKeys: Ref.Ref<Set<string>>
): Effect.Effect<LayerStability, never> {
  return Effect.gen(function* () {
    const beliefState = yield* beliefEng.stats()
    const conceptState = yield* conceptEng.stats()
    const causalState = yield* causalEng.stats()
    const policyState = yield* policyEng.stats()

    // -- Belief layer --
    const prevB = yield* Ref.get(prevBeliefKeys)
    const currentB = Object.keys(beliefState.beliefs)
    const beliefChurn = layerChurn(prevB, currentB)
    yield* Ref.set(prevBeliefKeys, new Set(currentB))

    // -- Concept layer --
    const prevCpt = yield* Ref.get(prevConceptKeys)
    const currentCpt = Object.keys(conceptState.key_index)
    const conceptChurn = layerChurn(prevCpt, currentCpt)
    yield* Ref.set(prevConceptKeys, new Set(currentCpt))

    // -- Causal layer (uses pattern IDs as key set) --
    const prevC = yield* Ref.get(prevCausalKeys)
    const currentC = Object.keys(causalState.patterns)
    const causalChurn = layerChurn(prevC, currentC)
    yield* Ref.set(prevCausalKeys, new Set(currentC))

    // -- Policy layer --
    const prevP = yield* Ref.get(prevPolicyKeys)
    const currentP = Object.keys(policyState.key_index)
    const policyChurn = layerChurn(prevP, currentP)
    yield* Ref.set(prevPolicyKeys, new Set(currentP))

    return {
      belief: beliefChurn,
      concept: conceptChurn,
      causal: causalChurn,
      policy: policyChurn,
    }
  })
}

/**
 * Run the discovery phases — the core of the maintenance cycle:
 *   belief → concept ‖ causal (parallel) → policy → feedback
 *
 * Concept and causal discovery run concurrently via
 * `Effect.all({ concept, causal }, { concurrency: 2 })`, matching
 * Rust's `rayon::join` (D-13).
 */
export function runDiscoveryPhases(
  beliefEngine: BeliefEngine.Interface,
  beliefStore: BeliefStore.Interface,
  conceptEngine: ConceptEngine.Interface,
  conceptStore: ConceptStore.Interface,
  causalEngine: CausalEngine.Interface,
  causalStore: CausalStore.Interface,
  policyEngine: PolicyEngine.Interface,
  policyStore: PolicyStore.Interface,
  beliefSnapshot: Map<string, AuraRecord>,
  sdrLookup: SdrLookup,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<DiscoveryPhaseResult, FileWriteError,
  EpistemicTrace | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine
    | typeof BeliefStore | typeof ConceptStore | typeof CausalStore | typeof PolicyStore
    | FileWrite
> {
  return Effect.gen(function* () {
    const trace = yield* Effect.service(EpistemicTrace)
    const mt = timings as unknown as _PhaseTimings
    const mh = hotspots as unknown as _MaintenanceHotspots

    yield* trace.event("maintenance.discovery.start", { records: beliefSnapshot.size })

    // ── Phase 3.5: Belief ──
    let t = Date.now()
    const beliefReport = yield* beliefEngine.update_with_sdr(beliefSnapshot, sdrLookup)
    const beliefState = yield* beliefEngine.stats()
    yield* beliefStore.save(beliefState)
    mh.beliefTotalBeliefs = Object.keys(beliefState.beliefs).length
    mh.beliefTotalHypotheses = Object.keys(beliefState.hypotheses).length
    mt.beliefMs = Date.now() - t

    // ── Phase 3.7 & 3.8: Concept ‖ Causal (parallel, concurrency: 2) ──
    // Both discoveries read beliefEngine state independently, matching Rust's rayon::join semantics.
    t = Date.now()

    const { concept: conceptReport, causal: causalReport } = yield* Effect.all(
      {
        concept: conceptEngine.discover(beliefEngine, beliefSnapshot, sdrLookup),
        causal: causalEngine.discover(beliefEngine, beliefSnapshot, sdrLookup),
      },
      { concurrency: 2 }
    )

    // Save updated engine states after both discoveries complete
    const conceptStatePost = yield* conceptEngine.stats()
    yield* conceptStore.save(conceptStatePost)
    const causalStatePost = yield* causalEngine.stats()
    yield* causalStore.save(causalStatePost)

    mh.conceptPairwiseComparisons = conceptReport.pairwise_comparisons
    mh.conceptPartitionsWithMultipleSeeds = conceptReport.partitions_with_multiple_seeds
    const conceptMs = Date.now() - t
    // Concept and causal ran in parallel; attribute the full window to both
    mt.conceptMs = conceptMs
    mt.causalMs = conceptMs

    // ── Phase 3.9: Policy ──
    t = Date.now()
    const policyReport = yield* policyEngine.discover(causalEngine, conceptEngine, beliefEngine, beliefSnapshot)
    const policyState = yield* policyEngine.stats()
    yield* policyStore.save(policyState)
    mh.policySeedsFound = policyReport.hints_found
    mt.policyMs = Date.now() - t

    // ── Feedback ──
    // TODO: Full algorithm deferred per D-07 — apply_layer_feedback stub
    t = Date.now()
    const feedback: FeedbackAuditReport = stubFeedback
    // Feedback timing is minimal since it's a stub

    yield* trace.event("maintenance.discovery.end", {
      beliefs: beliefReport.beliefs_built,
      concepts: conceptReport.candidates_found,
      causal: causalReport.patterns_found,
      policy: policyReport.hints_found,
    })

    return {
      belief: toBeliefPhase(beliefReport, beliefState),
      concept: toConceptPhase(conceptReport),
      causal: toCausalPhase(causalReport),
      policy: toPolicyPhase(policyReport),
      feedback,
    }
  })
}

/**
 * Run the post-discovery phases:
 *   consolidation → cross_connections → task_reminders → archival
 *
 * All sub-phases are stubbed per D-07.
 */
export function runPostDiscoveryPhases(
  records: Map<string, AuraRecord>,
  _ngramIndex: NGramIndex,
  _tagIndex: Map<string, Set<string>>,
  _auraIndex: Map<string, string>,
  _cognitiveStore: CognitiveStore,
  _background: BackgroundBrain | undefined,
  config: MaintenanceConfig,
  _taxonomy: TagTaxonomy,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<PostDiscoveryPhaseResult> {
  return Effect.gen(function* () {
    const mt = timings as unknown as _PhaseTimings
    const mh = hotspots as unknown as _MaintenanceHotspots

    let t = Date.now()

    // Consolidation
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, NGramIndex, CognitiveStore completion
    const consolidation: ConsolidationReport = {
      nativeMerged: 0,
      clustersFound: 0,
      metaCreated: 0,
    }
    mt.consolidationMs = Date.now() - t

    // Cross connections
    // TODO: Full algorithm deferred per D-07 — requires TagTaxonomy, NGramIndex completion
    t = Date.now()
    const crossConnections = 0
    mh.crossConnectionsFound = crossConnections
    mt.crossConnectionsMs = Date.now() - t

    // Task reminders
    // TODO: Full algorithm deferred per D-07 — requires CognitiveStore completion
    t = Date.now()
    const taskReminders: ReadonlyArray<string> = []
    mh.taskRemindersFound = taskReminders.length

    // Archival
    // TODO: Full algorithm deferred per D-07 — requires CognitiveStore, TagTaxonomy completion
    const recordsArchived = 0
    mt.tasksArchivalMs = Date.now() - t

    return {
      consolidation,
      crossConnections,
      taskReminders,
      recordsArchived,
    }
  })
}

/**
 * Finalise the telemetry for one maintenance cycle.
 *
 * Finds the dominant phase (by max ms), reads concept surface telemetry,
 * drains the Ref-based counters via atomic swap, and returns
 * `ConceptSurfaceTelemetry`.
 */
export function finalizeTelemetry(
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots,
  conceptSurfaceMode: ConceptSurfaceMode,
  conceptEngine: ConceptEngine.Interface,
  counters: ConceptSurfaceCounters
): Effect.Effect<ConceptSurfaceTelemetry> {
  return Effect.gen(function* () {
    const mh = hotspots as unknown as _MaintenanceHotspots

    // ── Dominant phase detection ──
    const fields: [string, number][] = [
      ["levelFix", timings.levelFixMs],
      ["decay", timings.decayMs],
      ["reflect", timings.reflectMs],
      ["epistemic", timings.epistemicMs],
      ["insights", timings.insightsMs],
      ["sdrBuild", timings.sdrBuildMs],
      ["belief", timings.beliefMs],
      ["concept", timings.conceptMs],
      ["causal", timings.causalMs],
      ["policy", timings.policyMs],
      ["consolidation", timings.consolidationMs],
      ["crossConnections", timings.crossConnectionsMs],
      ["tasksArchival", timings.tasksArchivalMs],
    ]
    let dominantPhase = ""
    let dominantPhaseMs = 0
    for (const [name, ms] of fields) {
      if (ms > dominantPhaseMs) {
        dominantPhaseMs = ms
        dominantPhase = name
      }
    }
    const total = Object.values(timings).filter((v) => typeof v === "number").reduce((a: number, b: unknown) => a + (b as number), 0)
    const dominantPhaseShare = total > 0 ? dominantPhaseMs / total : 0

    mh.dominantPhase = dominantPhase
    mh.dominantPhaseMs = dominantPhaseMs
    mh.dominantPhaseShare = dominantPhaseShare

    // ── Read concept surface telemetry ──
    // TODO: Full algorithm deferred per D-07 — reads surfaced concept count from engine
    const conceptState = yield* conceptEngine.stats()
    const surfacedConceptsAvailable = Object.keys(conceptState.concepts).length
    const surfacedNamespaces = new Set(
      Object.values(conceptState.concepts).map((c) => c.namespace)
    ).size

    // ── Drain Ref counters (atomic swap — matches D-10) ──
    const globalCallsSinceLastCycle = yield* Ref.getAndSet(counters.globalCalls, 0)
    const namespaceCallsSinceLastCycle = yield* Ref.getAndSet(counters.namespaceCalls, 0)
    const recordCallsSinceLastCycle = yield* Ref.getAndSet(counters.recordCalls, 0)
    const conceptsReturnedSinceLastCycle = yield* Ref.getAndSet(counters.conceptsReturned, 0)
    const recordAnnotationsReturnedSinceLastCycle = yield* Ref.getAndSet(counters.recordAnnotationsReturned, 0)

    return {
      mode: conceptSurfaceMode,
      surfacedConceptsAvailable,
      surfacedNamespaces,
      globalCallsSinceLastCycle,
      namespaceCallsSinceLastCycle,
      recordCallsSinceLastCycle,
      conceptsReturnedSinceLastCycle,
      recordAnnotationsReturnedSinceLastCycle,
    }
  })
}

/**
 * Build a reflection summary for one maintenance cycle.
 *
 * Three kinds of findings are generated:
 * 1. Blocker findings — records tagged with taskTag whose level indicates they are blocked
 * 2. Contradiction findings — from contradiction clusters with conflict mass above threshold
 * 3. Trend findings — deteriorating trends detected in the trend summary
 *
 * Findings are capped at {@link REFLECTION_FINDING_LIMIT} (6).
 */
export function buildReflectionSummary(
  timestamp: string,
  records: Map<string, AuraRecord>,
  taskTag: string,
  contradictionClusters: ReadonlyArray<ContradictionCluster>,
  trendSummary: MaintenanceTrendSummary,
  hotspots: MaintenanceHotspots
): Effect.Effect<ReflectionSummary> {
  return Effect.sync(() => {
    const findings: ReflectionFinding[] = []

    // ── Blocker findings ──
    // TODO: Full algorithm deferred per D-07 — requires proper level/tag query from AuraRecord
    let blockerFindings = 0
    for (const [rid, record] of records) {
      if (record.tags.includes(taskTag)) {
        // Check if the record appears blocked (stub heuristic)
        if (record.strength < 0.3) {
          findings.push({
            kind: "blocker",
            namespace: record.namespace,
            title: `Blocked task: ${rid}`,
            detail: `Record ${rid} tagged "${taskTag}" has low strength (${record.strength}), possibly blocked`,
            relatedIds: [rid],
            score: 0.5,
            severity: "medium",
          })
          blockerFindings++
        }
      }
    }

    // ── Contradiction findings ──
    // TODO: Full algorithm deferred per D-07 — requires belief key/namespace grouping
    let contradictionFindings = 0
    for (const cluster of contradictionClusters) {
      if (cluster.maxConflictMass > 0.3) {
        findings.push({
          kind: "contradiction",
          namespace: cluster.namespace,
          title: `Contradiction cluster: ${cluster.id}`,
          detail: `${cluster.unresolvedBeliefCount} unresolved beliefs, conflict mass: ${cluster.maxConflictMass.toFixed(3)}`,
          relatedIds: [...cluster.beliefIds],
          score: Math.min(cluster.maxConflictMass, 1.0),
          severity: cluster.maxConflictMass > 0.7 ? "high" : cluster.maxConflictMass > 0.3 ? "medium" : "low",
        })
        contradictionFindings++
      }
    }

    // ── Trend findings ──
    // TODO: Full algorithm deferred per D-07 — proper trend deterioration detection
    let trendFindings = 0
    if (trendSummary.avgBeliefChurn > 0.5) {
      findings.push({
        kind: "trend",
        namespace: "belief",
        title: "High belief churn",
        detail: `Average belief churn rate (${trendSummary.avgBeliefChurn.toFixed(3)}) exceeds threshold across ${trendSummary.snapshotCount} snapshots`,
        relatedIds: [],
        score: Math.min(trendSummary.avgBeliefChurn, 1.0),
        severity: trendSummary.avgBeliefChurn > 0.8 ? "high" : "medium",
      })
      trendFindings++
    }
    if (trendSummary.avgPolicySuppressionRate > 0.5) {
      findings.push({
        kind: "trend",
        namespace: "policy",
        title: "High policy suppression rate",
        detail: `Average policy suppression rate (${trendSummary.avgPolicySuppressionRate.toFixed(3)}) indicates advisory pressure above threshold`,
        relatedIds: [],
        score: Math.min(trendSummary.avgPolicySuppressionRate, 1.0),
        severity: trendSummary.avgPolicySuppressionRate > 0.8 ? "high" : "medium",
      })
      trendFindings++
    }

    // ── Cap to limit ──
    const capped = findings.length > REFLECTION_FINDING_LIMIT
    const limitedFindings = findings
      .sort((a, b) => b.score - a.score)
      .slice(0, REFLECTION_FINDING_LIMIT)

    const report: ReflectionJobReport = {
      jobsRun: 1,
      blockerFindings,
      contradictionFindings,
      trendFindings,
      totalFindings: findings.length,
      capped,
    }

    return {
      timestamp,
      digest: `Maintenance cycle: ${blockerFindings} blockers, ${contradictionFindings} contradictions, ${trendFindings} trends. Dominant phase: ${hotspots.dominantPhase}`,
      dominantPhase: hotspots.dominantPhase,
      report,
      findings: limitedFindings,
    }
  })
}
