import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryWriter } from "../../codec/src/Binary"
import { bincodeEncodeStringMap } from "../../codec/src/Bincode"
import { decodeTemporalBin } from "./Temporal"

it("decode temporal.bin", () => {
  const links = new Map<string, string>([
    ["A", "B"],
    ["B", "C"]
  ])
  const payload = bincodeEncodeStringMap(links)
  const w = new BinaryWriter()
  w.bytes(new TextEncoder().encode("TPL1"))
  w.u8(1)
  w.bytes(payload)
  const decoded = decodeTemporalBin(w.toUint8Array())
  assert.strictEqual(decoded.get("A"), "B")
  assert.strictEqual(decoded.get("B"), "C")
})
