/**
 * Rust-facing MCP DTO contract.
 *
 * Rust reference:
 * - `../src/aura.rs`
 * - `../src/api_groups.rs`
 * - `../src/background_brain.rs`
 *
 * Phase 7 MCP payloads intentionally use Rust/serde field names. Existing
 * internal TS inspection types remain camelCase; these DTOs are the external
 * MCP serialization contract.
 */

/** RecallBeliefExplanation: Rust `crate::aura::RecallBeliefExplanation`. */
export type RecallBeliefExplanation = {
  readonly id: string
  readonly state: string
  readonly confidence: number
  readonly support_mass: number
  readonly conflict_mass: number
  readonly stability: number
  readonly volatility: number
  readonly has_unresolved_evidence: boolean
}

/** RecallConceptExplanation: Rust `crate::aura::RecallConceptExplanation`. */
export type RecallConceptExplanation = {
  readonly id: string
  readonly key: string
  readonly state: string
  readonly confidence: number
}

/** RecallCausalExplanation: Rust `crate::aura::RecallCausalExplanation`. */
export type RecallCausalExplanation = {
  readonly id: string
  readonly key: string
  readonly state: string
  readonly causal_strength: number
  readonly invalidation_reason: string | null
  readonly invalidated_at: number | null
  readonly corrections: ReadonlyArray<CorrectionLogEntry>
}

/** RecallPolicyExplanation: Rust `crate::aura::RecallPolicyExplanation`. */
export type RecallPolicyExplanation = {
  readonly id: string
  readonly key: string
  readonly state: string
  readonly action_kind: string
  readonly policy_strength: number
}

/** RecallSignalScore: Rust `crate::aura::RecallSignalScore`. */
export type RecallSignalScore = {
  readonly raw_score: number
  readonly rank: number
  readonly rrf_share: number
}

/** RecallTraceScore: Rust `crate::aura::RecallTraceScore`. */
export type RecallTraceScore = {
  readonly sdr: RecallSignalScore | null
  readonly ngram: RecallSignalScore | null
  readonly tags: RecallSignalScore | null
  readonly embedding: RecallSignalScore | null
  readonly rrf_score: number
  readonly graph_score: number
  readonly causal_score: number
  readonly pre_trust_score: number
  readonly trust_multiplier: number
  readonly pre_rerank_score: number
  readonly rerank_delta: number
  readonly final_score: number
}

/** HonestAnswerSupport: Rust `crate::aura::HonestAnswerSupport`. */
export type HonestAnswerSupport = {
  readonly significance_phrase: string | null
  readonly uncertainty_phrase: string | null
  readonly contradiction_phrase: string | null
  readonly reflection_phrase: string | null
  readonly recommended_framing: string
}

/** RecallExplanationItem: Rust `crate::aura::RecallExplanationItem`. */
export type RecallExplanationItem = {
  readonly rank: number
  readonly record_id: string
  readonly score: number
  readonly namespace: string
  readonly salience: number
  readonly salience_reason: string | null
  readonly salience_explanation: string | null
  readonly content_preview: string
  readonly because_record_id: string | null
  readonly because_preview: string | null
  readonly belief: RecallBeliefExplanation | null
  readonly has_unresolved_evidence: boolean
  readonly honesty_note: string | null
  readonly contradiction_dependency: boolean
  readonly reflection_references: ReadonlyArray<string>
  readonly answer_support: HonestAnswerSupport
  readonly concepts: ReadonlyArray<RecallConceptExplanation>
  readonly causal_patterns: ReadonlyArray<RecallCausalExplanation>
  readonly policy_hints: ReadonlyArray<RecallPolicyExplanation>
  readonly trace: RecallTraceScore
}

/** RecallExplanation: Rust `crate::aura::RecallExplanation`. */
export type RecallExplanation = {
  readonly query: string
  readonly top_k: number
  readonly result_count: number
  readonly latency_ms: number
  readonly belief_rerank_mode: string
  readonly concept_surface_mode: string
  readonly causal_rerank_mode: string
  readonly policy_rerank_mode: string
  readonly items: ReadonlyArray<RecallExplanationItem>
}

/** CrossNamespaceConceptSummary: Rust `crate::aura::CrossNamespaceConceptSummary`. */
export type CrossNamespaceConceptSummary = {
  readonly concept_id: string
  readonly key: string
  readonly confidence: number
  readonly state: string
  readonly record_count: number
  readonly belief_count: number
}

