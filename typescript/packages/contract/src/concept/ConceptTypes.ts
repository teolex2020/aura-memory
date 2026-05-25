/**
 * Controls how beliefs are clustered into concepts.
 *
 * 控制 belief 如何聚类形成 concept。
 */
export type ConceptSimilarityMode = "SdrTanimoto" | "CanonicalFeature"

/**
 * Controls concept seed selection gates.
 *
 * 控制 concept 的 seed（belief）筛选阈值。
 */
export type ConceptSeedMode = "Standard" | "Warmup" | "Relaxed"

/**
 * Controls how belief seeds are partitioned before concept clustering.
 *
 * 控制 concept 聚类前如何对 seed beliefs 分区。
 */
export type ConceptPartitionMode = "Standard" | "NamespaceOnly"

/**
 * Controls comparison-only union relaxations inside concept clustering.
 *
 * 控制 concept 聚类时的“合并放宽策略”（实验性）。
 */
export type ConceptUnionMode = "Standard" | "SingleTagFactDecisionBridge"

export type ConceptId = string

/**
 * Lifecycle state of a concept candidate.
 *
 * concept 候选的生命周期状态。
 */
export type ConceptState = "Stable" | "Candidate" | "Rejected"

/**
 * A discovered concept candidate.
 *
 * 一个被发现的 concept 候选（派生状态，不是源事实）。
 */
export type ConceptCandidate = {
  readonly id: ConceptId
  readonly key: string
  readonly namespace: string
  readonly semantic_type: string

  readonly belief_ids: ReadonlyArray<string>
  readonly record_ids: ReadonlyArray<string>

  readonly core_terms: ReadonlyArray<string>
  readonly shell_terms: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>

  readonly support_mass: number
  readonly confidence: number
  readonly stability: number
  readonly cohesion: number
  readonly abstraction_score: number

  readonly state: ConceptState
  readonly last_updated: number
}

/**
 * Snapshot of the full concept engine state.
 *
 * ConceptEngine 的全量状态快照（用于持久化/回放/下游层）。
 */
export type ConceptEngineState = {
  readonly version: 1
  readonly concepts: Readonly<Record<string, ConceptCandidate>>
  readonly key_index: Readonly<Record<string, string>>

  readonly seed_mode: ConceptSeedMode
  readonly similarity_mode: ConceptSimilarityMode
  readonly partition_mode: ConceptPartitionMode
  readonly union_mode: ConceptUnionMode
}

/**
 * Report from a single concept discovery cycle.
 *
 * 每次 concept discover 周期返回的统计报告（用于 trace/观测）。
 */
export type ConceptReport = {
  readonly seeds_found: number
  readonly candidates_found: number
  readonly stable_count: number
  readonly rejected_count: number
  readonly avg_abstraction_score: number

  readonly centroids_built: number
  readonly partitions_with_multiple_seeds: number
  readonly multi_seed_partition_sizes: ReadonlyArray<number>
  readonly cluster_sizes: ReadonlyArray<number>
  readonly clusters_with_multiple_beliefs: number
  readonly largest_cluster_size: number
  readonly pairwise_comparisons: number
  readonly pairwise_above_threshold: number
  readonly tanimoto_min: number
  readonly tanimoto_max: number
  readonly tanimoto_avg: number
  readonly tanimoto_p50: number
  readonly tanimoto_p95: number
  readonly avg_centroid_size: number
  readonly seeds_capped: number
}

