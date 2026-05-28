import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { RecallFinalizerImpl } from "./RecallFinalizer"

describe("RecallFinalizer", () => {
  it("finalize does not throw for empty scored list", async () => {
    const finalizer = new RecallFinalizerImpl()
    await Effect.runPromise(finalizer.finalize([], "session-1"))
  })

  it("finalize accepts scored with sessionId", async () => {
    const finalizer = new RecallFinalizerImpl()
    const scored: Array<readonly [number, string]> = [[0.8, "r1"], [0.6, "r2"]]
    await Effect.runPromise(finalizer.finalize(scored, "session-1"))
  })

  it("finalize accepts scored without sessionId", async () => {
    const finalizer = new RecallFinalizerImpl()
    const scored: Array<readonly [number, string]> = [[0.8, "r1"]]
    await Effect.runPromise(finalizer.finalize(scored))
  })

  it("finalize increments activation counts", async () => {
    const finalizer = new RecallFinalizerImpl()

    await Effect.runPromise(finalizer.finalize([[0.5, "r1"]]))
    await Effect.runPromise(finalizer.finalize([[0.5, "r1"]]))

    const count = (finalizer as any).activationCounts.get("r1")
    assert.strictEqual(count, 2)
  })
})