/** CrossNamespaceBeliefStateSummary: Rust `crate::aura::CrossNamespaceBeliefStateSummary`. */
export type CrossNamespaceBeliefStateSummary = {
  readonly resolved: number
  readonly unresolved: number
  readonly singleton: number
  readonly empty: number
  readonly high_volatility_count: number
  readonly avg_volatility: number
}

/** CrossNamespaceNamespaceDigest: Rust `crate::aura::CrossNamespaceNamespaceDigest`. */
export type CrossNamespaceNamespaceDigest = {
  readonly namespace: string
  readonly record_count: number
  readonly concept_count: number
  readonly stable_concept_count: number
  readonly top_concepts: ReadonlyArray<CrossNamespaceConceptSummary>
  readonly concept_signatures: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly structural_relation_types: ReadonlyArray<string>
  readonly causal_signatures: ReadonlyArray<string>
  readonly belief_state_summary: CrossNamespaceBeliefStateSummary | null
  readonly correction_count: number | null
  readonly correction_density: number | null
}

/** CrossNamespacePairDigest: Rust `crate::aura::CrossNamespacePairDigest`. */
export type CrossNamespacePairDigest = {
  readonly namespace_a: string
  readonly namespace_b: string
  readonly shared_concept_signatures: ReadonlyArray<string>
  readonly concept_signature_similarity: number
  readonly shared_tags: ReadonlyArray<string>
  readonly tag_jaccard: number
  readonly shared_structural_relation_types: ReadonlyArray<string>
  readonly structural_similarity: number
  readonly shared_causal_signatures: ReadonlyArray<string>
  readonly causal_signature_similarity: number
}

/** CrossNamespaceDigestOptions: Rust `crate::aura::CrossNamespaceDigestOptions`. */
export type CrossNamespaceDigestOptions = {
  readonly min_record_count: number
  readonly top_concepts_limit: number
  readonly pairwise_similarity_threshold: number
  readonly compact_summary: boolean
  readonly include_concepts: boolean
  readonly include_tags: boolean
  readonly include_structural: boolean
  readonly include_causal: boolean
  readonly include_belief_states: boolean
  readonly include_corrections: boolean
}

/** Rust `Default for CrossNamespaceDigestOptions`. */
export const defaultCrossNamespaceDigestOptions = (): CrossNamespaceDigestOptions => ({
  min_record_count: 1,
  top_concepts_limit: 5,
  pairwise_similarity_threshold: 0,
  compact_summary: false,
  include_concepts: true,
  include_tags: true,
  include_structural: true,
  include_causal: true,
  include_belief_states: true,
  include_corrections: true
})

/** CrossNamespaceDigest: Rust `crate::aura::CrossNamespaceDigest`. */
export type CrossNamespaceDigest = {
  readonly namespace_count: number
  readonly latency_ms: number
  readonly compact_summary: boolean
  readonly included_dimensions: ReadonlyArray<string>
  readonly namespaces: ReadonlyArray<CrossNamespaceNamespaceDigest>
  readonly pairs: ReadonlyArray<CrossNamespacePairDigest>
}

/** Rust-supported cross-namespace dimension flags. */
export enum CrossNamespaceDimensionFlag {
  Concepts = "concepts",
  Tags = "tags",
  Structural = "structural",
  Causal = "causal",
  BeliefStates = "belief_states",
  Corrections = "corrections",
}

/** Canonical dimension names accepted by Rust MCP docs. */
export const crossNamespaceDimensionFlags = [
  CrossNamespaceDimensionFlag.Concepts,
  CrossNamespaceDimensionFlag.Tags,
  CrossNamespaceDimensionFlag.Structural,
  CrossNamespaceDimensionFlag.Causal,
  CrossNamespaceDimensionFlag.BeliefStates,
  CrossNamespaceDimensionFlag.Corrections
] as const

/**
 * Normalize Rust aliases from `apply_cross_namespace_dimension_flags`.
 *
 * Rust reference: `../src/aura.rs::apply_cross_namespace_dimension_flags`.
 */
