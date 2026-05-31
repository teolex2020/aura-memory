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
}

export type BoundedRerankModes = {
  readonly beliefMode: BeliefRerankMode
  readonly conceptMode: import("./Maintenance").ConceptSurfaceMode
  readonly causalMode: CausalRerankMode
  readonly policyMode: PolicyRerankMode
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
