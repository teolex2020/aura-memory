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
  type BoundedRerankReport,
  type RecallScored,
  type RecallView,
  type TrustConfig,
} from "@aura/contract"
import { causalWalk } from "./CausalWalk"
import { graphWalk } from "./GraphWalk"
import { RRF_K, rrfFuse } from "./RRF"
import { SDRInterpreter } from "./SDRInterpreter"
import { SdrInterpreterError } from "./Errors"
import { collectEmbedding, collectNgram, collectSdr, collectTags } from "./Signals"
import { computeEffectiveTrust, defaultTrustConfig } from "./Trust"
import type { RankedList, RecallPipelineOptions, RecallRecord, Scored } from "./Types"

const DEFAULT_NAMESPACE = "default"

export type RecallSignalName = "sdr" | "ngram" | "tags" | "embedding"

export type RecallSignalEvidence = {
  readonly rawScore: number
  readonly rank: number
  readonly rrfShare: number
}

export type RecallRecordEvidence = {
  readonly signals: Readonly<Partial<Record<RecallSignalName, RecallSignalEvidence>>>
  readonly rrfScore: number
  readonly graphScore: number
  readonly causalScore: number
  readonly preTrustScore: number
  readonly trustMultiplier: number
  readonly preRerankScore: number
  readonly rerankDelta: number
  readonly finalScore: number
}

export type RecallTraceResult = {
  readonly query: string
  readonly scored: RecallScored
  readonly evidence: ReadonlyMap<string, RecallRecordEvidence>
  readonly boundedRerankReport: BoundedRerankReport | null
}

let defaultSdrPromise: Promise<SDRInterpreter> | undefined

