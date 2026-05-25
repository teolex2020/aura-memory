import { Effect } from "effect"
import {
  EmbeddingQueryError,
  FileFormatError,
  FileReadError,
  FinalizeError,
  JsonParseError,
  type FileRead,
  RecallViewTag,
  type RecallScored,
  RerankError
} from "@aura/contract"
import { type IndexFormatError } from "@aura/indexing"
import { RecallViewLive } from "@aura/storage"
import { recallPipeline, SdrInterpreterError, type RecallPipelineOptions } from "@aura/recall"

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
  FileRead
> {
  // SIMPLE IMPLEMENTATION: 使用 storage/RecallViewLive 提供 RecallViewTag，然后直接运行 @aura/recall 的 recallPipeline。
  // FULL IMPLEMENTATION: 加入可选 trace/telemetry 注入点，以及对齐 Rust recall_service 的错误类型与可观测性字段。
  return recallPipeline(query, options).pipe(Effect.provide(RecallViewLive(dir)))
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
  FileRead
> {
  // SIMPLE IMPLEMENTATION: 在同一 Effect 上下文内读取 RecallViewTag，将 recallPipeline 的 recordId 映射为 view.records 的对象。
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

  return program.pipe(Effect.provide(RecallViewLive(dir)))
}
