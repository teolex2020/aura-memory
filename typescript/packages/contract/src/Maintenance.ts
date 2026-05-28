import type { Ref } from "effect"
import type { ConceptSurfaceTelemetry } from "./EpistemicInspection"
import type { ReflectionSummary } from "./EpistemicInspection"

// ═══════════════════════════════════════════════════════════════════════
// Section 1 — Config
// ═══════════════════════════════════════════════════════════════════════

/** Configurable archival rule for a tag category. */
export type ArchivalRule = {
  /** Tag to match. */
  readonly tag: string
  /** Maximum age in days before deletion. */
  readonly maxAgeDays: number
  /** Keep at least this many most-recent records. */
  readonly keepRecent: number
}

/** Completed archival rule — only deletes completed/done items. */
export type CompletedArchivalRule = {
  readonly tag: string
  readonly maxAgeDays: number
}

/** User-configurable maintenance settings. */
export type MaintenanceConfig = {
  readonly decayEnabled: boolean
  readonly reflectEnabled: boolean
  readonly insightsEnabled: boolean
  readonly consolidationEnabled: boolean
  readonly synthesisEnabled: boolean
  readonly archivalEnabled: boolean
  /** Run level fix every Nth cycle. */
  readonly levelFixInterval: number
  /** Max clusters per consolidation run. */
  readonly maxClustersPerRun: number
  /** Configurable archival rules. */
  readonly archivalRules: ReadonlyArray<ArchivalRule>
  /** Completed-item archival rules. */
  readonly completedArchivalRules: ReadonlyArray<CompletedArchivalRule>
  /** Tag used for scheduled tasks. */
  readonly taskTag: string
}

export const defaultMaintenanceConfig: MaintenanceConfig = {
  decayEnabled: true,
  reflectEnabled: true,
  insightsEnabled: true,
  consolidationEnabled: true,
  synthesisEnabled: true,
  archivalEnabled: true,
  levelFixInterval: 10,
  maxClustersPerRun: 3,
  archivalRules: [
    { tag: "web-search-cache", maxAgeDays: 1, keepRecent: 0 },
    { tag: "autonomous-outcome", maxAgeDays: 7, keepRecent: 50 },
    { tag: "session-summary", maxAgeDays: 14, keepRecent: 20 },
    { tag: "proactive-session", maxAgeDays: 7, keepRecent: 20 },
    { tag: "action-plan", maxAgeDays: 14, keepRecent: 10 },
    { tag: "session-reflection", maxAgeDays: 30, keepRecent: 50 },
    { tag: "research-finding", maxAgeDays: 30, keepRecent: 100 },
    { tag: "consolidated-meta", maxAgeDays: 90, keepRecent: 200 },
    { tag: "research-project", maxAgeDays: 90, keepRecent: 50 },
    { tag: "feedback-signal", maxAgeDays: 14, keepRecent: 50 },
  ],
  completedArchivalRules: [
    { tag: "todo-item", maxAgeDays: 30 },
    { tag: "scheduled-task", maxAgeDays: 30 },
  ],
  taskTag: "scheduled-task",
}

// ═══════════════════════════════════════════════════════════════════════
// Section 2 — Internal phase result types
// ═══════════════════════════════════════════════════════════════════════

/** Result from the initial maintenance phases (level_fix → decay → reflect → epistemic → insights). */
export type InitialMaintenancePhaseResult = {
  readonly totalRecords: number
  readonly decay: DecayReport
  readonly reflect: ReflectReport
  readonly epistemic: EpistemicPhaseReport
  readonly insightsFound: number
}

/** Result from the discovery phases (belief → concept | causal → policy → feedback). */
export type DiscoveryPhaseResult = {
  readonly belief: BeliefPhaseReport
  readonly concept: ConceptPhaseReport
  readonly causal: CausalPhaseReport
  readonly policy: PolicyPhaseReport
  readonly feedback: FeedbackAuditReport
}

/** Result from the post-discovery phases (consolidation → cross_connections → task_reminders → archival). */
export type PostDiscoveryPhaseResult = {
  readonly consolidation: ConsolidationReport
  readonly crossConnections: number
  readonly taskReminders: ReadonlyArray<string>
  readonly recordsArchived: number
}

/** Effect Ref-based telemetry counters for the concept inspection surface. */
export type ConceptSurfaceCounters = {
  readonly globalCalls: Ref.Ref<number>
  readonly namespaceCalls: Ref.Ref<number>
  readonly recordCalls: Ref.Ref<number>
  readonly conceptsReturned: Ref.Ref<number>
  readonly recordAnnotationsReturned: Ref.Ref<number>
}

// ═══════════════════════════════════════════════════════════════════════
// Section 3 — Phase data types
// ═══════════════════════════════════════════════════════════════════════

