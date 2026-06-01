/**
 * Controls causal pattern discovery mode.
 *
 * 控制因果模式发现模式。
 */
export enum CausalDiscoveryMode {
  Standard = "Standard",
  Strict = "Strict"
}

/**
 * Controls temporal edge budgeting during edge extraction.
 *
 * 控制时序边提取时的预算策略。
 *
 * Rust original name: `TemporalEdgeBudgetMode`.
 */
export enum TemporalBudgetMode {
  ExhaustiveCapped = "ExhaustiveCapped",
  NearbySuccessors = "NearbySuccessors"
}

/**
 * Controls evidence quality gating for causal pattern promotion.
 *
 * 控制因果模式晋升的证据质量守卫策略。
 */
export enum EvidenceMode {
  StrictRepeatedWindows = "StrictRepeatedWindows",
  TemporalClusterRecovery = "TemporalClusterRecovery",
  ExplicitTrusted = "ExplicitTrusted"
}

export type CausalPatternId = string

/**
 * Lifecycle state of a causal pattern.
 *
 * 因果模式的生命周期状态。
 */
export enum CausalState {
  Candidate = "Candidate",
  Stable = "Stable",
  Rejected = "Rejected",
  Invalidated = "Invalidated"
}

/**
 * Edge derivation kind for causal edges.
 *
 * CONTRACT: This MUST be a TypeScript string enum (not an ad hoc string union).
 * PROJECT RULE D-22: All enum-like Rust equivalents use TS string enums.
 */
export enum CausalEdgeKind {
  Explicit = "explicit",
  ExplicitCausal = "explicit_causal",
  Temporal = "temporal"
}

/**
 * A record-level causal edge extracted from explicit links or temporal proximity.
 *
 * record 级别的因果边（来自显式链接或时序临近）。
 */
export type CausalEdge = {
  /** Source record ID (cause). 原因 record ID。 */
  readonly cause_record_id: string
  /** Target record ID (effect). 结果 record ID。 */
  readonly effect_record_id: string
  /** Namespace for scope isolation. 命名空间（范围隔离）。 */
  readonly namespace: string
  /** Edge derivation kind. 边的来源类型。 */
  readonly edge_kind: CausalEdgeKind
  /** Time gap in seconds between cause and effect (for temporal edges). 时序边的时间间隔（秒）。 */
  readonly gap_seconds: number
  /** Unix timestamp when this edge was extracted. 边提取时间戳（秒）。 */
  readonly created_at: number
}

/**
 * A discovered causal pattern — (cause → effect) at belief level.
 *
 * 一个被发现的因果模式（belief 级别的 cause → effect）。
 */
