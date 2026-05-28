import type { ConceptSurfaceMode } from "./Maintenance"

// ═══════════════════════════════════════════════════════════════════════
// Epistemic Inspection Types
// ═══════════════════════════════════════════════════════════════════════

/** Belief volatility distribution across three bands. */
export type BeliefVolatilityBands = {
  readonly low: number
  readonly medium: number
  readonly high: number
}

/** Aggregated belief health summary — includes volatility bands and contradiction count. */
export type BeliefInstabilitySummary = {
  readonly totalBeliefs: number
  readonly resolved: number
  readonly unresolved: number
  readonly singleton: number
  readonly empty: number
  readonly contradictionClusterCount: number
  readonly highVolatilityCount: number
  readonly lowStabilityCount: number
  readonly avgVolatility: number
  readonly avgStability: number
  readonly volatilityBands: BeliefVolatilityBands
}

/** Graph connected component — a cluster of conflicting beliefs sharing records/tags. */
export type ContradictionCluster = {
  readonly id: string
  readonly namespace: string
  readonly beliefIds: ReadonlyArray<string>
  readonly beliefKeys: ReadonlyArray<string>
  readonly recordIds: ReadonlyArray<string>
  readonly sharedTags: ReadonlyArray<string>
  readonly unresolvedBeliefCount: number
  readonly highVolatilityBeliefCount: number
  readonly avgVolatility: number
  readonly avgStability: number
  readonly totalConflictMass: number
  readonly maxConflictMass: number
}

/** Aggregated stats for a single PolicyActionKind across all hints. */
export type PolicyActionSummary = {
  readonly actionKind: string
  readonly totalHints: number
  readonly stableHints: number
  readonly candidateHints: number
  readonly suppressedHints: number
  readonly rejectedHints: number
  readonly avgPolicyStrength: number
  readonly avgRiskScore: number
}

/** Aggregated stats for a single (namespace, domain) pair. */
export type PolicyDomainSummary = {
  readonly namespace: string
  readonly domain: string
  readonly totalHints: number
  readonly activeHints: number
  readonly stableHints: number
  readonly candidateHints: number
  readonly suppressedHints: number
  readonly rejectedHints: number
  readonly avgPolicyStrength: number
  readonly avgRiskScore: number
  readonly advisoryPressure: number
}

/** Advisory pressure hotspot — namespace+domain pair with high suppression/rejection. */
export type PolicyPressureArea = {
  readonly namespace: string
  readonly domain: string
  readonly advisoryPressure: number
  readonly activeHints: number
  readonly suppressedHints: number
  readonly rejectedHints: number
  readonly strongestHintId: string
  readonly strongestActionKind: string
  readonly strongestPolicyStrength: number
}

/** Full policy lifecycle summary — aggregated by action_kind and domain. */
export type PolicyLifecycleSummary = {
  readonly totalHints: number
  readonly activeHints: number
  readonly stableHints: number
  readonly candidateHints: number
  readonly suppressedHints: number
  readonly rejectedHints: number
  readonly avgPolicyStrength: number
  readonly avgRiskScore: number
  readonly actionSummaries: ReadonlyArray<PolicyActionSummary>
  readonly domainSummaries: ReadonlyArray<PolicyDomainSummary>
}

/** Runtime telemetry for the bounded concept inspection surface. */
export type ConceptSurfaceTelemetry = {
  /** Current runtime surface mode: Off, Inspect, or Limited. */
  readonly mode: string
  /** Number of surfaced concepts currently eligible for inspection. */
  readonly surfacedConceptsAvailable: number
  /** Number of namespaces represented in the current surfaced concept set. */
  readonly surfacedNamespaces: number
  /** Global surfaced-concept API calls observed since the previous maintenance cycle. */
  readonly globalCallsSinceLastCycle: number
  /** Namespace-scoped surfaced-concept API calls observed since the previous maintenance cycle. */
  readonly namespaceCallsSinceLastCycle: number
  /** Per-record annotation API calls observed since the previous maintenance cycle. */
  readonly recordCallsSinceLastCycle: number
  /** Total surfaced concepts returned across all surface APIs since the previous maintenance cycle. */
  readonly conceptsReturnedSinceLastCycle: number
  /** Total per-record concept annotations returned since the previous maintenance cycle. */
  readonly recordAnnotationsReturnedSinceLastCycle: number
}

// ═══════════════════════════════════════════════════════════════════════
// Reflection Types
// ═══════════════════════════════════════════════════════════════════════

/** Single bounded reflection finding emitted during maintenance. */
export type ReflectionFinding = {
  readonly kind: string
  readonly namespace: string
  readonly title: string
  readonly detail: string
  readonly relatedIds: ReadonlyArray<string>
  readonly score: number
  readonly severity: "high" | "medium" | "low"
}

/** Compact report about reflection jobs executed in one cycle. */
export type ReflectionJobReport = {
  readonly jobsRun: number
  readonly blockerFindings: number
  readonly contradictionFindings: number
  readonly trendFindings: number
  readonly totalFindings: number
  readonly capped: boolean
}

/** Bounded maintenance-time synthesis summary over one cycle. */
export type ReflectionSummary = {
  readonly timestamp: string
  readonly digest: string
  readonly dominantPhase: string
  readonly report: ReflectionJobReport
  readonly findings: ReadonlyArray<ReflectionFinding>
}

/** Aggregated rollup for one reflection finding kind across recent summaries. */
export type ReflectionKindSummary = {
  readonly kind: string
  readonly count: number
  readonly highSeverityCount: number
  readonly avgScore: number
}

/** Aggregated digest across recent reflection summaries. */
export type ReflectionDigest = {
  readonly summaryCount: number
  readonly totalFindings: number
  readonly highSeverityFindings: number
  readonly latestTimestamp: string
  readonly latestDominantPhase: string
  readonly kinds: ReadonlyArray<ReflectionKindSummary>
  readonly namespaces: ReadonlyArray<string>
  readonly topFindings: ReadonlyArray<ReflectionFinding>
}

// ═══════════════════════════════════════════════════════════════════════
// Surface Types (shared contract types)
// ═══════════════════════════════════════════════════════════════════════

/** A surfaced concept — exposed to external consumers via the inspection surface. */
export type SurfacedConcept = {
  readonly id: string
  readonly key: string
  readonly state: string
  readonly namespace: string
  readonly abstractionScore: number
  readonly beliefCount: number
  readonly recordCount: number
  readonly coreTerms: ReadonlyArray<string>
  readonly recordIds: ReadonlyArray<string>
}

/** A surfaced policy hint — exposed to external consumers via the inspection surface. */
export type SurfacedPolicyHint = {
  readonly id: string
  readonly state: string
  readonly actionKind: string
  readonly namespace: string
  readonly domain: string
  readonly recommendation: string
  readonly policyStrength: number
  readonly riskScore: number
  readonly triggerCausalIds: ReadonlyArray<string>
}
