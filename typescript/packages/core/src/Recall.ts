import { Effect, Layer } from "effect"
import {
  EmbeddingQueryError,
  FileFormatError,
  FileReadError,
  FinalizeError,
  JsonParseError,
  type BoundedRerankModes,
  type FileRead,
  type FileWrite,
  RecallFinalizer,
  RecallViewTag,
  type RecallScored,
  type RecallView,
  RerankError,
  TrustConfigTag,
  type TrustConfig,
} from "@aura/contract"
import { type IndexFormatError } from "@aura/indexing"
import { RecallViewLive } from "@aura/storage"
import {
  recallPipeline,
  recallPipelineWithTrace,
  SdrInterpreterError,
  type RecallPipelineOptions,
  type RecallTraceResult,
} from "@aura/recall"
import { RecallFinalizerFileLive } from "./RecallFinalizer"
import type { RecallSessionTracker } from "./RecallFinalizer"
import { BoundedRerankerFileLive } from "./RecallReranker"

export type RecallHit<TRecord = unknown> = readonly [score: number, record: TRecord]
export { createRecallSessionTracker, endRecallSession } from "./RecallFinalizer"
export type { RecallSessionTracker } from "./RecallFinalizer"

function withTrustConfig<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  trustConfig: TrustConfig | undefined
): Effect.Effect<A, E, R> {
  // Rust passes `Some(&trust_config)` through `RecallPipelineView` for Aura-owned recall paths.
  // Rust reference: `Aura::recall_raw` / `Aura::explain_recall` (`../src/aura.rs`).
  return trustConfig === undefined
    ? effect
    : effect.pipe(Effect.provideService(TrustConfigTag, trustConfig))
}

function createdAtOf(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const value = (raw as { readonly created_at?: unknown }).created_at
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function temporalRecallView(view: RecallView, timestamp: number): RecallView {
  const records = new Map<string, unknown>()
  for (const [id, record] of view.records) {
    const createdAt = createdAtOf(record)
    if (createdAt !== undefined && createdAt <= timestamp) {
      records.set(id, record)
    }
  }

  return { ...view, records }
}

/**
 * Run recallPipeline with storage/RecallViewLive and file-backed RecallFinalizer.
 * 使用 storage/RecallViewLive + 文件持久化 RecallFinalizer 运行 recallPipeline。
 * Rust reference: `Aura::recall_core` / `Aura::recall_finalize` (`../src/aura.rs`).
 */
export function recallScored(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>,
  modes?: Partial<BoundedRerankModes>,
  trustConfig?: TrustConfig,
  sessionTracker?: RecallSessionTracker
): Effect.Effect<
  RecallScored,
  | FileReadError
  | JsonParseError
  | FileFormatError
  | IndexFormatError
  | SdrInterpreterError
  | EmbeddingQueryError
  | RerankError
  | FinalizeError,
  FileRead | FileWrite
> {
  const pipelineOptions = modes === undefined ? options : { ...options, boundedRerankModes: modes }
  return withTrustConfig(recallPipeline(query, pipelineOptions), trustConfig).pipe(Effect.provide(recallCoreLayer(dir, sessionTracker)))
}

/**
 * Run raw recall without bounded rerank/finalize services.
 * 运行 raw recall，不装配 bounded rerank/finalize 服务。
 * Rust reference: `Aura::recall_raw` used by
 * `recall_structured_with_shadow` / `recall_structured_with_rerank_report` (`../src/aura.rs`).
 */
export function recallRawScored(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>,
  trustConfig?: TrustConfig
): Effect.Effect<
  RecallScored,
  | FileReadError
  | JsonParseError
  | FileFormatError
  | IndexFormatError
  | SdrInterpreterError
  | EmbeddingQueryError
  | RerankError
  | FinalizeError,
  FileRead
> {
  return withTrustConfig(recallPipeline(query, options), trustConfig).pipe(Effect.provide(RecallViewLive(dir)))
}

/**
 * Resolve recallPipeline record IDs to records from the same RecallView context.
 * 在同一 Effect 上下文内读取 RecallViewTag，将 recallPipeline 的 recordId 映射为 view.records 的对象。
 *
 * FULL IMPLEMENTATION: 支持返回结构化 DTO（包含命中信号/解释）、并对齐 Rust recall 输出的字段与排序稳定性。
 * Rust reference: `Aura::recall_structured` / `Aura::recall_core` (`../src/aura.rs`).
 */
export function recallRecords<TRecord = unknown>(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>,
  modes?: Partial<BoundedRerankModes>,
  trustConfig?: TrustConfig,
  sessionTracker?: RecallSessionTracker
): Effect.Effect<
  ReadonlyArray<RecallHit<TRecord>>,
  | FileReadError
  | JsonParseError
  | FileFormatError
  | IndexFormatError
  | SdrInterpreterError
  | EmbeddingQueryError
  | RerankError
  | FinalizeError,
  FileRead | FileWrite
> {
  const program = Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    const pipelineOptions = modes === undefined ? options : { ...options, boundedRerankModes: modes }
    const scored = yield* withTrustConfig(recallPipeline(query, pipelineOptions), trustConfig)

    const out: Array<RecallHit<TRecord>> = []
    for (const [score, id] of scored) {
      const rec = view.records.get(id)
      if (rec === undefined) continue
      out.push([score, rec as TRecord])
    }
    return out
  })

  return program.pipe(Effect.provide(recallCoreLayer(dir, sessionTracker)))
}

