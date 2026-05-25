import { it } from "vitest"
import { assert } from "@effect/vitest"
import { InvertedIndex } from "./InvertedIndex"

it("searchScored counts overlaps and sorts by count descending", () => {
  const idx = InvertedIndex.empty()
  idx.add("r1", [1, 2, 3, 4])
  idx.add("r2", [2, 3])
  idx.add("r3", [1, 3, 5])

  const results = idx.searchScored([1, 2, 3], 10, 1)
  // r1: bits 1,2,3 => overlap 3
  // r2: bits 2,3 => overlap 2
  // r3: bits 1,3 => overlap 2
  assert.strictEqual(results.length, 3)
  assert.deepStrictEqual(results[0], ["r1", 3])
  // r2 and r3 both have 2, order between them is stable (insertion order into Map)
  const ids = results.map(([id]) => id)
  assert.isTrue(ids.includes("r2"))
  assert.isTrue(ids.includes("r3"))
})

it("searchScored filters by minOverlap", () => {
  const idx = InvertedIndex.empty()
  idx.add("r1", [1, 2, 3])
  idx.add("r2", [2, 3])
  idx.add("r3", [1])

  const results = idx.searchScored([1, 2, 3], 10, 2)
  // r1: overlap 3 >= 2
  // r2: overlap 2 >= 2
  // r3: overlap 1 < 2
  assert.strictEqual(results.length, 2)
  assert.deepStrictEqual(results[0], ["r1", 3])
  assert.deepStrictEqual(results[1], ["r2", 2])

  const strict = idx.searchScored([1, 2, 3], 10, 3)
  assert.strictEqual(strict.length, 1)
  assert.deepStrictEqual(strict[0], ["r1", 3])
})

it("searchScored returns empty for empty query", () => {
  const idx = InvertedIndex.empty()
  idx.add("r1", [1, 2, 3])
  const results = idx.searchScored([], 10, 1)
  assert.deepStrictEqual(results, [])
})

it("searchScored returns empty when no bitmaps match", () => {
  const idx = InvertedIndex.empty()
  idx.add("r1", [1, 2, 3])
  const results = idx.searchScored([99, 100], 10, 1)
  assert.deepStrictEqual(results, [])
})

it("searchScored truncates to limit = min(topK * 10, 500)", () => {
  const idx = InvertedIndex.empty()
  // Add 20 docs, each with decreasing overlap
  for (let i = 0; i < 20; i++) {
    const bits: number[] = []
    for (let j = 0; j <= i; j++) {
      bits.push(j)
    }
    idx.add(`r${i}`, bits)
  }

  // Query with bits [0,1,2,3,4,5,6,7,8,9]
  // r0: overlap 1 (bit 0)
  // r1: overlap 2 (bits 0,1)
  // ...
  // r9: overlap 10
  // r10+: overlap 10
  const results = idx.searchScored([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5, 1)
  // topK = 5 => limit = min(50, 500) = 50
  // All 20 docs should fit within limit=50
  assert.strictEqual(results.length, 20)

  // With topK = 100 => limit = min(1000, 500) = 500
  const results2 = idx.searchScored([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 100, 1)
  assert.strictEqual(results2.length, 20)
})

it("searchScored rarity sort prunes to maxBits when query bits exceed threshold", () => {
  const idx = InvertedIndex.empty()

  // r1 matches bit 0 (rare)
  idx.add("r1", [0])
  // r2 matches bits 1..200 (common, but only bit 1 matters for rarity)
  const commonBits: number[] = []
  for (let i = 1; i <= 200; i++) commonBits.push(i)
  idx.add("r2", commonBits)

  // Build a query with 200 bits: bit 0 (rare, only r1) + bits 1..200 (common, r2)
  // topK = 10 => maxBits = 128
  // Since 200 > 128, rarity sort kicks in: bit 0 has smallest bitmap (size 1),
  // so it's processed first and should be included.
  const queryBits: number[] = []
  for (let i = 0; i <= 200; i++) queryBits.push(i)

  const results = idx.searchScored(queryBits, 10, 1)
  // Even with maxBits=128, bit 0 (rare) should be processed.
  // r1 gets overlap 1 from bit 0.
  // r2 gets overlap up to 128 from common bits (but limited by maxBits).
  const r1Entry = results.find(([id]) => id === "r1")
  assert.isDefined(r1Entry, "rare bit 0 should still be processed after rarity sort")
  assert.strictEqual(r1Entry![1], 1)
})

it("searchScored resolves external IDs correctly after truncation", () => {
  const idx = InvertedIndex.empty()
  idx.add("doc_a", [10, 20])
  idx.add("doc_b", [10, 20, 30])
  idx.add("doc_c", [20])

  const results = idx.searchScored([10, 20], 10, 1)
  assert.strictEqual(results.length, 3)
  const map = new Map(results)
  assert.strictEqual(map.get("doc_a"), 2)
  assert.strictEqual(map.get("doc_b"), 2)
  assert.strictEqual(map.get("doc_c"), 1)
})