export function normalizeCrossNamespaceDimensionFlag(input: string): CrossNamespaceDimensionFlag | null {
  switch (input.trim().toLowerCase()) {
    case "concepts":
      return CrossNamespaceDimensionFlag.Concepts
    case "tags":
      return CrossNamespaceDimensionFlag.Tags
    case "structural":
      return CrossNamespaceDimensionFlag.Structural
    case "causal":
      return CrossNamespaceDimensionFlag.Causal
    case "beliefs":
    case "belief_state":
    case "belief_states":
      return CrossNamespaceDimensionFlag.BeliefStates
    case "corrections":
    case "correction_density":
      return CrossNamespaceDimensionFlag.Corrections
    default:
      return null
  }
}

/**
 * TS equivalent of Rust `apply_cross_namespace_dimension_flags`.
 *
 * Unknown dimensions are ignored to preserve Rust MCP behavior.
 */
export function applyCrossNamespaceDimensionFlags(
  options: CrossNamespaceDigestOptions,
  includeDimensions: ReadonlyArray<string> | null | undefined
): CrossNamespaceDigestOptions {
  if (!includeDimensions) return options

  const enabled = new Set<CrossNamespaceDimensionFlag>()
  for (const dimension of includeDimensions) {
    const normalized = normalizeCrossNamespaceDimensionFlag(dimension)
    if (normalized !== null) enabled.add(normalized)
  }

  return {
    ...options,
    include_concepts: enabled.has(CrossNamespaceDimensionFlag.Concepts),
    include_tags: enabled.has(CrossNamespaceDimensionFlag.Tags),
    include_structural: enabled.has(CrossNamespaceDimensionFlag.Structural),
    include_causal: enabled.has(CrossNamespaceDimensionFlag.Causal),
    include_belief_states: enabled.has(CrossNamespaceDimensionFlag.BeliefStates),
    include_corrections: enabled.has(CrossNamespaceDimensionFlag.Corrections)
  }
}

/** ProvenanceChain: Rust `crate::aura::ProvenanceChain`. */
export type ProvenanceChain = {
  readonly record_id: string
  readonly namespace: string
  readonly content_preview: string
  readonly build_latency_ms: number
  readonly because_record_id: string | null
  readonly because_preview: string | null
  readonly belief: RecallBeliefExplanation | null
  readonly concepts: ReadonlyArray<RecallConceptExplanation>
  readonly causal_patterns: ReadonlyArray<RecallCausalExplanation>
  readonly policy_hints: ReadonlyArray<RecallPolicyExplanation>
  readonly steps: ReadonlyArray<string>
  readonly narrative: string
}

/** BeliefVolatilityBands: Rust `crate::epistemic_runtime::BeliefVolatilityBands`. */
export type McpBeliefVolatilityBands = {
  readonly low: number
  readonly medium: number
  readonly high: number
}

/** BeliefInstabilitySummary: Rust `crate::epistemic_runtime::BeliefInstabilitySummary`. */
export type McpBeliefInstabilitySummary = {
  readonly total_beliefs: number
  readonly resolved: number
  readonly unresolved: number
  readonly singleton: number
  readonly empty: number
  readonly contradiction_cluster_count: number
  readonly high_volatility_count: number
  readonly low_stability_count: number
  readonly avg_volatility: number
  readonly avg_stability: number
  readonly volatility_bands: McpBeliefVolatilityBands
}

/** PolicyActionSummary: Rust `crate::epistemic_runtime::PolicyActionSummary`. */
export type McpPolicyActionSummary = {
  readonly action_kind: string
  readonly total_hints: number
  readonly stable_hints: number
  readonly candidate_hints: number
  readonly suppressed_hints: number
  readonly rejected_hints: number
  readonly avg_policy_strength: number
  readonly avg_risk_score: number
}

/** PolicyDomainSummary: Rust `crate::epistemic_runtime::PolicyDomainSummary`. */
export type McpPolicyDomainSummary = {
  readonly namespace: string
  readonly domain: string
  readonly total_hints: number
  readonly active_hints: number
  readonly stable_hints: number
  readonly candidate_hints: number
  readonly suppressed_hints: number
  readonly rejected_hints: number
  readonly avg_policy_strength: number
  readonly avg_risk_score: number
  readonly advisory_pressure: number
}

/** PolicyPressureArea: Rust `crate::epistemic_runtime::PolicyPressureArea`. */
export type McpPolicyPressureArea = {
  readonly namespace: string
  readonly domain: string
  readonly advisory_pressure: number
  readonly active_hints: number
  readonly suppressed_hints: number
  readonly rejected_hints: number
  readonly strongest_hint_id: string
  readonly strongest_action_kind: string
  readonly strongest_policy_strength: number
}

