import { Tag } from "./Context"
import { EmbeddingQueryError, FinalizeError, RerankError } from "./Errors"

import type { Effect } from "effect"

export class RecallViewTag extends Tag("aura.contract.RecallView")<
  RecallViewTag,
  RecallView
>() {}

export type RecallScored = ReadonlyArray<readonly [score: number, recordId: string]>

/**
 * Belief rerank operating mode.
 *
 * Belief 重排序运行模式。
 *
 * Rust reference: `BeliefRerankMode` in `../src/recall.rs`.
 */
export enum BeliefRerankMode {
  Off = "Off",
  Shadow = "Shadow",
  Limited = "Limited"
}

/**
 * Recall reranking mode for causal-pattern-weighted influence.
 *
 * 因果模式影响的召回重排序模式。
 *
 * Rust reference: `CausalRerankMode` in `../src/causal.rs`.
 */
export enum CausalRerankMode {
  Off = "Off",
  Limited = "Limited"
}

/**
 * Recall reranking mode for policy-hint-weighted influence.
 *
 * 策略提示影响的召回重排序模式。
 *
 * Rust reference: `PolicyRerankMode` in `../src/policy.rs`.
 */
export enum PolicyRerankMode {
  Off = "Off",
  Limited = "Limited"
}

export type BoundedRerankContext = {
  /** Requested top_k from the recall call. Rust skips Limited rerank when top_k > 20. */
  readonly topK: number
  /**
   * Runtime bounded rerank modes for this recall call.
   *
   * 本次召回调用使用的 bounded rerank 运行模式。
   *
   * Rust reference: `RecallRerankView` in `../src/recall_service.rs`.
   */
  readonly modes?: Partial<BoundedRerankModes>
  /**
   * Optional diagnostic sink for bounded rerank reports.
   *
   * 可选诊断报告 sink，用于 trace/explainability surface 收集 bounded rerank 信息。
   *
   * Rust reference: `RecallService::shadow_report` and
   * `RecallService::rerank_report` in `../src/recall_service.rs`.
   */
  readonly reportSink?: (report: BoundedRerankReport) => void
}

export type BoundedRerankModes = {
  readonly beliefMode: BeliefRerankMode
  readonly conceptMode: import("./Maintenance").ConceptSurfaceMode
  readonly causalMode: CausalRerankMode
  readonly policyMode: PolicyRerankMode
}

/** Fields shared by Rust limited rerank report variants. */
export type LimitedRerankReportBase = {
  /** Whether limited reranking was actually applied (false if scope guards blocked). */
  readonly was_applied: boolean
  /** Reason reranking was skipped (empty if applied). */
  readonly skip_reason: string
  /** Number of records whose position changed. */
  readonly records_moved: number
  /** Maximum upward positional shift observed. */
  readonly max_up_shift: number
  /** Maximum downward positional shift observed. */
  readonly max_down_shift: number
  /** Top-k overlap: fraction of top-k records shared between baseline and reranked. */
  readonly top_k_overlap: number
  /** Latency of reranking in microseconds. */
  readonly rerank_latency_us: number
}

/**
 * Report from limited belief reranking, capturing what changed.
 *
 * belief limited rerank 报告，字段名保持 Rust 原始命名。
 *
 * Rust reference: `LimitedRerankReport` in `../src/recall.rs`.
 */
export type LimitedRerankReport = LimitedRerankReportBase & {
  /** Average belief multiplier across all records. */
  readonly avg_belief_multiplier: number
  /** Fraction of records that have belief membership. */
  readonly belief_coverage: number
}

/**
 * Report from limited concept reranking.
 *
 * concept limited rerank 报告，字段名保持 Rust 原始命名。
 *
 * Rust reference: `LimitedConceptRerankReport` in `../src/recall.rs`.
 */
export type LimitedConceptRerankReport = LimitedRerankReportBase & {
  readonly avg_concept_multiplier: number
  readonly concept_coverage: number
}

/**
 * Report from limited causal reranking.
 *
 * causal limited rerank 报告，字段名保持 Rust 原始命名。
 *
 * Rust reference: `LimitedCausalRerankReport` in `../src/recall.rs`.
 */
export type LimitedCausalRerankReport = LimitedRerankReportBase & {
  readonly avg_causal_multiplier: number
  readonly causal_coverage: number
}

/**
 * Report from limited policy reranking.
 *
 * policy limited rerank 报告，字段名保持 Rust 原始命名。
 *
 * Rust reference: `LimitedPolicyRerankReport` in `../src/recall.rs`.
 */
export type LimitedPolicyRerankReport = LimitedRerankReportBase & {
  readonly avg_policy_multiplier: number
  readonly policy_coverage: number
}

