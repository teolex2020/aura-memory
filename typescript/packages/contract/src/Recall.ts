import { Tag } from "./Context"

export class RecallViewTag extends Tag("aura.contract.RecallView")<
  RecallViewTag,
  RecallView
>() {}

export type RecallScored = ReadonlyArray<readonly [score: number, recordId: string]>

export type RecallView = {
  records: ReadonlyMap<string, any>
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
    query: (text: string, topK: number) => import("effect").Effect.Effect<Array<[string, number]>>
  }
>() {}

export class BoundedReranker extends Tag("aura.contract.BoundedReranker")<
  BoundedReranker,
  {
    rerank: (scored: RecallScored, query: string) => import("effect").Effect.Effect<RecallScored>
  }
>() {}

export class RecallFinalizer extends Tag("aura.contract.RecallFinalizer")<
  RecallFinalizer,
  {
    finalize: (scored: RecallScored, sessionId?: string) => import("effect").Effect.Effect<void>
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
