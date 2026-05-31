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
import { BoundedRerankerFileLive } from "./RecallReranker"

export type RecallHit<TRecord = unknown> = readonly [score: number, record: TRecord]

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

export function recallScored(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>,
  modes?: Partial<BoundedRerankModes>,
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
  FileRead | FileWrite
> {
  // 使用 storage/RecallViewLive + 文件持久化 RecallFinalizer 运行 recallPipeline。
  // Rust reference: Aura::recall_core / Aura::recall_finalize (aura.rs)
  const pipelineOptions = modes === undefined ? options : { ...options, boundedRerankModes: modes }
  return withTrustConfig(recallPipeline(query, pipelineOptions), trustConfig).pipe(Effect.provide(recallCoreLayer(dir)))
}

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
  // Run raw recall without bounded rerank/finalize services.
  // 运行 raw recall，不装配 bounded rerank/finalize 服务。
  // Rust reference: `Aura::recall_raw` used by
  // `recall_structured_with_shadow` / `recall_structured_with_rerank_report` (aura.rs).
  return withTrustConfig(recallPipeline(query, options), trustConfig).pipe(Effect.provide(RecallViewLive(dir)))
}

export function recallRecords<TRecord = unknown>(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>,
  modes?: Partial<BoundedRerankModes>,
  trustConfig?: TrustConfig
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
  // 在同一 Effect 上下文内读取 RecallViewTag，将 recallPipeline 的 recordId 映射为 view.records 的对象。
  // Rust reference: Aura::recall_structured / recall_core (aura.rs)
  // FULL IMPLEMENTATION: 支持返回结构化 DTO（包含命中信号/解释）、并对齐 Rust recall 输出的字段与排序稳定性。
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

  return program.pipe(Effect.provide(recallCoreLayer(dir)))
}

export function finalizeRecallScored(
  dir: string,
  scored: RecallScored,
  sessionId?: string
): Effect.Effect<void, FinalizeError, FileRead | FileWrite> {
  // Apply file-backed recall finalization after report-specific raw/reranked recall.
  // 在 report 专用 raw/reranked recall 后执行文件持久化 finalize。
  // Rust reference: `Aura::recall_finalize` after shadow/rerank-report recall (aura.rs).
  return Effect.gen(function* () {
    const finalizer = yield* Effect.service(RecallFinalizer)
    yield* finalizer.finalize(scored, sessionId)
  }).pipe(Effect.provide(RecallFinalizerFileLive(dir)))
}

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
  // Trace/explain uses persisted bounded rerank snapshots but intentionally omits RecallFinalizer.
  // trace/explain 使用持久化 bounded rerank 快照，但不装配 RecallFinalizer，保持 inspection-only。
  // Rust reference: Aura::explain_recall / RecallTraceScore (aura.rs)
  const pipelineOptions = modes === undefined ? options : { ...options, boundedRerankModes: modes }
  return withTrustConfig(recallPipelineWithTrace(query, pipelineOptions), trustConfig).pipe(Effect.provide(recallTraceLayer(dir)))
}

function recallCoreLayer(dir: string) {
  return Layer.mergeAll(RecallViewLive(dir), BoundedRerankerFileLive(dir), RecallFinalizerFileLive(dir))
}

function recallTraceLayer(dir: string) {
  return Layer.mergeAll(RecallViewLive(dir), BoundedRerankerFileLive(dir))
}
