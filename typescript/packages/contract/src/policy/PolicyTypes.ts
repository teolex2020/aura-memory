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
}
