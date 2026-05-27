import { Effect, Layer } from "effect"
import { RecallFinalizer, FinalizeError } from "@aura/contract"
import type { RecallScored } from "@aura/contract"

/**
 * Recall Finalizer — persists activation/strengthen/session mutations.
 *
 * 召回终结器：持久化 activation/strengthen/session 变更。
 *
 * SIMPLE IMPLEMENTATION:
 * - Tracks activation counts in memory per session
 * - Increments activation_count for each scored record
 * - Persistence via storage layer to be wired in FULL IMPLEMENTATION
 */
export class RecallFinalizerImpl {
  private activationCounts = new Map<string, number>()
  private sessionIds = new Set<string>()

  finalize(
    scored: RecallScored,
    sessionId?: string
  ): Effect.Effect<void, FinalizeError> {
    return Effect.sync(() => {
      for (const [, recordId] of scored) {
        const current = this.activationCounts.get(recordId) ?? 0
        this.activationCounts.set(recordId, current + 1)
      }
      if (sessionId) {
        this.sessionIds.add(sessionId)
      }
    }).pipe(Effect.mapError(() => new FinalizeError({ cause: "unexpected finalize failure" })))
  }
}

export const RecallFinalizerLive = Layer.succeed(RecallFinalizer, new RecallFinalizerImpl())
