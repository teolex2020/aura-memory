import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryWriter } from "./Binary"
import { bincodeDecodeStringMap, bincodeEncodeStringMap } from "./Bincode"

it("bincode HashMap<String,String> roundtrip", () => {
  const m = new Map<string, string>([
    ["a", "1"],
    ["hello", "world"]
  ])
  const bytes = bincodeEncodeStringMap(m)
  const decoded = bincodeDecodeStringMap(bytes)
  assert.strictEqual(decoded.get("a"), "1")
  assert.strictEqual(decoded.get("hello"), "world")
})

it("bincode deterministic layout (u64 len + repeated key/value)", () => {
  const m = new Map<string, string>([["k", "v"]])
  const bytes = bincodeEncodeStringMap(m)
  const w = new BinaryWriter()
  w.u64leFromBigInt(1n)
  const k = new TextEncoder().encode("k")
  const v = new TextEncoder().encode("v")
  w.u64leFromBigInt(BigInt(k.length))
  w.bytes(k)
  w.u64leFromBigInt(BigInt(v.length))
  w.bytes(v)
  assert.deepStrictEqual(Array.from(bytes), Array.from(w.toUint8Array()))
})
