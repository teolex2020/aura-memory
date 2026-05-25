export type BeliefId = string
export type HypothesisId = string

// Resolution state of a belief.
// 信念（Belief）的决议状态。
export enum BeliefState {
  Resolved = "Resolved",
  Unresolved = "Unresolved",
  Singleton = "Singleton",
  Empty = "Empty"
}

// An aggregated epistemic position on a claim.
// 对某个 claim 的聚合认识立场（将多个 hypotheses 组织起来，可能决议出 winner，也可能保持不确定）。
export type Belief = {
  /** Unique belief ID. 信念唯一标识。 */
  readonly id: BeliefId
  /**
   * Canonical key — identifies the claim this belief addresses.
   * 规范化 key——标识该 belief 讨论的 claim。
   */
  readonly key: string
  /** Hypothesis IDs belonging to this belief. 该 belief 下的 hypothesis 列表。 */
  readonly hypothesis_ids: ReadonlyArray<HypothesisId>
  /** Current winning hypothesis ID (if resolved). 当前 winner hypothesis（若已决议），否则为空。 */
  readonly winner_id: string | null
  /** Current belief state. 当前状态（Resolved/Unresolved/Singleton/Empty）。 */
  readonly state: BeliefState
  /** Best hypothesis score. 最强 hypothesis 的分数（用于排序/影响）。 */
  readonly score: number
  /** Weighted confidence across hypotheses. 聚合置信度。 */
  readonly confidence: number
  /** Total support mass across all hypotheses. 支持质量总和。 */
  readonly support_mass: number
  /** Total conflict mass across all hypotheses. 冲突质量总和。 */
  readonly conflict_mass: number
  /** Stability — how many cycles the winner has remained the same. 稳定性（winner 连续保持的周期数）。 */
  readonly stability: number
  /** Epistemic instability caused by contradictory top-down pressure. 波动/不稳定度（保留字段，用于后续 parity）。 */
  readonly volatility: number
  /** Unix timestamp of last update. 最近更新时间（秒）。 */
  readonly last_updated: number
}

// A single hypothesis within a belief — one possible "truth" for a claim.
// Belief 内的单个 hypothesis——对同一个 claim 的一种可能“真实版本”（由一簇 records 支撑）。
export type Hypothesis = {
  /** Unique hypothesis ID. 假设唯一标识。 */
  readonly id: HypothesisId
  /** Parent belief ID. 所属 belief。 */
  readonly belief_id: BeliefId
  /** Record IDs that support this hypothesis (prototype records). 支撑该假设的原型 records。 */
  readonly prototype_record_ids: ReadonlyArray<string>
  /** Weighted average confidence of supporting records. 支撑 records 的平均置信度。 */
  readonly confidence: number
  /** Aggregated support mass. 支持质量聚合值。 */
  readonly support_mass: number
  /** Aggregated conflict mass. 冲突质量聚合值。 */
  readonly conflict_mass: number
  /** Recency factor — exponential decay from most recent record. 新近度因子（后续 parity 可实现衰减）。 */
  readonly recency: number
  /** Internal consistency — 1/(1 + variance of record confidences). 内部一致性（后续 parity 可实现）。 */
  readonly consistency: number
  /** Composite score (higher = stronger hypothesis). 综合得分。 */
  readonly score: number
}

// Snapshot of the full belief engine state.
// BeliefEngine 的全量状态快照（用于持久化/回放/下游发现层）。
export type BeliefEngineState = {
  readonly version: 1
  readonly beliefs: Readonly<Record<string, Belief>>
  readonly hypotheses: Readonly<Record<string, Hypothesis>>
  readonly record_to_belief: Readonly<Record<string, string>>
}

// Per-cycle report returned by BeliefEngine.update/update_with_sdr.
// 每次更新返回的统计报告（用于 trace/观测）。
export type BeliefReport = {
  readonly coarse_groups: number
  readonly beliefs_built: number
  readonly hypotheses_built: number
}
