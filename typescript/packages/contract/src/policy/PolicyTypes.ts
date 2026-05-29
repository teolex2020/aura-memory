export type PolicyHintId = string

/**
 * Lifecycle state of a policy hint.
 *
 * 策略提示的生命周期状态。
 */
export enum PolicyState {
  Candidate = "Candidate",
  Stable = "Stable",
  Suppressed = "Suppressed",
  Rejected = "Rejected"
}

/**
 * Kinds of policy actions — maps to Rust PolicyActionKind enum.
 *
 * 策略动作类型枚举。
 *
 * CONTRACT: This MUST be a TypeScript string enum (not an ad hoc string union).
 * PROJECT RULE D-22: All enum-like Rust equivalents use TS string enums.
 */
export enum PolicyActionKind {
  Avoid = "avoid",
  VerifyFirst = "verify_first",
  Prefer = "prefer",
  Recommend = "recommend",
  Warn = "warn"
}

/**
 * Polarity classification from effect-side record analysis.
 *
 * CONTRACT: This MUST be a TypeScript string enum (not an ad hoc string union).
 * PROJECT RULE D-22: All enum-like Rust equivalents use TS string enums.
 */
export enum Polarity {
  Positive = "Positive",
  Negative = "Negative",
  Neutral = "Neutral"
}

/**
 * A policy hint extracted from causal patterns — rule/guidance for the MCP layer.
 *
 * 从因果模式中提取的策略提示（向 MCP 层提供的规则/指导）。
 */
export type PolicyHint = {
  /** Unique hint ID. 提示唯一标识。 */
  readonly id: PolicyHintId
  /** Source causal pattern ID, or null if derived from multiple. 来源因果模式 ID，若源自多个则为 null。 */
  readonly pattern_id: string | null
  /** Human-readable condition description. 条件描述。 */
  readonly condition: string
  /** Recommended action. 推荐动作。 */
  readonly action: string
  /** Priority score (higher = more influential). 优先级分数（越高越重要）。 */
  readonly priority: number
  /** Confidence in this hint. 置信度。 */
  readonly confidence: number
  /** Current lifecycle state. 当前生命周期状态。 */
  readonly state: PolicyState
  /** Unix timestamp of last update. 最近更新时间（秒）。 */
  readonly last_updated: number
  /** Action kind from PolicyActionKind enum. 策略动作类型。 */
  readonly actionKind: PolicyActionKind
  /** Policy strength score (0–1). 策略强度分数。 */
  readonly policyStrength: number
  /** Risk score — higher means more risk if ignored. 风险分数。 */
  readonly riskScore: number
  /** Namespace this hint belongs to. 所属命名空间。 */
  readonly namespace: string
  /** Domain classification. 域分类。 */
  readonly domain: string

  // ── New Rust-aligned fields (D-22) ──
  /** Polarity classification from effect-side record analysis. 效果侧record分析得出的极性分类。 */
  readonly polarity: Polarity
  /** Human-readable recommendation text (template-based, matching Rust 5 templates). 推荐文本。 */
  readonly recommendation: string
  /** Utility score — expected benefit if hint is followed. 效用分数（遵循提示的预期收益）。 */
  readonly utilityScore: number
  /** Composite key for the cause side (namespace:cause_belief_key:effect_belief_key:edge_hash). */
  readonly cause_key: string
  /** Record IDs on the effect side — used for polarity signal extraction. 效果侧record ID列表。 */
  readonly effect_keys: ReadonlyArray<string>
  /** Record IDs on the cause side — used for suppression conflict detection. 原因侧record ID列表。 */
  readonly cause_record_ids: ReadonlyArray<string>
}

/**
 * Snapshot of the full policy engine state for persistence/downstream layers.
 *
 * PolicyEngine 的全量状态快照（用于持久化/下游层）。
 */
export type PolicyEngineState = {
  readonly version: 1
  readonly hints: Readonly<Record<string, PolicyHint>>
  readonly metadata: Readonly<Record<string, unknown>>
  /** Key index — maps key strings to hint IDs for fast namespace/domain lookup. */
  readonly key_index: Readonly<Record<string, string>>
}

/**
 * Per-cycle report from PolicyEngine.discover for trace/observability.
 *
 * 每次 policy discover 周期返回的统计报告（用于 trace/观测）。
 */
export type PolicyReport = {
  readonly hints_found: number
  readonly hints_active: number
  readonly hints_suppressed: number
  readonly avg_confidence: number

  // ── New Rust-aligned report fields (D-22) ──
  /** Number of causal pattern seeds evaluated. 评估的因果模式种子数。 */
  readonly seeds_found: number
  /** Number of hints promoted to Stable state. 晋升为Stable的提示数。 */
  readonly stable_hints: number
  /** Number of hints suppressed due to conflict. 因冲突被抑制的提示数。 */
  readonly suppressed_hints: number
  /** Number of hints rejected by evidence/confidence gates. 因证据/置信度门被拒绝的提示数。 */
  readonly rejected_hints: number
  /** Average policy strength across all generated hints. 所有生成提示的平均策略强度。 */
  readonly avg_policy_strength: number
}
