import { Tag } from "./Context"
import { EmbeddingQueryError, FinalizeError, RerankError } from "./Errors"

import type { Effect } from "effect"

export class RecallViewTag extends Tag("aura.contract.RecallView")<
  RecallViewTag,
  RecallView
>() {}

export type RecallScored = ReadonlyArray<readonly [score: number, recordId: string]>

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

export class BoundedReranker extends Tag("aura.contract.BoundedReranker")<
  BoundedReranker,
  {
    rerank: (scored: RecallScored, query: string) => Effect.Effect<RecallScored, RerankError>
  }
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
