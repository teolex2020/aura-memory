/**
 * Controls causal pattern discovery mode.
 *
 * 控制因果模式发现模式。
 */
export enum CausalDiscoveryMode {
  Standard = "Standard",
  Strict = "Strict"
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
 * A discovered causal pattern — antecedent concepts → consequent concepts.
 *
 * 一个被发现的因果模式（前件概念 → 后件概念）。
 */
export type CausalPattern = {
  /** Unique pattern ID. 模式唯一标识。 */
  readonly id: CausalPatternId
  /** Concept IDs forming the antecedent (cause). 前件概念 ID 列表（因）。 */
  readonly antecedent_concept_ids: ReadonlyArray<string>
  /** Concept IDs forming the consequent (effect). 后件概念 ID 列表（果）。 */
  readonly consequent_concept_ids: ReadonlyArray<string>
  /** Number of co-occurrence observations. 共现观测次数。 */
  readonly support: number
  /** Confidence score — P(consequent | antecedent). 置信度得分。 */
  readonly confidence: number
  /** Lift score — P(consequent | antecedent) / P(consequent). 提升度得分。 */
  readonly lift: number
  /** Current lifecycle state. 当前生命周期状态。 */
  readonly state: CausalState
  /** Unix timestamp of last update. 最近更新时间（秒）。 */
  readonly last_updated: number
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
}

/**
 * Per-cycle report from CausalEngine.discover for trace/observability.
 *
 * 每次 causal discover 周期返回的统计报告（用于 trace/观测）。
 */
export type CausalReport = {
  readonly patterns_found: number
  readonly patterns_active: number
  readonly patterns_invalidated: number
  readonly avg_confidence: number
  readonly avg_lift: number
}