function getDefaultSdr(): Effect.Effect<SDRInterpreter, SdrInterpreterError> {
  defaultSdrPromise ??= SDRInterpreter.default()
  return Effect.tryPromise({
    try: () => defaultSdrPromise!,
    catch: (cause) => new SdrInterpreterError({ cause }),
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
  const metadata = rec.metadata
  return metadata && typeof metadata === "object" ? metadata : {}
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
    boundedRerankModes: options?.boundedRerankModes,
  }
}

function blankEvidence(): RecallRecordEvidence {
  return {
    signals: {},
    rrfScore: 0,
    graphScore: 0,
    causalScore: 0,
    preTrustScore: 0,
    trustMultiplier: 1,
    preRerankScore: 0,
    rerankDelta: 0,
    finalScore: 0,
  }
}

function patchEvidence(
  evidence: Map<string, RecallRecordEvidence>,
  recordId: string,
  patch: Partial<Omit<RecallRecordEvidence, "signals">> & {
    readonly signals?: Partial<Record<RecallSignalName, RecallSignalEvidence>>
  },
): void {
  const current = evidence.get(recordId) ?? blankEvidence()
  evidence.set(recordId, {
    ...current,
    ...patch,
    signals: {
      ...current.signals,
      ...(patch.signals ?? {}),
    },
  })
}

function addSignalEvidence(
  evidence: Map<string, RecallRecordEvidence>,
  signal: RecallSignalName,
  list: RankedList,
  rankedListCount: number,
): void {
  const maxPossible = rankedListCount / (RRF_K + 1)
  for (let index = 0; index < list.length; index++) {
    const [recordId, rawScore] = list[index]!
    const rawShare = 1 / (RRF_K + index + 1)
    const rrfShare = maxPossible > 0 ? rawShare / maxPossible : rawShare
    const currentRrfScore = evidence.get(recordId)?.rrfScore ?? 0
    patchEvidence(evidence, recordId, {
      rrfScore: currentRrfScore + rrfShare,
      signals: {
        [signal]: {
          rawScore,
          rank: index,
          rrfShare,
        },
      },
    })
  }
}

function scoreMap(scored: Scored): Map<string, number> {
  const out = new Map<string, number>()
  for (const [score, recordId] of scored) out.set(recordId, score)
  return out
}

function annotateScoreDelta(
  evidence: Map<string, RecallRecordEvidence>,
  before: ReadonlyMap<string, number>,
  after: Scored,
  field: "graphScore" | "causalScore",
): void {
  for (const [score, recordId] of after) {
    const previous = before.get(recordId) ?? 0
    const delta = Math.max(0, score - previous)
    if (delta > 0) patchEvidence(evidence, recordId, { [field]: delta })
  }
}

function applyTraceRecencyScoring(
  view: RecallView,
  scored: Scored,
  topK: number,
  nowUnixSec: number,
  config: TrustConfig,
  evidence: Map<string, RecallRecordEvidence>,
): Scored {
  for (let index = 0; index < scored.length; index++) {
    const [baseScore, recordId] = scored[index]!
    const rec = asRecord(view.records.get(recordId))
    if (!rec) continue
    const trustMultiplier = strengthOf(rec) * computeEffectiveTrust(metadataOf(rec), nowUnixSec, config, sourceTypeOf(rec))
    const trustedScore = baseScore * trustMultiplier
    scored[index] = [trustedScore, recordId]
    patchEvidence(evidence, recordId, {
      preTrustScore: baseScore,
      trustMultiplier,
      preRerankScore: trustedScore,
    })
  }

  scored.sort((a, b) => b[0] - a[0])
  if (scored.length > topK) scored.length = Math.max(0, topK)
  return scored
}

/**
 * Trace-capable recall pipeline.
 * 支持 trace 的召回管线；与 Rust `recall_pipeline_with_trace` 一样独立记录每条 record 的中间分数。
 *
 * Rust reference: `recall_pipeline_with_trace` (`../src/recall.rs`) and `Aura::explain_recall` (`../src/aura.rs`).
 */
export function recallPipelineWithTrace(
  query: string,
  options?: Partial<RecallPipelineOptions>,
): Effect.Effect<
  RecallTraceResult,
  SdrInterpreterError | EmbeddingQueryError | RerankError | FinalizeError,
  RecallViewTag
> {
  const opts = normalizeOptions(options)

  return Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    const clock = yield* Effect.service(Clock)
    const nowUnixSec = clock.nowSeconds()
    const sdr = yield* getDefaultSdr()
    const evidence = new Map<string, RecallRecordEvidence>()

    const sdrRanked = collectSdr(view, sdr, query, opts.topK, opts.namespaces)
    const ngramRanked = collectNgram(view, query, opts.topK, opts.namespaces)
    const tagsRanked = collectTags(view, query, opts.topK, opts.namespaces)
    const embeddingOpt = yield* serviceOption(EmbeddingStore)
    const embeddingRanked = Option.isSome(embeddingOpt)
      ? yield* collectEmbedding(embeddingOpt.value, query, opts.topK)
      : ([] as RankedList)

    const rankedLists: RankedList[] = []
    const namedLists: Array<readonly [RecallSignalName, RankedList]> = []
    if (sdrRanked.length > 0) {
      rankedLists.push(sdrRanked)
      namedLists.push(["sdr", sdrRanked])
    }
    if (ngramRanked.length > 0) {
      rankedLists.push(ngramRanked)
      namedLists.push(["ngram", ngramRanked])
    }
    if (tagsRanked.length > 0) {
      rankedLists.push(tagsRanked)
      namedLists.push(["tags", tagsRanked])
    }
    if (embeddingRanked.length > 0) {
      rankedLists.push(embeddingRanked)
      namedLists.push(["embedding", embeddingRanked])
    }

    if (rankedLists.length === 0) {
      return { query, scored: [] as RecallScored, evidence, boundedRerankReport: null }
    }

    for (const [signal, list] of namedLists) {
      addSignalEvidence(evidence, signal, list, rankedLists.length)
    }

    let matched: Scored = rrfFuse(view.records, rankedLists, opts.minStrength, opts.topK, opts.namespaces)
    for (const [rrfScore, recordId] of matched) patchEvidence(evidence, recordId, { rrfScore })

    if (opts.expandConnections) {
      const beforeGraph = scoreMap(matched)
      matched = graphWalk(view, matched, opts.minStrength, opts.namespaces)
      annotateScoreDelta(evidence, beforeGraph, matched, "graphScore")

      const beforeCausal = scoreMap(matched)
      matched = causalWalk(view, matched, opts.minStrength, opts.namespaces)
      annotateScoreDelta(evidence, beforeCausal, matched, "causalScore")
    }

    const trustOpt = yield* serviceOption(TrustConfigTag)
    const trustConfig = Option.isSome(trustOpt) ? trustOpt.value : defaultTrustConfig()
    matched = applyTraceRecencyScoring(view, matched, opts.topK, nowUnixSec, trustConfig, evidence)

    const beforeRerank = scoreMap(matched)
    let boundedRerankReport: BoundedRerankReport | null = null
    const rerankerOpt = yield* serviceOption(BoundedReranker)
    if (Option.isSome(rerankerOpt)) {
      const reranked = yield* rerankerOpt.value.rerank(matched, query, {
        topK: opts.topK,
        ...(opts.boundedRerankModes === undefined ? {} : { modes: opts.boundedRerankModes }),
        reportSink: (report) => {
          boundedRerankReport = report
        },
      })
      matched = Array.from(reranked)
    }

    for (const [finalScore, recordId] of matched) {
      const preRerankScore = beforeRerank.get(recordId) ?? 0
      patchEvidence(evidence, recordId, {
        preRerankScore,
        rerankDelta: finalScore - preRerankScore,
        finalScore,
      })
    }

    const finalizerOpt = yield* serviceOption(RecallFinalizer)
    if (Option.isSome(finalizerOpt)) {
      yield* finalizerOpt.value.finalize(matched, opts.sessionId)
    }

    return { query, scored: matched, evidence, boundedRerankReport }
  })
}