/** Per-phase timing in milliseconds. */
export type PhaseTimings = {
  /** Phase 0: Level fix (ms). */
  readonly levelFixMs: number
  /** Phase 1: Decay (ms). */
  readonly decayMs: number
  /** Phase 2: Reflect (ms). */
  readonly reflectMs: number
  /** Phase 2.5: Epistemic update (ms). */
  readonly epistemicMs: number
  /** Phase 3: Insights (ms). */
  readonly insightsMs: number
  /** SDR lookup build (ms) — shared by belief/concept/causal. */
  readonly sdrBuildMs: number
  /** Phase 3.5: Belief update (ms). */
  readonly beliefMs: number
  /** Phase 3.7: Concept discovery (ms). */
  readonly conceptMs: number
  /** Phase 3.8: Causal discovery (ms). */
  readonly causalMs: number
  /** Phase 3.9: Policy discovery (ms). */
  readonly policyMs: number
  /** Phase 4: Consolidation (ms). */
  readonly consolidationMs: number
  /** Phase 5: Cross-connections (ms). */
  readonly crossConnectionsMs: number
  /** Phase 6+7: Tasks + archival (ms). */
  readonly tasksArchivalMs: number
  /** Total cycle time (ms). */
  readonly totalMs: number
}

/** Per-layer identity churn counters. */
export type LayerChurn = {
  readonly retained: number
  readonly newCount: number
  readonly dropped: number
  readonly churn: number
}

/** Cross-cycle identity stability for all four layers. */
export type LayerStability = {
  readonly belief: LayerChurn
  readonly concept: LayerChurn
  readonly causal: LayerChurn
  readonly policy: LayerChurn
}

// ═══════════════════════════════════════════════════════════════════════
// Section 4 — Report types
// ═══════════════════════════════════════════════════════════════════════

/** Decay phase report. */
export type DecayReport = {
  readonly decayed: number
  readonly archived: number
}

/** Reflect phase report. */
export type ReflectReport = {
  readonly promoted: number
  readonly archived: number
}

/** Epistemic phase report — support/conflict propagation from local graph structure. */
export type EpistemicPhaseReport = {
  /** Number of records whose epistemic state changed this cycle. */
  readonly updatedRecords: number
  /** Sum of confirming neighbor counts across all live records. */
  readonly totalSupportLinks: number
  /** Sum of conflicting neighbor counts across all live records. */
  readonly totalConflictLinks: number
  /** Number of records with materially non-zero volatility after the update. */
  readonly volatileRecords: number
}

/** Belief phase report — epistemic layer stats from a single maintenance cycle. */
export type BeliefPhaseReport = {
  readonly beliefsCreated: number
  readonly beliefsPruned: number
  readonly revisions: number
  readonly resolved: number
  readonly unresolved: number
  readonly totalBeliefs: number
  readonly totalHypotheses: number
  readonly churnRate: number
}

/** Concept phase report — concept discovery stats from a single maintenance cycle. */
export type ConceptPhaseReport = {
  readonly seedsFound: number
  readonly candidatesFound: number
  readonly stableCount: number
  readonly rejectedCount: number
  readonly avgAbstractionScore: number
  readonly centroidsBuilt: number
  readonly partitionsWithMultipleSeeds: number
  readonly multiSeedPartitionSizes: ReadonlyArray<number>
  readonly clusterSizes: ReadonlyArray<number>
  readonly clustersWithMultipleBeliefs: number
  readonly largestClusterSize: number
  readonly pairwiseComparisons: number
  readonly pairwiseAboveThreshold: number
  readonly tanimotoMin: number
  readonly tanimotoMax: number
  readonly tanimotoAvg: number
  readonly avgCentroidSize: number
  readonly seedsCapped: number
}

/** Causal phase report — causal pattern discovery stats from a single maintenance cycle. */
export type CausalPhaseReport = {
  readonly skipped: boolean
  readonly edgesFound: number
  readonly explicitEdgesFound: number
  readonly temporalEdgesFound: number
  readonly temporalNamespacesScanned: number
  readonly temporalPairsConsidered: number
  readonly temporalPairsSkippedByBudget: number
  readonly temporalEdgesCapped: number
  readonly temporalNamespacesHitCap: number
  readonly candidatesFound: number
  readonly patternsMeetingSupportGate: number
  readonly patternsMeetingRepeatedWindowGate: number
  readonly patternsMeetingCounterfactualGate: number
  readonly patternsBlockedByEvidenceGates: number
  readonly patternsBlockedByCounterfactualGate: number
  readonly stableCount: number
  readonly rejectedCount: number
  readonly avgCausalStrength: number
}

/** Policy phase report — policy hint discovery stats from a single maintenance cycle. */
export type PolicyPhaseReport = {
  readonly seedsFound: number
  readonly hintsFound: number
  readonly stableHints: number
  readonly suppressedHints: number
  readonly rejectedHints: number
  readonly avgPolicyStrength: number
}

/** Single feedback audit event emitted by the belief feedback pass. */
export type FeedbackAuditEntry = {
  readonly beliefId: string
  readonly sourceKind: string
  readonly sourceId: string
  readonly reason: string
  readonly deltaRequested: number
  readonly deltaApplied: number
  readonly confidenceBefore: number
  readonly confidenceAfter: number
  readonly volatilityBefore: number
  readonly volatilityAfter: number
  readonly volatilityDeltaApplied: number
  readonly stabilityBefore: number
  readonly stabilityAfter: number
  readonly stabilityDeltaApplied: number
}