/**
 * Shadow belief score for a single recalled record.
 *
 * 单条召回记录的 shadow belief score。
 *
 * Rust reference: `ShadowBeliefScore` in `../src/recall.rs`.
 */
export type ShadowBeliefScore = {
  /** Record ID. */
  readonly record_id: string
  /** Original recall score (from trust-aware pipeline). */
  readonly baseline_score: number
  /** Belief-adjusted shadow score (baseline x belief_multiplier). */
  readonly shadow_score: number
  /** Belief multiplier applied (1.0 if no belief membership). */
  readonly belief_multiplier: number
  /** Belief state of the record's belief (None if no belief membership). */
  readonly belief_state: string | null
  /** Belief confidence (0.0 if no belief membership). */
  readonly belief_confidence: number
  /** Position in baseline ranking (0-based). */
  readonly baseline_rank: number
  /** Position in shadow ranking (0-based). */
  readonly shadow_rank: number
  /** Rank change: positive = promoted, negative = demoted. */
  readonly rank_delta: number
}

/**
 * Comparison report: baseline vs shadow ranking.
 *
 * baseline 与 shadow ranking 的对比报告。
 *
 * Rust reference: `ShadowRecallReport` in `../src/recall.rs`.
 */
export type ShadowRecallReport = {
  /** Per-record shadow scores. */
  readonly scores: ReadonlyArray<ShadowBeliefScore>
  /** Top-k overlap: fraction of top-k records shared between baseline and shadow. */
  readonly top_k_overlap: number
  /** Number of records promoted (moved up in shadow ranking). */
  readonly promoted_count: number
  /** Number of records demoted (moved down in shadow ranking). */
  readonly demoted_count: number
  /** Number of records with no rank change. */
  readonly unchanged_count: number
  /** Fraction of recalled records that have belief membership. */
  readonly belief_coverage: number
  /** Average belief multiplier across all records. */
  readonly avg_belief_multiplier: number
  /** Latency of shadow scoring in microseconds. */
  readonly shadow_latency_us: number
}

/**
 * Diagnostic report for one bounded rerank pass.
 *
 * 单次 bounded rerank pass 的诊断报告；TS 侧合并四个 Rust stage report，
 * 但每个 stage 内部字段保持 Rust 原始命名。
 *
 * Rust reference: `RecallRerankView` plus bounded report helpers in
 * `../src/recall_service.rs`.
 */
export type BoundedRerankReport = {
  readonly modes: BoundedRerankModes
  readonly belief?: LimitedRerankReport
  readonly concept?: LimitedConceptRerankReport
  readonly causal?: LimitedCausalRerankReport
  readonly policy?: LimitedPolicyRerankReport
  readonly shadow?: ShadowRecallReport
}

export type RecallView = {
  records: ReadonlyMap<string, unknown>
  auraIndex: ReadonlyMap<string, string>
  auraHeaders: ReadonlyMap<string, { sdr_indices: ReadonlyArray<number> }>
  invertedIndex: {
    search: (bits: ReadonlyArray<number>, topK: number, minOverlap: number) => Array<[string, number]>
  }
  ngramIndex: {
    query: (text: string, topK: number) => Array<[number, string]>
  }
  tagIndex: ReadonlyMap<string, ReadonlySet<string>>
}

export class EmbeddingStore extends Tag("aura.contract.EmbeddingStore")<
  EmbeddingStore,
  {
    query: (text: string, topK: number) => Effect.Effect<Array<[string, number]>, EmbeddingQueryError>
  }
>() {}

export namespace BoundedReranker {
  export interface Interface {
    /**
     * Apply bounded recall reranking after trust-aware recency scoring.
     *
     * 在 trust-aware recency scoring 之后执行有界召回重排序。
     *
     * Rust reference: `RecallService::apply_bounded_reranking`
     * in `../src/recall_service.rs`.
     */
    readonly rerank: (
      scored: RecallScored,
      query: string,
      context?: BoundedRerankContext
    ) => Effect.Effect<RecallScored, RerankError>
  }
}

export class BoundedReranker extends Tag("aura.contract.BoundedReranker")<
  BoundedReranker,
  BoundedReranker.Interface
>() {}

export class RecallFinalizer extends Tag("aura.contract.RecallFinalizer")<
  RecallFinalizer,
  {
    finalize: (scored: RecallScored, sessionId?: string) => Effect.Effect<void, FinalizeError>
  }
>() {}

export type TrustConfig = {
  source_trust: Record<string, number>
  source_authority: Record<string, number>
  recency_boost_max: number
  recency_half_life_days: number
}

export class TrustConfigTag extends Tag("aura.contract.TrustConfig")<
  TrustConfigTag,
  TrustConfig
>() {}
