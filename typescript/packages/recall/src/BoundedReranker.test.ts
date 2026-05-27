import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { BoundedRerankerImpl } from "./BoundedReranker"

describe("BoundedReranker", () => {
  it("returns same list for single element", async () => {
    const reranker = new BoundedRerankerImpl()
    const scored: Array<readonly [number, string]> = [[0.8, "r1"]]
    const result = await Effect.runPromise(reranker.rerank(scored, "test"))
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0][1], "r1")
  })

  it("re-ranks with inverse-position boost", async () => {
    const reranker = new BoundedRerankerImpl()
    const scored: Array<readonly [number, string]> = [
      [0.5, "r1"],
      [0.4, "r2"],
      [0.9, "r3"]
    ]
    const result = await Effect.runPromise(reranker.rerank(scored, "test"))
    // r3 had highest score (0.9), should still be top after boost
    assert.strictEqual(result[0][1], "r3")
    assert.strictEqual(result.length, 3)
  })

  it("preserves all record IDs", async () => {
    const reranker = new BoundedRerankerImpl()
    const ids = ["r1", "r2", "r3", "r4", "r5"]
    const scored: Array<readonly [number, string]> = ids.map((id, i) => [0.1 * (5 - i), id] as const)
    const result = await Effect.runPromise(reranker.rerank(scored, "test"))
    const resultIds = result.map(r => r[1]).sort()
    assert.deepStrictEqual(resultIds, [...ids].sort())
  })
})