/** Feedback audit summary for a maintenance cycle. */
export type FeedbackAuditReport = {
  readonly beliefsTouched: number
  readonly beliefsBoosted: number
  readonly beliefsDampened: number
  readonly netConfidenceDelta: number
  readonly netVolatilityDelta: number
  readonly entries: ReadonlyArray<FeedbackAuditEntry>
}

/** Consolidation phase report. */
export type ConsolidationReport = {
  readonly nativeMerged: number
  readonly clustersFound: number
  readonly metaCreated: number
}

// ═══════════════════════════════════════════════════════════════════════
// Section 5 — Enums
// ═══════════════════════════════════════════════════════════════════════

/** Runtime surface mode for the bounded concept inspection surface. */
export enum ConceptSurfaceMode {
  Off = "Off",
  Inspect = "Inspect",
  Limited = "Limited",
}

// ═══════════════════════════════════════════════════════════════════════
// Section 6 — Hotspots and Trends
// ═══════════════════════════════════════════════════════════════════════

/** Maintenance hot-spot accounting for scalability visibility. */
export type MaintenanceHotspots = {
  readonly recordsBeforeCycle: number
  readonly recordsAfterCycle: number
  readonly beliefSnapshotRecords: number
  readonly sdrSourceBytes: number
  readonly sdrVectorsBuilt: number
  readonly sdrVectorsComputed: number
  readonly sdrVectorsReused: number
  readonly beliefTotalBeliefs: number
  readonly beliefTotalHypotheses: number
  readonly conceptPairwiseComparisons: number
  readonly conceptPartitionsWithMultipleSeeds: number
  readonly causalEdgesFound: number
  readonly causalExplicitEdgesFound: number
  readonly causalTemporalEdgesFound: number
  readonly causalTemporalNamespacesScanned: number
  readonly causalTemporalPairsConsidered: number
  readonly causalTemporalPairsSkippedByBudget: number
  readonly causalTemporalEdgesCapped: number
  readonly causalTemporalNamespacesHitCap: number
  readonly policySeedsFound: number
  readonly crossConnectionsFound: number
  readonly taskRemindersFound: number
  readonly dominantPhase: string
  readonly dominantPhaseMs: number
  readonly dominantPhaseShare: number
}

/** Persisted bounded maintenance trend snapshot for one cycle. */
export type MaintenanceTrendSnapshot = {
  readonly timestamp: string
  readonly totalRecords: number
  readonly recordsArchived: number
  readonly insightsFound: number
  readonly volatileRecords: number
  readonly beliefChurn: number
  readonly causalRejectionRate: number
  readonly policySuppressionRate: number
  readonly feedbackBeliefsTouched: number
  readonly feedbackNetConfidenceDelta: number
  readonly feedbackNetVolatilityDelta: number
  readonly correctionEvents: number
  readonly cumulativeCorrections: number
  readonly cycleTimeMs: number
  readonly dominantPhase: string
}

/** Bounded trend summary across recent maintenance cycles. */
export type MaintenanceTrendSummary = {
  readonly snapshotCount: number
  readonly recent: ReadonlyArray<MaintenanceTrendSnapshot>
  readonly avgBeliefChurn: number
  readonly avgCausalRejectionRate: number
  readonly avgPolicySuppressionRate: number
  readonly avgCycleTimeMs: number
  readonly avgCorrectionEvents: number
  readonly totalCorrectionsInWindow: number
  readonly latestDominantPhase: string
}

// ═══════════════════════════════════════════════════════════════════════
// Section 7 — Top-level report
// ═══════════════════════════════════════════════════════════════════════

/** Full maintenance cycle report. */
export type MaintenanceReport = {
  readonly timestamp: string
  readonly decay: DecayReport
  readonly reflect: ReflectReport
  readonly epistemic: EpistemicPhaseReport
  readonly insightsFound: number
  readonly belief: BeliefPhaseReport
  readonly concept: ConceptPhaseReport
  readonly causal: CausalPhaseReport
  readonly policy: PolicyPhaseReport
  readonly feedback: FeedbackAuditReport
  readonly consolidation: ConsolidationReport
  readonly crossConnections: number
  readonly taskReminders: ReadonlyArray<string>
  readonly recordsArchived: number
  readonly totalRecords: number
  /** Phase 3.6: records injected from the experience queue this cycle. */
  readonly experienceInjected: number
  /** Per-phase timing breakdown. */
  readonly timings: PhaseTimings
  /** Cross-cycle identity stability. */
  readonly stability: LayerStability
  /** Audit/telemetry for the bounded concept inspection surface. */
  readonly conceptSurface: ConceptSurfaceTelemetry
  /** Bounded maintenance-time synthesis emitted for this cycle. */
  readonly reflection: ReflectionSummary
  /** Bounded trend summary across recent maintenance cycles. */
  readonly trendSummary: MaintenanceTrendSummary
  /** Scalability-oriented load and hot-spot accounting. */
  readonly hotspots: MaintenanceHotspots
}