export type CausalPattern = {
  /** Unique pattern ID. 模式唯一标识。 */
  readonly id: CausalPatternId

  // ── Belief-level anchors (replaces concept-level antecedent/consequent) ──
  /** Belief ID of the cause side. 原因侧的 Belief ID。 */
  readonly cause_belief_id: string
  /** Belief ID of the effect side. 结果侧的 Belief ID。 */
  readonly effect_belief_id: string
  /** Rust stable pattern key: namespace:cause_belief_key→effect_belief_key. */
  readonly cause_key: string
  /** Effect-side composite key. */
  readonly effect_key: string
  /** Deterministic hash over contributing edges. 贡献边的确定性哈希。 */
  readonly edge_hash: string

  // ── Core statistics (retained from prior contract) ──
  /** Number of co-occurrence observations. 共现观测次数。 */
  readonly support: number
  /** Confidence score — P(effect | cause). 置信度得分。 */
  readonly confidence: number
  /** Lift score — P(effect | cause) / P(effect). 提升度得分。 */
  readonly lift: number
  /** Current lifecycle state. 当前生命周期状态。 */
  readonly state: CausalState
  /** Unix timestamp of last update. 最近更新时间（秒）。 */
  readonly last_updated: number

  // ── Advanced scoring (matching Rust causal.rs 20+ fields) ──
  /** Transition lift — P(effect | cause) / P(effect), min-max normalized to [0,1]. */
  readonly transition_lift: number
  /** Temporal consistency — positive_gaps / total_pairs. */
  readonly temporal_consistency: number
  /** Outcome stability — 1 - (variance / mean). */
  readonly outcome_stability: number
  /** Weighted combination of all sub-scores. 综合因果强度。 */
  readonly causal_strength: number

  // ── Counters ──
  /** Total raw edge count contributing to this pattern. */
  readonly support_count: number
  /** Explicit-only edge count (non-temporal). */
  readonly explicit_support_count: number
  /** Temporal-only edge count. */
  readonly temporal_support_count: number
  /** Number of edges that contradict the causal direction. */
  readonly counterevidence_count: number
  /** Unique temporal windows observed. */
  readonly temporal_windows: number

  // ── Rust-aligned counter/gate fields (populated by aggregateToPatterns) ──
  /** Total explicit support across all explicit effect variants for this cause. */
  readonly explicit_support_total_for_cause: number
  /** Number of distinct explicit effect variants seen for this cause. */
  readonly explicit_effect_variants_for_cause: number

  // ── Scoring-computed fields (populated by scorePattern) ──
  /** Number of distinct effect-record signature variants inside this pattern. */
  readonly effect_record_signature_variants: number
  /** Positive outcome signals observed across effect-side records. */
  readonly positive_effect_signals: number
  /** Negative outcome signals observed across effect-side records. */
  readonly negative_effect_signals: number

  // ── Metadata ──
  /** Namespace for scope isolation. 命名空间（范围隔离）。 */
  readonly namespace: string

  // ── Provenance (for PolicyEngine suppression conflict detection) ──
  /** Record IDs on the cause side — provenance for Policy suppression (needed by Plans 09-10). */
  readonly cause_record_ids: ReadonlyArray<string>
  /** Record IDs on the effect side — provenance for Policy polarity classification (needed by Plans 09-10). */
  readonly effect_record_ids: ReadonlyArray<string>
}

/**
 * Snapshot of the full causal engine state for persistence/downstream layers.
 *
 * CausalEngine 的全量状态快照（用于持久化/下游层）。
 */
export type CausalEngineState = {
  readonly version: 1
  readonly patterns: Readonly<Record<string, CausalPattern>>
  readonly discovery_mode: CausalDiscoveryMode

  /** Running total of edges extracted across all cycles. */
  readonly edges_found_total: number
  /** Current temporal budgeting strategy. */
  readonly temporal_budget_mode: TemporalBudgetMode
  /** Current evidence gating strategy. */
  readonly evidence_mode: EvidenceMode
  /** Fingerprint of the last processed corpus — used for skip detection. */
  readonly last_corpus_fingerprint: string
}

/**
 * Per-cycle report from CausalEngine.discover for trace/observability.
 *
 * 每次 causal discover 周期返回的统计报告（用于 trace/观测）。
 */
export type CausalReport = {
  // Core pattern stats (retained)
  readonly patterns_found: number
  readonly patterns_active: number
  readonly patterns_invalidated: number
  readonly avg_confidence: number
  readonly avg_lift: number

  // Edge extraction stats
  readonly explicit_edges: number
  readonly temporal_edges: number
  readonly temporal_namespaces_scanned: number
  readonly temporal_pairs_considered: number
  readonly temporal_pairs_skipped_by_budget: number
  readonly temporal_edges_capped: number
  readonly temporal_namespaces_hit_cap: number

  // Evidence gate stats
  readonly patterns_meeting_support_gate: number
  readonly patterns_meeting_repeated_window_gate: number
  readonly patterns_meeting_counterfactual_gate: number
  readonly patterns_blocked_by_evidence_gates: number
  readonly patterns_blocked_by_counterfactual_gate: number
  readonly avg_causal_strength: number
  readonly stable_count: number
  readonly rejected_count: number
}