/**
 * Temporal recall: recall only from records created at or before a given timestamp.
 * 时间召回：仅从创建时间不晚于指定 timestamp 的记录中召回。
 *
 * Answers the question: "What did the agent know at time X?"
 * 回答“agent 在 X 时刻知道什么？”。
 *
 * The pipeline is identical to `recall_structured`, but the record set is
 * pre-filtered by `created_at <= timestamp` before scoring.
 * 管线与 `recall_structured` 相同，但 scoring 前先用 `created_at <= timestamp` 过滤 record set。
 * Rust reference: `Aura::recall_at` / `RecallService::recall_temporal` (`../src/aura.rs`).
 */
export function recallTemporalRecords<TRecord = unknown>(
  dir: string,
  query: string,
  timestamp: number,
  options?: Partial<RecallPipelineOptions>,
  trustConfig?: TrustConfig,
  sessionTracker?: RecallSessionTracker
): Effect.Effect<
  ReadonlyArray<RecallHit<TRecord>>,
  | FileReadError
  | JsonParseError
  | FileFormatError
  | IndexFormatError
  | SdrInterpreterError
  | EmbeddingQueryError
  | RerankError
  | FinalizeError,
  FileRead | FileWrite
> {
  const program = Effect.gen(function* () {
    const view = yield* Effect.service(RecallViewTag)
    const temporalView = temporalRecallView(view, timestamp)
    const scored = yield* withTrustConfig(
      recallPipeline(query, options).pipe(Effect.provideService(RecallViewTag, temporalView)),
      trustConfig
    )

    const out: Array<RecallHit<TRecord>> = []
    for (const [score, id] of scored) {
      const rec = temporalView.records.get(id)
      if (rec === undefined) continue
      out.push([score, rec as TRecord])
    }
    return out
  })

  return program.pipe(Effect.provide(recallTemporalLayer(dir, sessionTracker)))
}

/**
 * Apply file-backed recall finalization after report-specific raw/reranked recall.
 * 在 report 专用 raw/reranked recall 后执行文件持久化 finalize。
 * Rust reference: `Aura::recall_finalize` after shadow/rerank-report recall (`../src/aura.rs`).
 */
export function finalizeRecallScored(
  dir: string,
  scored: RecallScored,
  sessionId?: string,
  sessionTracker?: RecallSessionTracker
): Effect.Effect<void, FinalizeError, FileRead | FileWrite> {
  return Effect.gen(function* () {
    const finalizer = yield* Effect.service(RecallFinalizer)
    yield* finalizer.finalize(scored, sessionId)
  }).pipe(Effect.provide(RecallFinalizerFileLive(dir, sessionTracker)))
}

/**
 * Trace/explain uses persisted bounded rerank snapshots but intentionally omits RecallFinalizer.
 * trace/explain 使用持久化 bounded rerank 快照，但不装配 RecallFinalizer，保持 inspection-only。
 * Rust reference: `Aura::explain_recall` / `RecallTraceScore` (`../src/aura.rs`).
 */
export function recallWithTrace(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>,
  modes?: Partial<BoundedRerankModes>,
  trustConfig?: TrustConfig
): Effect.Effect<
  RecallTraceResult,
  | FileReadError
  | JsonParseError
  | FileFormatError
  | IndexFormatError
  | SdrInterpreterError
  | EmbeddingQueryError
  | RerankError
  | FinalizeError,
  FileRead
> {
  const pipelineOptions = modes === undefined ? options : { ...options, boundedRerankModes: modes }
  return withTrustConfig(recallPipelineWithTrace(query, pipelineOptions), trustConfig).pipe(Effect.provide(recallTraceLayer(dir)))
}

function recallCoreLayer(dir: string, sessionTracker?: RecallSessionTracker) {
  return Layer.mergeAll(RecallViewLive(dir), BoundedRerankerFileLive(dir), RecallFinalizerFileLive(dir, sessionTracker))
}

function recallTemporalLayer(dir: string, sessionTracker?: RecallSessionTracker) {
  return Layer.mergeAll(RecallViewLive(dir), RecallFinalizerFileLive(dir, sessionTracker))
}

function recallTraceLayer(dir: string) {
  return Layer.mergeAll(RecallViewLive(dir), BoundedRerankerFileLive(dir))
}
