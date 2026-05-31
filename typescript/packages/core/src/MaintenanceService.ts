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
  Level,
} from "@aura/contract"
import type {
  MaintenanceConfig, PhaseTimings, MaintenanceHotspots,
  LayerStability, LayerChurn,
  InitialMaintenancePhaseResult, DiscoveryPhaseResult, PostDiscoveryPhaseResult,
  ConceptSurfaceCounters, ConceptSurfaceMode,
  DecayReport, ReflectReport, EpistemicPhaseReport,
  BeliefPhaseReport, ConceptPhaseReport, CausalPhaseReport, PolicyPhaseReport,
  FeedbackAuditReport, ConsolidationReport,
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
import { SDRInterpreter } from "@aura/recall"
import { CognitiveStoreFile } from "@aura/storage"
import { NGramIndex as MinHashNGramIndex } from "@aura/indexing"

// ═══════════════════════════════════════════════════════════════════════
// Typed maintenance dependency adapters
// ═══════════════════════════════════════════════════════════════════════

export type TaxonomyClassification = {
  readonly normalizedTags: ReadonlyArray<string>
  readonly namespace: string
  readonly semanticType: string
  readonly level: Level
  readonly identityCue: boolean
  readonly nonIdentityCue: boolean
  readonly taskCue: boolean
  readonly contradictionCue: boolean
}

export type TagTaxonomy = {
  readonly identityTags: ReadonlySet<string>
  readonly nonIdentityTags: ReadonlySet<string>
  readonly taskTags: ReadonlySet<string>
  readonly contradictionTags: ReadonlySet<string>
  classify: (record: AuraRecord) => TaxonomyClassification
}

export type NGramIndex = {
  query: (text: string, topK: number) => ReadonlyArray<readonly [number, string]>
}

export type CognitiveStore = {
  delete: (id: string) => Effect.Effect<void, FileWriteError, FileWrite>
  flush: () => Effect.Effect<void, FileWriteError, FileWrite>
}

export type BackgroundBrain = {
  discover_cross_connections: (
    records: ReadonlyMap<string, AuraRecord>,
    maxDiscoveries: number
  ) => ReadonlyArray<string>
  scheduled_tasks: (records: ReadonlyMap<string, AuraRecord>) => ReadonlyArray<string>
}

// ═══════════════════════════════════════════════════════════════════════
// Constants (aligned with Rust maintenance_service.rs)
// ═══════════════════════════════════════════════════════════════════════

export const MAINTENANCE_TREND_LIMIT = 32
export const REFLECTION_SUMMARY_LIMIT = 16
const REFLECTION_FINDING_LIMIT = 6
const REFLECTION_KIND_LIMIT = 12
const REFLECTION_NAMESPACE_LIMIT = 8
const IDENTITY_ACTIVATION_THRESHOLD = 20
const IDENTITY_STRENGTH_THRESHOLD = 0.9
const PROMOTION_ACTIVATION_THRESHOLD = 5
const PROMOTION_STRENGTH_THRESHOLD = 0.7
const LIVE_STRENGTH_THRESHOLD = 0.05

const DEFAULT_IDENTITY_TAGS = new Set([
  "identity", "profile", "persona", "preference", "family", "user-profile", "core-memory"
])
const DEFAULT_NON_IDENTITY_TAGS = new Set([
  "todo-item", "scheduled-task", "web-search-cache", "session-summary", "action-plan",
  "research-finding", "feedback-signal", "autonomous-outcome", "project-note"
])
const DEFAULT_TASK_TAGS = new Set(["scheduled-task", "todo-item", "task", "action-plan"])
const DEFAULT_CONTRADICTION_TAGS = new Set(["contradiction", "conflict", "rejected", "correction"])

// ═══════════════════════════════════════════════════════════════════════
// Internal mutable type aliases
// Contract types use readonly fields.  During a maintenance cycle the Rust
// originals accept `&mut` — we mirror that with writable aliases.
// ═══════════════════════════════════════════════════════════════════════

type _PhaseTimings = { -readonly [K in keyof PhaseTimings]: PhaseTimings[K] }
type _MaintenanceHotspots = { -readonly [K in keyof MaintenanceHotspots]: MaintenanceHotspots[K] }
type MutableRecord = AuraRecord & {
  support_mass?: number
  conflict_mass?: number
  confidence?: number
  volatility?: number
  salience?: number
}

/**
 * Convert readonly contract types to mutable counterparts for in-place mutation
 * during a maintenance cycle. The single `as unknown as` pays the bridge toll once.
 *
 * 将只读合约类型转换为可变副本，用于维护周期中的原地修改。
 */
function toMutable<T>(readonly: T): { -readonly [K in keyof T]: T[K] } {
  return readonly as unknown as { -readonly [K in keyof T]: T[K] }
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

function normalizedTags(record: AuraRecord): ReadonlyArray<string> {
  return record.tags.map(normalizeToken).filter((tag) => tag.length > 0)
}

function intersects(values: ReadonlyArray<string>, allowed: ReadonlySet<string>): boolean {
  return values.some((value) => allowed.has(value))
}

export function createDefaultTagTaxonomy(): TagTaxonomy {
  const identityTags = DEFAULT_IDENTITY_TAGS
  const nonIdentityTags = DEFAULT_NON_IDENTITY_TAGS
  const taskTags = DEFAULT_TASK_TAGS
  const contradictionTags = DEFAULT_CONTRADICTION_TAGS

  return {
    identityTags,
    nonIdentityTags,
    taskTags,
    contradictionTags,
    classify: (record) => {
      const tags = normalizedTags(record)
      const semanticType = normalizeToken(record.semantic_type)
      const namespace = normalizeToken(record.namespace || "default")
      const identityCue =
        intersects(tags, identityTags) ||
        semanticType === "preference" ||
        namespace === "identity" ||
        record.level === Level.Identity
      const taskCue = intersects(tags, taskTags)
      const contradictionCue = intersects(tags, contradictionTags) || semanticType === "contradiction"
      const nonIdentityCue =
        intersects(tags, nonIdentityTags) ||
        taskCue ||
        contradictionCue ||
        semanticType === "decision" ||
        semanticType === "trend"

      return {
        normalizedTags: tags,
        namespace,
        semanticType,
        level: record.level,
        identityCue,
        nonIdentityCue,
        taskCue,
        contradictionCue,
      }
    },
  }
}

export function createNGramIndex(records: ReadonlyMap<string, AuraRecord>): NGramIndex {
  // Rust reference: `NGramIndex` 使用 MinHash + LSH；TS 复用 @aura/indexing 的同语义实现。
  // 中文说明：固定 seed 对齐 parity verifier，避免 Rust 默认随机系数造成不可复现排序。
  const index = MinHashNGramIndex.withSeed0()
  for (const [id, record] of records) {
    index.add(id, record.content)
  }
  return index
}

export function createCognitiveStoreAdapter(store: CognitiveStoreFile): CognitiveStore {
  return {
    delete: (id) => store.appendDelete(id),
    flush: () => store.flush(),
  }
}

export const DisabledBackgroundBrain: BackgroundBrain = {
  discover_cross_connections: () => {
    // NON-PARITY IMPLEMENTATION: BackgroundBrain autonomous discovery is disabled in TS Phase 07.
    // Rust reference: `background_brain::discover_cross_connections`.
    return []
  },
  scheduled_tasks: () => {
    // NON-PARITY IMPLEMENTATION: scheduled task/reminder production is disabled in TS Phase 07.
    // Rust reference: BackgroundBrain scheduled-task paths.
    return []
  },
}

export function makeMaintenanceSdrInterpreter(): Effect.Effect<SDRInterpreter> {
  return Effect.promise(() => SDRInterpreter.default())
}

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
  const churn = (newCount + dropped) / Math.max(1, currentSet.size)
  return { retained, newCount, dropped, churn }
}

function levelRank(level: Level): number {
  switch (level) {
    case Level.Working:
      return 1
    case Level.Decisions:
      return 2
    case Level.Domain:
      return 3
    case Level.Identity:
      return 4
  }
}

function promoteLevel(level: Level): Level {
  switch (level) {
    case Level.Working:
      return Level.Decisions
    case Level.Decisions:
      return Level.Domain
    case Level.Domain:
      return Level.Identity
    case Level.Identity:
      return Level.Identity
  }
}

function decayRate(level: Level): number {
  switch (level) {
    case Level.Working:
      return 0.80
    case Level.Decisions:
      return 0.90
    case Level.Domain:
      return 0.95
    case Level.Identity:
      return 0.99
  }
}

function isAlive(record: AuraRecord): boolean {
  return record.strength >= LIVE_STRENGTH_THRESHOLD
}

function canPromote(record: AuraRecord): boolean {
  return (
    record.activation_count >= PROMOTION_ACTIVATION_THRESHOLD &&
    record.strength >= PROMOTION_STRENGTH_THRESHOLD &&
    levelRank(record.level) < levelRank(Level.Identity)
  )
}

function applyDecay(record: MutableRecord): void {
  const baseRate = decayRate(record.level)
  const ceilingFactor = Math.min(record.activation_count / 10, 1)
  const activationRate = Math.min(baseRate + (0.999 - baseRate) * ceilingFactor, 0.999)
  const salience = typeof record.salience === "number" ? Math.max(0, Math.min(1, record.salience)) : 0
  const salienceBias = 0.03 * salience
  const effectiveRate = Math.min(activationRate + salienceBias, 0.999)
  record.strength *= effectiveRate
}

function updateEpistemicSignals(record: MutableRecord, confirming: number, conflicting: number): boolean {
  const prevConfidence = record.confidence ?? defaultConfidenceForSource(record.source_type)
  const prevSupport = record.support_mass ?? 0
  const prevConflict = record.conflict_mass ?? 0
  const prevVolatility = record.volatility ?? 0

  record.confidence = prevConfidence
  record.support_mass = confirming
  record.conflict_mass = conflicting

  const supportDen = Math.max(prevSupport, confirming, 1)
  const conflictDen = Math.max(prevConflict, conflicting, 1)
  const supportDelta = (Math.abs(confirming - prevSupport) / supportDen) * 0.2
  const conflictDelta = (Math.abs(conflicting - prevConflict) / conflictDen) * 0.8
  const instantVolatility = Math.min(supportDelta + conflictDelta, 1)
  record.volatility = 0.3 * instantVolatility + 0.7 * prevVolatility

  return (
    prevSupport !== confirming ||
    prevConflict !== conflicting ||
    Math.abs(prevVolatility - record.volatility) > Number.EPSILON
  )
}

function defaultConfidenceForSource(sourceType: string): number {
  switch (sourceType) {
    case "recorded":
      return 0.90
    case "retrieved":
      return 0.75
    case "inferred":
      return 0.60
    case "generated":
      return 0.50
    default:
      return 0.50
  }
}

function sharedTagCount(a: AuraRecord, b: AuraRecord): number {
  const aTags = new Set(normalizedTags(a))
  let count = 0
  for (const tag of normalizedTags(b)) {
    if (aTags.has(tag)) count += 1
  }
  return count
}

function connectionType(a: AuraRecord, b: AuraRecord): string | undefined {
  return a.connection_types[b.id] ?? b.connection_types[a.id]
}

function connectionWeight(a: AuraRecord, b: AuraRecord): number {
  return a.connections[b.id] ?? b.connections[a.id] ?? 0
}

function detectInsights(records: ReadonlyMap<string, AuraRecord>, taxonomy: TagTaxonomy): number {
  const namespaceCounts = new Map<string, number>()
  const tagCounts = new Map<string, number>()
  let contradictionRecords = 0

  for (const record of records.values()) {
    if (!isAlive(record)) continue
    namespaceCounts.set(record.namespace, (namespaceCounts.get(record.namespace) ?? 0) + 1)
    const classification = taxonomy.classify(record)
    if (classification.contradictionCue) contradictionRecords += 1
    for (const tag of classification.normalizedTags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  let insights = 0
  for (const count of namespaceCounts.values()) {
    if (count >= 3) insights += 1
  }
  for (const count of tagCounts.values()) {
    if (count >= 2) insights += 1
  }
  if (contradictionRecords > 0) insights += 1
  return insights
}

function fixMemoryLevels(records: Map<string, AuraRecord>, taxonomy: TagTaxonomy): { totalIdentity: number; downgraded: number; kept: number } {
  let totalIdentity = 0
  let downgraded = 0
  let kept = 0

  for (const record of records.values()) {
    if (record.level !== Level.Identity) continue
    totalIdentity += 1
    const mutable = record as MutableRecord
    const classification = taxonomy.classify(record)
    if (classification.identityCue && !classification.nonIdentityCue) {
      kept += 1
      continue
    }
    if (classification.nonIdentityCue) {
      mutable.level = Level.Domain
      downgraded += 1
      continue
    }
    if (record.activation_count >= IDENTITY_ACTIVATION_THRESHOLD && record.strength >= IDENTITY_STRENGTH_THRESHOLD) {
      kept += 1
      continue
    }
    mutable.level = Level.Domain
    downgraded += 1
  }

  return { totalIdentity, downgraded, kept }
}

function guardedReflect(records: Map<string, AuraRecord>, _taxonomy: TagTaxonomy): ReflectReport {
  const originalLevels = new Map<string, Level>()
  for (const [id, record] of records) {
    if (record.level !== Level.Identity) originalLevels.set(id, record.level)
  }

  let promoted = 0
  for (const record of records.values()) {
    if (canPromote(record)) {
      const mutable = record as MutableRecord
      const next = promoteLevel(record.level)
      if (next !== record.level) {
        mutable.level = next
        promoted += 1
      }
    }
  }

  const dead: string[] = []
  for (const [id, record] of records) {
    if (!isAlive(record)) dead.push(id)
  }
  for (const id of dead) {
    records.delete(id)
  }

  let restored = 0
  for (const [id, originalLevel] of originalLevels) {
    const record = records.get(id)
    if (!record) continue
    const shouldRestore =
      (originalLevel === Level.Working && record.level !== Level.Working) ||
      (record.level === Level.Identity &&
        (record.activation_count < IDENTITY_ACTIVATION_THRESHOLD || record.strength < IDENTITY_STRENGTH_THRESHOLD))
    if (shouldRestore) {
      ;(record as MutableRecord).level = originalLevel
      restored += 1
    }
  }

  return { promoted: Math.max(0, promoted - restored), archived: dead.length }
}

function updateEpistemicState(records: Map<string, AuraRecord>, taxonomy: TagTaxonomy): EpistemicPhaseReport {
  const tagGroups = new Map<string, string[]>()
  for (const record of records.values()) {
    if (!isAlive(record)) continue
    for (const tag of normalizedTags(record)) {
      const group = tagGroups.get(tag) ?? []
      group.push(record.id)
      tagGroups.set(tag, group)
    }
  }

  const updates: Array<readonly [string, number, number]> = []
  let totalSupportLinks = 0
  let totalConflictLinks = 0

  for (const record of records.values()) {
    if (!isAlive(record)) continue
    const neighbors = new Set(Object.keys(record.connections))
    for (const tag of normalizedTags(record)) {
      for (const id of tagGroups.get(tag) ?? []) {
        if (id !== record.id) neighbors.add(id)
      }
    }

    let confirming = 0
    let conflicting = 0
    const recClass = taxonomy.classify(record)

    for (const neighborId of neighbors) {
      const other = records.get(neighborId)
      if (!other || !isAlive(other) || other.namespace !== record.namespace) continue
      const sharedTags = sharedTagCount(record, other)
      const relation = connectionType(record, other)
      const connected = connectionWeight(record, other) >= 0.10 || relation !== undefined
      if (!connected && sharedTags === 0) continue

      const otherClass = taxonomy.classify(other)
      const explicitConflict =
        relation !== undefined && (relation.includes("conflict") || relation.includes("contradict"))
      const contradictionPair = (recClass.contradictionCue || otherClass.contradictionCue) && sharedTags >= 2
      const levelConflict =
        sharedTags > 0 &&
        ((record.level === Level.Working && other.level === Level.Identity) ||
          (record.level === Level.Identity && other.level === Level.Working))

      if (explicitConflict || contradictionPair || levelConflict) {
        conflicting += 1
        continue
      }

      const reinforcingRelation =
        relation === "causal" || relation === "associative" || relation === "coactivation"
      const sharedSemantic = recClass.semanticType === otherClass.semanticType
      if ((sharedSemantic && sharedTags > 0) || (reinforcingRelation && connected) || sharedTags >= 2) {
        confirming += 1
      }
    }

    totalSupportLinks += confirming
    totalConflictLinks += conflicting
    updates.push([record.id, confirming, conflicting])
  }

  let updatedRecords = 0
  let volatileRecords = 0
  for (const [id, confirming, conflicting] of updates) {
    const record = records.get(id)
    if (!record) continue
    if (updateEpistemicSignals(record as MutableRecord, confirming, conflicting)) {
      updatedRecords += 1
    }
    if (((record as MutableRecord).volatility ?? 0) >= 0.05) {
      volatileRecords += 1
    }
  }

  return { updatedRecords, totalSupportLinks, totalConflictLinks, volatileRecords }
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

function emptyFeedbackReport(): FeedbackAuditReport {
  return {
    beliefsTouched: 0,
    beliefsBoosted: 0,
    beliefsDampened: 0,
    netConfidenceDelta: 0,
    netVolatilityDelta: 0,
    entries: [],
  }
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
 * 聚合 reflection history，生成最近窗口的 digest。
 *
 * Pure function (no Effect). Groups findings by kind and namespace, isolates
 * the top {@link REFLECTION_FINDING_LIMIT} highest-scoring findings.
 * 纯函数（无 Effect）。按 kind / namespace 聚合 findings，并保留分数最高的
 * {@link REFLECTION_FINDING_LIMIT} 条 finding。
 *
 * Rust reference: `MaintenanceService::summarize_reflections` (`../src/maintenance_service.rs`).
 */
export function summarizeReflections(
  history: ReadonlyArray<ReflectionSummary>
): ReflectionDigest {
  const summaryCount = history.length

  let totalFindings = 0
  let highSeverityFindings = 0
  const kindMap = new Map<string, { count: number; highSeverityCount: number; totalScore: number }>()
  const namespaceCounts = new Map<string, number>()

  for (const summary of history) {
    for (const f of summary.findings) {
      totalFindings++
      if (f.severity === "high") highSeverityFindings++
      const entry = kindMap.get(f.kind)
      if (entry) {
        entry.count++
        entry.totalScore += f.score
        if (f.severity === "high") entry.highSeverityCount++
      } else {
        kindMap.set(f.kind, { count: 1, highSeverityCount: f.severity === "high" ? 1 : 0, totalScore: f.score })
      }
      namespaceCounts.set(f.namespace, (namespaceCounts.get(f.namespace) ?? 0) + 1)
    }
  }

  // Gather top findings across all summaries
  const allFindings: ReflectionFinding[] = []
  for (const summary of history) {
    for (const f of summary.findings) {
      allFindings.push(f)
    }
  }
  allFindings.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
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
  kinds.sort((a, b) =>
    b.highSeverityCount - a.highSeverityCount ||
    b.count - a.count ||
    b.avgScore - a.avgScore
  )

  // Limit namespaces
  const namespaces = Array.from(namespaceCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, REFLECTION_NAMESPACE_LIMIT)
    .map(([namespace]) => namespace)

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
  taxonomy: TagTaxonomy,
  cognitiveStore: CognitiveStore,
  cycle: number,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<InitialMaintenancePhaseResult, FileWriteError, EpistemicTrace | FileWrite> {
  return Effect.gen(function* () {
    const trace = yield* Effect.service(EpistemicTrace)
    const mt = toMutable(timings)
    const mh = toMutable(hotspots)

    yield* trace.event("maintenance.initial.start", { records: records.size, cycle })

    let t = Date.now()

    // Phase 0: Level fix
    if (config.levelFixInterval > 0 && cycle % config.levelFixInterval === 0) {
      const fixed = fixMemoryLevels(records, taxonomy)
      yield* trace.event("maintenance.level_fix", {
        totalIdentity: fixed.totalIdentity,
        downgraded: fixed.downgraded,
        kept: fixed.kept,
      })
    }
    mt.levelFixMs = Date.now() - t
    t = Date.now()

    // Phase 1: Decay
    let decay: DecayReport = { decayed: 0, archived: 0 }
    if (config.decayEnabled) {
      let decayed = 0
      const toArchive: string[] = []
      for (const record of records.values()) {
        applyDecay(record as MutableRecord)
        decayed += 1
        if (!isAlive(record)) toArchive.push(record.id)
      }

      for (const record of records.values()) {
        const nextConnections: { [id: string]: number } = {}
        const nextConnectionTypes: { [id: string]: string } = {}
        for (const [id, weight] of Object.entries(record.connections)) {
          if (weight < 0.05) continue
          nextConnections[id] = weight * 0.99
          const type = record.connection_types[id]
          if (type !== undefined) nextConnectionTypes[id] = type
        }
        ;(record as MutableRecord).connections = nextConnections
        ;(record as MutableRecord).connection_types = nextConnectionTypes
      }

      for (const id of toArchive) {
        records.delete(id)
        yield* cognitiveStore.delete(id)
      }
      if (toArchive.length > 0) {
        yield* cognitiveStore.flush()
      }
      decay = { decayed, archived: toArchive.length }
    }
    mt.decayMs = Date.now() - t
    t = Date.now()

    // Phase 2: Reflect
    const reflect = config.reflectEnabled ? guardedReflect(records, taxonomy) : { promoted: 0, archived: 0 }
    mt.reflectMs = Date.now() - t
    t = Date.now()

    // Phase 2.5: Epistemic state update
    const epistemic = updateEpistemicState(records, taxonomy)
    mt.epistemicMs = Date.now() - t
    t = Date.now()

    // Phase 3: Insights
    const insightsFound = config.insightsEnabled ? detectInsights(records, taxonomy) : 0
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
  sdr: SDRInterpreter,
  sdrLookupCache: Ref.Ref<Map<string, ReadonlyArray<number>>>,
  beliefSnapshot: Map<string, AuraRecord>,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<SdrLookup, never, EpistemicTrace> {
  return Effect.gen(function* () {
    const trace = yield* Effect.service(EpistemicTrace)
    const mt = toMutable(timings)
    const mh = toMutable(hotspots)

    yield* trace.event("maintenance.sdr.build.start", { records: beliefSnapshot.size })

    const t0 = Date.now()
    const cache = yield* Ref.get(sdrLookupCache)

    const sdrSourceBytes = Array.from(beliefSnapshot.values())
      .reduce((sum, record) => sum + new TextEncoder().encode(record.content).byteLength, 0)
    let built = 0
    let computed = 0
    let reused = 0

    for (const [rid, record] of beliefSnapshot) {
      const existing = cache.get(rid)
      if (existing !== undefined) {
        reused++
        continue
      }
      const vector = sdr.textToSdr(record.content, false)
      cache.set(rid, vector)
      computed++
    }

    // Prune entries no longer in the snapshot
    for (const rid of cache.keys()) {
      if (!beliefSnapshot.has(rid)) {
        cache.delete(rid)
      }
    }

    yield* Ref.set(sdrLookupCache, cache)

    mh.sdrSourceBytes = sdrSourceBytes
    built = beliefSnapshot.size
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
    const mt = toMutable(timings)
    const mh = toMutable(hotspots)

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
    mh.causalEdgesFound = causalReport.patterns_found
    mh.causalExplicitEdgesFound = causalReport.explicit_edges
    mh.causalTemporalEdgesFound = causalReport.temporal_edges
    mh.causalTemporalNamespacesScanned = causalReport.temporal_namespaces_scanned
    mh.causalTemporalPairsConsidered = causalReport.temporal_pairs_considered
    mh.causalTemporalPairsSkippedByBudget = causalReport.temporal_pairs_skipped_by_budget
    mh.causalTemporalEdgesCapped = causalReport.temporal_edges_capped
    mh.causalTemporalNamespacesHitCap = causalReport.temporal_namespaces_hit_cap
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
    const rawFeedback = yield* beliefEngine.apply_layer_feedback(causalEngine, policyEngine)
    const feedback = rawFeedback ?? emptyFeedbackReport()

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
  ngramIndex: NGramIndex,
  _tagIndex: Map<string, Set<string>>,
  _auraIndex: Map<string, string>,
  _cognitiveStore: CognitiveStore,
  background: BackgroundBrain | undefined,
  config: MaintenanceConfig,
  taxonomy: TagTaxonomy,
  timings: PhaseTimings,
  hotspots: MaintenanceHotspots
): Effect.Effect<PostDiscoveryPhaseResult> {
  return Effect.gen(function* () {
    const mt = toMutable(timings)
    const mh = toMutable(hotspots)

    let t = Date.now()

    // Consolidation
    let clustersFound = 0
    if (config.consolidationEnabled) {
      const seen = new Set<string>()
      for (const [id, record] of records) {
        if (seen.has(id) || !isAlive(record)) continue
        const hits = ngramIndex.query(record.content, Math.max(2, config.maxClustersPerRun + 1))
          .filter(([, hitId]) => hitId !== id)
        const hasSimilarPeer = hits.some(([score, hitId]) => {
          const peer = records.get(hitId)
          return peer !== undefined && peer.namespace === record.namespace && score >= 0.25
        })
        if (hasSimilarPeer) {
          clustersFound += 1
          seen.add(id)
        }
        if (clustersFound >= config.maxClustersPerRun) break
      }
    }
    const consolidation: ConsolidationReport = { nativeMerged: 0, clustersFound, metaCreated: 0 }
    mt.consolidationMs = Date.now() - t

    // Cross connections
    t = Date.now()
    const crossConnections = background?.discover_cross_connections(records, 10).length ?? 0
    mh.crossConnectionsFound = crossConnections
    mt.crossConnectionsMs = Date.now() - t

    // Task reminders
    t = Date.now()
    const backgroundTasks = background?.scheduled_tasks(records) ?? []
    const taskReminders = backgroundTasks.length > 0
      ? backgroundTasks
      : Array.from(records.values())
        .filter((record) => taxonomy.classify(record).taskCue && record.metadata.status === "active")
        .map((record) => record.id)
        .slice(0, 8)
    mh.taskRemindersFound = taskReminders.length

    // Archival
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
    const mh = toMutable(hotspots)

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
    const todayMs = Date.now()

    // ── Blocker findings ──
    let blockerFindings = 0
    const blockerCandidates: ReflectionFinding[] = []
    for (const [rid, record] of records) {
      if (!record.tags.includes(taskTag) || record.metadata.status !== "active") continue
      const dueDate = record.metadata.due_date
      if (typeof dueDate !== "string") continue
      const dueMs = Date.parse(dueDate)
      if (!Number.isFinite(dueMs) || dueMs > todayMs) continue
      const overdueDays = Math.max(0, Math.floor((todayMs - dueMs) / 86_400_000))
      const salience = typeof (record as MutableRecord).salience === "number" ? (record as MutableRecord).salience! : 0
      const preview = record.content.length > 56 ? `${record.content.slice(0, 56)}...` : record.content
      blockerCandidates.push({
        kind: "repeated_blocker",
        namespace: record.namespace,
        title: `Overdue task remains active: ${preview}`,
        detail: `Task is overdue by ${overdueDays} day(s), salience ${salience.toFixed(2)}, strength ${record.strength.toFixed(2)}.`,
        relatedIds: [rid],
        score: overdueDays + salience + Math.max(0, 1 - record.strength),
        severity: overdueDays >= 3 || salience >= 0.70 ? "high" : overdueDays >= 1 ? "medium" : "low",
      })
    }
    blockerCandidates.sort((a, b) => b.score - a.score)
    findings.push(...blockerCandidates.slice(0, 2))
    blockerFindings = Math.min(blockerCandidates.length, 2)

    // ── Contradiction findings ──
    let contradictionFindings = 0
    const contradictionCandidates: ReflectionFinding[] = []
    for (const cluster of contradictionClusters) {
      if (cluster.unresolvedBeliefCount <= 0 && cluster.maxConflictMass <= 0) continue
      contradictionCandidates.push({
        kind: "unresolved_contradiction",
        namespace: cluster.namespace,
        title: `Unresolved contradiction corridor with ${cluster.beliefIds.length} beliefs`,
        detail: `${cluster.unresolvedBeliefCount} unresolved beliefs, conflict mass: ${cluster.maxConflictMass.toFixed(3)}`,
        relatedIds: [...cluster.beliefIds],
        score: Math.min(cluster.maxConflictMass, 1.5),
        severity: cluster.maxConflictMass >= 1.0 ? "high" : cluster.maxConflictMass >= 0.2 ? "medium" : "low",
      })
    }
    contradictionCandidates.sort((a, b) => b.score - a.score)
    findings.push(...contradictionCandidates.slice(0, 2))
    contradictionFindings = Math.min(contradictionCandidates.length, 2)

    // ── Trend findings ──
    let trendFindings = 0
    const trendDirection = (() => {
      if (trendSummary.recent.length < 2) return "insufficient_data"
      const first = trendSummary.recent[0]!
      const last = trendSummary.recent[trendSummary.recent.length - 1]!
      const firstPressure =
        first.volatileRecords + first.correctionEvents +
        first.policySuppressionRate * 10 + first.causalRejectionRate * 10
      const lastPressure =
        last.volatileRecords + last.correctionEvents +
        last.policySuppressionRate * 10 + last.causalRejectionRate * 10
      const delta = lastPressure - firstPressure
      if (delta > 1) return "worsening"
      if (delta < -1) return "improving"
      return "stable"
    })()
    if (
      trendDirection === "worsening" ||
      trendSummary.avgBeliefChurn >= 0.10 ||
      trendSummary.avgPolicySuppressionRate >= 0.25
    ) {
      findings.push({
        kind: "trend_tension",
        namespace: "default",
        title: `Maintenance trend is ${trendDirection} with dominant phase ${hotspots.dominantPhase}`,
        detail: `Avg belief churn ${trendSummary.avgBeliefChurn.toFixed(2)}, policy suppression ${trendSummary.avgPolicySuppressionRate.toFixed(2)}, cycle time ${trendSummary.avgCycleTimeMs.toFixed(0)}ms.`,
        relatedIds: [],
        score: trendSummary.avgBeliefChurn + trendSummary.avgPolicySuppressionRate + (trendDirection === "worsening" ? 0.5 : 0),
        severity: trendDirection === "worsening" ? "high" : "medium",
      })
      trendFindings = 1
    }

    // ── Cap to limit ──
    const capped = findings.length > REFLECTION_FINDING_LIMIT
    const limitedFindings = findings
      .sort((a, b) => b.score - a.score)
      .slice(0, REFLECTION_FINDING_LIMIT)

    const report: ReflectionJobReport = {
      jobsRun: 3,
      blockerFindings,
      contradictionFindings,
      trendFindings,
      totalFindings: findings.length,
      capped,
    }

    const digest = limitedFindings.length === 0
      ? "No significant reflection findings this cycle."
      : `${findings.length} reflection finding(s): ${limitedFindings.slice(0, 2).map((finding) => finding.title).join("; ")}`

    return {
      timestamp,
      digest,
      dominantPhase: hotspots.dominantPhase,
      report,
      findings: limitedFindings,
    }
  })
}
