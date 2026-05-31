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
    sessionId: options?.sessionId,
    boundedRerankModes: options?.boundedRerankModes
  }
}

/**
 * Apply trust-aware recency weighting and sort.
 *
 * 应用 trust-aware recency 权重并排序。
 *
 * Uses `compute_effective_trust()` which factors in:
 * - Source authority (user > agent > autonomous)
 * - Recency boost (fresh records get +boost, decays over half_life)
 * - Base trust score from provenance
 * - Source type factor (recorded > retrieved > inferred > generated)
 *
 * Final score = rrf_score × strength × effective_trust
 * Rust reference: `apply_recency_scoring` (`../src/recall.rs`).
 */
function applyRecencyScoring(
  view: RecallView,
  scored: Scored,
  topK: number,
  nowUnixSec: number,
  config: import("@aura/contract").TrustConfig
): Scored {
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

/**
 * Full recall pipeline.
 * 完整召回管线。
 *
 * `embeddingRanked` is an optional 4th signal from pluggable embeddings.
 * 可选 embedding 作为第四路信号参与 RRF。
 *
 * `trustConfig` is used for recency boost + source authority scoring.
 * trustConfig 用于 recency boost 与 source authority 评分。
 * Rust reference: `recall_pipeline` (`../src/recall.rs`).
 */
export function recallPipeline(
  query: string,
  options?: Partial<RecallPipelineOptions>
): Effect.Effect<
  RecallScored,
  SdrInterpreterError | EmbeddingQueryError | RerankError | FinalizeError,
  RecallViewTag
> {
  const opts = normalizeOptions(options)

  return Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    const clock = yield* Effect.service(Clock)
    const nowUnixSec = clock.nowSeconds()

    const sdr = yield* getDefaultSdr()

    // 1. Collect signals
    // 1. 收集信号
    const sdrRanked = collectSdr(view, sdr, query, opts.topK, opts.namespaces)
    const ngramRanked = collectNgram(view, query, opts.topK, opts.namespaces)
    const tagRanked = collectTags(view, query, opts.topK, opts.namespaces)

    const embeddingOpt = yield* serviceOption(EmbeddingStore)
    const embeddingRanked = Option.isSome(embeddingOpt)
      ? yield* collectEmbedding(embeddingOpt.value, query, opts.topK)
      : ([] as RankedList)

    // 2. RRF Fuse
    // 2. RRF 融合
    const rankedLists: RankedList[] = []
    if (sdrRanked.length > 0) rankedLists.push(sdrRanked)
    if (ngramRanked.length > 0) rankedLists.push(ngramRanked)
    if (tagRanked.length > 0) rankedLists.push(tagRanked)
    if (embeddingRanked.length > 0) rankedLists.push(embeddingRanked)

    if (rankedLists.length === 0) return [] as RecallScored

    let matched: Scored = rrfFuse(view.records, rankedLists, opts.minStrength, opts.topK, opts.namespaces)

    // 3. Graph expansion
    // 3. 图扩展
    if (opts.expandConnections) {
      matched = graphWalk(view, matched, opts.minStrength, opts.namespaces)
      matched = causalWalk(view, matched, opts.minStrength, opts.namespaces)
    }

    const trustOpt = yield* serviceOption(TrustConfigTag)
    const trustConfig = Option.isSome(trustOpt) ? trustOpt.value : defaultTrustConfig()

    // 4. Trust-aware recency-weighted scoring
    // 4. trust-aware recency 加权评分
    matched = applyRecencyScoring(view, matched, opts.topK, nowUnixSec, trustConfig)

    const rerankerOpt = yield* serviceOption(BoundedReranker)
    if (Option.isSome(rerankerOpt)) {
      const rerankContext = opts.boundedRerankModes === undefined
        ? { topK: opts.topK }
        : { topK: opts.topK, modes: opts.boundedRerankModes }
      const reranked = yield* rerankerOpt.value.rerank(matched, query, rerankContext)
      matched = Array.from(reranked)
    }

    const finalizerOpt = yield* serviceOption(RecallFinalizer)
    if (Option.isSome(finalizerOpt)) {
      yield* finalizerOpt.value.finalize(matched, opts.sessionId)
    }

    return matched
  })
}