/** PolicyLifecycleSummary: Rust `crate::epistemic_runtime::PolicyLifecycleSummary`. */
export type McpPolicyLifecycleSummary = {
  readonly total_hints: number
  readonly active_hints: number
  readonly stable_hints: number
  readonly candidate_hints: number
  readonly suppressed_hints: number
  readonly rejected_hints: number
  readonly avg_policy_strength: number
  readonly avg_risk_score: number
  readonly action_summaries: ReadonlyArray<McpPolicyActionSummary>
  readonly domain_summaries: ReadonlyArray<McpPolicyDomainSummary>
}

/** CorrectionLogEntry: Rust `crate::aura::CorrectionLogEntry`. */
export type CorrectionLogEntry = {
  readonly timestamp: number
  readonly time_iso: string
  readonly target_kind: string
  readonly target_id: string
  readonly operation: string
  readonly reason: string
  readonly session_id: string
}

/** OperatorReviewIssue: Rust `crate::aura::OperatorReviewIssue`. */
export type OperatorReviewIssue = {
  readonly kind: string
  readonly target_id: string
  readonly namespace: string
  readonly title: string
  readonly score: number
  readonly severity: string
}

/** CorrectionReviewCandidate: Rust `crate::aura::CorrectionReviewCandidate`. */
export type CorrectionReviewCandidate = {
  readonly timestamp: number
  readonly time_iso: string
  readonly target_kind: string
  readonly target_id: string
  readonly operation: string
  readonly reason: string
  readonly session_id: string
  readonly namespace: string
  readonly title: string
  readonly repeat_count: number
  readonly dependent_causal_patterns: number
  readonly dependent_policy_hints: number
  readonly downstream_impact: number
  readonly priority_score: number
  readonly severity: string
}

/** ContradictionReviewCandidate: Rust `crate::aura::ContradictionReviewCandidate`. */
export type ContradictionReviewCandidate = {
  readonly cluster_id: string
  readonly namespace: string
  readonly title: string
  readonly belief_ids: ReadonlyArray<string>
  readonly belief_keys: ReadonlyArray<string>
  readonly record_ids: ReadonlyArray<string>
  readonly shared_tags: ReadonlyArray<string>
  readonly unresolved_belief_count: number
  readonly high_volatility_belief_count: number
  readonly dependent_causal_patterns: number
  readonly dependent_policy_hints: number
  readonly downstream_impact: number
  readonly total_conflict_mass: number
  readonly avg_volatility: number
  readonly avg_stability: number
  readonly priority_score: number
  readonly severity: string
}

/** SuggestedCorrection: Rust `crate::aura::SuggestedCorrection`. */
export type SuggestedCorrection = {
  readonly target_kind: string
  readonly target_id: string
  readonly namespace: string
  readonly reason_kind: string
  readonly suggested_action: string
  readonly reason_detail: string
  readonly priority_score: number
  readonly severity: string
  readonly supporting_record_id: string | null
  readonly provenance: ProvenanceChain | null
}

/** SuggestedCorrectionsReport: Rust `crate::aura::SuggestedCorrectionsReport`. */
export type SuggestedCorrectionsReport = {
  readonly scan_latency_ms: number
  readonly entries: ReadonlyArray<SuggestedCorrection>
}

/** NamespaceGovernanceStatus: Rust `crate::aura::NamespaceGovernanceStatus`. */
export type NamespaceGovernanceStatus = {
  readonly namespace: string
  readonly record_count: number
  readonly belief_count: number
  readonly correction_count: number
  readonly correction_density: number
  readonly high_volatility_belief_count: number
  readonly low_stability_belief_count: number
  readonly instability_score: number
  readonly instability_level: string
  readonly policy_pressure_area_count: number
  readonly suggested_correction_count: number
  readonly last_maintenance_cycle: string | null
  readonly latest_dominant_phase: string
}

