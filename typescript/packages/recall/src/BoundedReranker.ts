import { Effect, Layer } from "effect"
import { BoundedReranker, RerankError } from "@aura/contract"
import type { RecallScored } from "@aura/contract"

/**
 * Bounded Reranker — re-ranks top-K recall results with inverse-position boost.
 *
 * 有界重排序器：对 top-K 召回结果进行逆序位置提升。
 *
 * SIMPLE IMPLEMENTATION:
 * - Takes top 20 results
 * - Applies inverse-position boost: higher-ranked items get modest boost
 * - Preserves total count
 */
export class BoundedRerankerImpl {
  rerank(
    scored: RecallScored,
    _query: string
  ): Effect.Effect<RecallScored, RerankError> {
    return Effect.sync(() => {
      if (scored.length <= 1) return scored

      const depth = Math.min(20, scored.length)
      // Inverse-position boost: position 0 gets +0.1, each subsequent position gets less
      const reranked = [...scored]
      for (let i = 0; i < depth; i++) {
        const item = reranked[i]!
        const [score, recordId] = item
        const positionBoost = 0.1 * (1 - i / depth)
        reranked[i] = [score * (1 + positionBoost), recordId] as const
      }
      // Re-sort by boosted score (descending)
      reranked.sort((a, b) => b[0] - a[0])
      return reranked as RecallScored
    }).pipe(Effect.mapError(() => new RerankError({ cause: "unexpected rerank failure" })))
  }
}

export const BoundedRerankerLive = Layer.succeed(BoundedReranker, new BoundedRerankerImpl())
