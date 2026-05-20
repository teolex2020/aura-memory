import { it } from "vitest"
import { assert } from "@effect/vitest"
import { RoaringBitmap } from "./Roaring"

it("roaring serialize/deserialize roundtrip", () => {
  const bm = RoaringBitmap.empty()
  bm.add(1)
  bm.add(10)
  bm.add(1000)
  const bytes = bm.serialize()
  const bm2 = RoaringBitmap.deserialize(bytes)
  assert.deepStrictEqual(bm2.toArray(), [1, 10, 1000])
})