/** MemoryHealthDigest: Rust `crate::aura::MemoryHealthDigest`. */
export type MemoryHealthDigest = {
  readonly total_records: number
  readonly startup_has_recovery_warnings: boolean
  readonly high_salience_record_count: number
  readonly avg_salience: number
  readonly max_salience: number
  readonly reflection_summary_count: number
  readonly reflection_high_severity_findings: number
  readonly contradiction_cluster_count: number
  readonly high_volatility_belief_count: number
  readonly low_stability_belief_count: number
  readonly recent_correction_count: number
  readonly suppressed_policy_hint_count: number
  readonly rejected_policy_hint_count: number
  readonly policy_pressure_area_count: number
  readonly maintenance_trend_direction: string
  readonly latest_dominant_phase: string
  readonly top_issues: ReadonlyArray<OperatorReviewIssue>
}

/** MaintenanceTrendSnapshot: Rust `crate::background_brain::MaintenanceTrendSnapshot`. */
export type McpMaintenanceTrendSnapshot = {
  readonly timestamp: string
  readonly total_records: number
  readonly records_archived: number
  readonly insights_found: number
  readonly volatile_records: number
  readonly belief_churn: number
  readonly causal_rejection_rate: number
  readonly policy_suppression_rate: number
  readonly feedback_beliefs_touched: number
  readonly feedback_net_confidence_delta: number
  readonly feedback_net_volatility_delta: number
  readonly correction_events: number
  readonly cumulative_corrections: number
  readonly cycle_time_ms: number
  readonly dominant_phase: string
}

/** MaintenanceTrendSummary: Rust `crate::background_brain::MaintenanceTrendSummary`. */
export type McpMaintenanceTrendSummary = {
  readonly snapshot_count: number
  readonly recent: ReadonlyArray<McpMaintenanceTrendSnapshot>
  readonly avg_belief_churn: number
  readonly avg_causal_rejection_rate: number
  readonly avg_policy_suppression_rate: number
  readonly avg_cycle_time_ms: number
  readonly avg_correction_events: number
  readonly total_corrections_in_window: number
  readonly latest_dominant_phase: string
}

/** ReflectionFinding: Rust `crate::background_brain::ReflectionFinding`. */
export type McpReflectionFinding = {
  readonly kind: string
  readonly namespace: string
  readonly title: string
  readonly detail: string
  readonly related_ids: ReadonlyArray<string>
  readonly score: number
  readonly severity: string
}

/** ReflectionJobReport: Rust `crate::background_brain::ReflectionJobReport`. */
export type McpReflectionJobReport = {
  readonly jobs_run: number
  readonly blocker_findings: number
  readonly contradiction_findings: number
  readonly trend_findings: number
  readonly total_findings: number
  readonly capped: boolean
}

/** ReflectionSummary: Rust `crate::background_brain::ReflectionSummary`. */
export type McpReflectionSummary = {
  readonly timestamp: string
  readonly digest: string
  readonly dominant_phase: string
  readonly report: McpReflectionJobReport
  readonly findings: ReadonlyArray<McpReflectionFinding>
}

/** ReflectionKindSummary: Rust `crate::background_brain::ReflectionKindSummary`. */
export type McpReflectionKindSummary = {
  readonly kind: string
  readonly count: number
  readonly high_severity_count: number
  readonly avg_score: number
}

/** ReflectionDigest: Rust `crate::background_brain::ReflectionDigest`. */
export type McpReflectionDigest = {
  readonly summary_count: number
  readonly total_findings: number
  readonly high_severity_findings: number
  readonly latest_timestamp: string
  readonly latest_dominant_phase: string
  readonly kinds: ReadonlyArray<McpReflectionKindSummary>
  readonly namespaces: ReadonlyArray<string>
  readonly top_findings: ReadonlyArray<McpReflectionFinding>
}

/** ExplainabilityBundle: Rust `crate::aura::ExplainabilityBundle`. */
export type ExplainabilityBundle = {
  readonly record_id: string
  readonly explanation: RecallExplanationItem
  readonly provenance: ProvenanceChain
  readonly record_corrections: ReadonlyArray<CorrectionLogEntry>
  readonly belief_corrections: ReadonlyArray<CorrectionLogEntry>
  readonly causal_corrections: ReadonlyArray<CorrectionLogEntry>
  readonly policy_corrections: ReadonlyArray<CorrectionLogEntry>
  readonly belief_instability: McpBeliefInstabilitySummary
  readonly reflection_digest: McpReflectionDigest
  readonly related_reflection_findings: ReadonlyArray<McpReflectionFinding>
  readonly maintenance_trends: McpMaintenanceTrendSummary
}
