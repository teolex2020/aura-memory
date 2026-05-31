import { Effect, Layer } from "effect"
import {
  FileRead,
  RerankError,
  BoundedReranker,
  type BoundedRerankContext,
  type RecallScored
} from "@aura/contract"
import { BeliefStoreFile, CausalStoreFile, ConceptStoreFile, PolicyStoreFile } from "@aura/storage"
import { RUST_RUNTIME_RERANK_MODES, rerankWithSnapshots } from "@aura/recall"

export function rerankRecallRecords(
  brainDir: string,
  scored: RecallScored,
  context?: BoundedRerankContext
): Effect.Effect<RecallScored, RerankError, FileRead> {
  // Apply bounded recall reranking with persisted epistemic snapshots.
  // 使用持久化 epistemic 快照执行有界召回重排序。
  // Rust reference: `RecallService::apply_bounded_reranking`
  // (`../src/recall_service.rs:111`) and mode defaults in
  // `AuraRuntimeState::new` (`../src/aura_state.rs:83`).
  return Effect.gen(function* () {
    const snapshots = yield* Effect.all(
      {
        belief: BeliefStoreFile.new(brainDir).load(),
        concept: ConceptStoreFile.new(brainDir).load(),
        causal: CausalStoreFile.new(brainDir).load(),
        policy: PolicyStoreFile.new(brainDir).load()
      },
      { concurrency: 4 }
    )

    return rerankWithSnapshots(
      scored,
      context?.topK ?? scored.length,
      snapshots,
      RUST_RUNTIME_RERANK_MODES
    )
  }).pipe(Effect.mapError((cause) => new RerankError({ cause })))
}

export function BoundedRerankerFileLive(brainDir: string) {
  return Layer.effect(
    BoundedReranker,
    Effect.gen(function* () {
      const fileRead = yield* Effect.service(FileRead)
      return {
        rerank: (scored: RecallScored, _query: string, context?: BoundedRerankContext) =>
          rerankRecallRecords(brainDir, scored, context).pipe(
            Effect.provideService(FileRead, fileRead)
          )
      }
    })
  )
}
