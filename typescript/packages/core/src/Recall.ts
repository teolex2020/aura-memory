import { Effect, Layer } from "effect"
import {
  EmbeddingQueryError,
  FileFormatError,
  FileReadError,
  FinalizeError,
  JsonParseError,
  type FileRead,
  type FileWrite,
  RecallViewTag,
  type RecallScored,
  RerankError
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

export type RecallHit<TRecord = unknown> = readonly [score: number, record: TRecord]

export function recallScored(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>
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
  return recallPipeline(query, options).pipe(Effect.provide(recallCoreLayer(dir)))
}

export function recallRecords<TRecord = unknown>(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>
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
    const scored = yield* recallPipeline(query, options)

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

export function recallWithTrace(
  dir: string,
  query: string,
  options?: Partial<RecallPipelineOptions>
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
  // SIMPLE IMPLEMENTATION: expose @aura/recall trace helper with the same RecallViewLive provider as recallScored.
  // Rust reference: Aura::explain_recall / RecallTraceScore (aura.rs)
  return recallPipelineWithTrace(query, options).pipe(Effect.provide(RecallViewLive(dir)))
}

function recallCoreLayer(dir: string) {
  return Layer.mergeAll(RecallViewLive(dir), RecallFinalizerFileLive(dir))
}
