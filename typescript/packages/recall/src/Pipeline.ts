import { Effect, Option } from "effect"
import {
  BoundedReranker,
  Clock,
  EmbeddingQueryError,
  EmbeddingStore,
  FinalizeError,
  RecallFinalizer,
  RecallViewTag,
  RerankError,
  TrustConfigTag,
  serviceOption,
  type RecallScored,
  type RecallView
} from "@aura/contract"
import { SDRInterpreter } from "./SDRInterpreter"
import type { RecallPipelineOptions, RecallRecord, RankedList, Scored } from "./Types"
import { rrfFuse } from "./RRF"
import { causalWalk } from "./CausalWalk"
import { graphWalk } from "./GraphWalk"
import { collectEmbedding, collectNgram, collectSdr, collectTags } from "./Signals"
import { computeEffectiveTrust, defaultTrustConfig } from "./Trust"
import { SdrInterpreterError } from "./Errors"

const DEFAULT_NAMESPACE = "default"

let defaultSdrPromise: Promise<SDRInterpreter> | undefined

function getDefaultSdr(): Effect.Effect<SDRInterpreter, SdrInterpreterError> {
  defaultSdrPromise ??= SDRInterpreter.default()
  return Effect.tryPromise({
    try: () => defaultSdrPromise!,
    catch: (cause) => new SdrInterpreterError({ cause })
  })
}

function asRecord(raw: unknown): RecallRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Record<string, unknown>
  if (typeof o.id !== "string") return undefined
  return o as unknown as RecallRecord
}

function strengthOf(rec: RecallRecord): number {
  return typeof rec.strength === "number" && Number.isFinite(rec.strength) ? rec.strength : 1
}

function metadataOf(rec: RecallRecord): Record<string, string> {
  const m = rec.metadata
  if (!m || typeof m !== "object") return {}
  return m
}

function sourceTypeOf(rec: RecallRecord): string {
  return typeof rec.source_type === "string" && rec.source_type.length > 0 ? rec.source_type : "recorded"
}

function normalizeOptions(options?: Partial<RecallPipelineOptions>): RecallPipelineOptions {
  return {
    topK: options?.topK ?? 30,
    minStrength: options?.minStrength ?? 0,
    expandConnections: options?.expandConnections ?? true,
    namespaces: options?.namespaces ?? [DEFAULT_NAMESPACE],
    sessionId: options?.sessionId
  }
}

function applyRecencyScoring(
  view: RecallView,
  scored: Scored,
  topK: number,
  nowUnixSec: number,
  config: import("@aura/contract").TrustConfig
): Scored {
  // SIMPLE IMPLEMENTATION: 只在最终排序前乘以 strength 与 computeEffectiveTrust，之后按分数降序截断。
  // FULL IMPLEMENTATION: 对齐 Rust [apply_recency_scoring](file:///workspace/src/recall.rs#L514-L535) 的数值稳定性、以及 trace 模式中的中间量记录。
  for (let i = 0; i < scored.length; i++) {
    const [baseScore, rid] = scored[i]!
    const raw = view.records.get(rid)
    const rec = asRecord(raw)
    if (!rec) continue
    const mult = strengthOf(rec) * computeEffectiveTrust(metadataOf(rec), nowUnixSec, config, sourceTypeOf(rec))
    scored[i] = [baseScore * mult, rid]
  }

  scored.sort((a, b) => b[0] - a[0])
  if (scored.length > topK) scored.length = Math.max(0, topK)
  return scored
}

export function recallPipeline(
  query: string,
  options?: Partial<RecallPipelineOptions>
): Effect.Effect<
  RecallScored,
  SdrInterpreterError | EmbeddingQueryError | RerankError | FinalizeError,
  RecallViewTag
> {
  // SIMPLE IMPLEMENTATION: Signals(SDR/NGram/Tags + optional Embedding) → RRF → GraphWalk/CausalWalk → trust scoring → optional rerank/finalize。
  // FULL IMPLEMENTATION: 对齐 Rust [recall_pipeline](file:///workspace/src/recall.rs#L725-L792) 的 trace、性能与更多信号/策略（belief/concept/causal/policy）。
  const opts = normalizeOptions(options)

  return Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    const clock = yield* Effect.service(Clock)
    const nowUnixSec = clock.nowSeconds()

    const sdr = yield* getDefaultSdr()

    const sdrRanked = collectSdr(view, sdr, query, opts.topK, opts.namespaces)
    const ngramRanked = collectNgram(view, query, opts.topK, opts.namespaces)
    const tagRanked = collectTags(view, query, opts.topK, opts.namespaces)

    const embeddingOpt = yield* serviceOption(EmbeddingStore)
    const embeddingRanked = Option.isSome(embeddingOpt)
      ? yield* collectEmbedding(view, embeddingOpt.value, query, opts.topK, opts.namespaces)
      : ([] as RankedList)

    const rankedLists: RankedList[] = []
    if (sdrRanked.length > 0) rankedLists.push(sdrRanked)
    if (ngramRanked.length > 0) rankedLists.push(ngramRanked)
    if (tagRanked.length > 0) rankedLists.push(tagRanked)
    if (embeddingRanked.length > 0) rankedLists.push(embeddingRanked)

    if (rankedLists.length === 0) return [] as RecallScored

    let matched: Scored = rrfFuse(view.records, rankedLists, opts.minStrength, opts.topK, opts.namespaces)

    if (opts.expandConnections) {
      matched = graphWalk(view, matched, opts.minStrength, opts.namespaces)
      matched = causalWalk(view, matched, opts.minStrength, opts.namespaces)
    }

    const trustOpt = yield* serviceOption(TrustConfigTag)
    const trustConfig = Option.isSome(trustOpt) ? trustOpt.value : defaultTrustConfig()

    matched = applyRecencyScoring(view, matched, opts.topK, nowUnixSec, trustConfig)

    const rerankerOpt = yield* serviceOption(BoundedReranker)
    if (Option.isSome(rerankerOpt)) {
      const reranked = yield* rerankerOpt.value.rerank(matched, query)
      matched = Array.from(reranked)
    }

    const finalizerOpt = yield* serviceOption(RecallFinalizer)
    if (Option.isSome(finalizerOpt)) {
      yield* finalizerOpt.value.finalize(matched, opts.sessionId)
    }

    return matched
  })
}
