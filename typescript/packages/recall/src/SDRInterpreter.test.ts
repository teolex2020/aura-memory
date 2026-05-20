import { it } from "vitest"
import { assert } from "@effect/vitest"
import { SDRInterpreter } from "@aura/recall"

it("SDRInterpreter.textToSdr is deterministic and sorted", async () => {
  const sdr = await SDRInterpreter.default()
  const a = sdr.textToSdr("Hello 123", false)
  const b = sdr.textToSdr("Hello 123", false)
  assert.deepStrictEqual(a, b)
  assert.isTrue(a.every((v, i) => i === 0 || a[i - 1]! <= v))
})

it("SDRInterpreter.tanimotoSparse behaves sanely", async () => {
  const sdr = await SDRInterpreter.default()
  const a = sdr.textToSdr("Apple", false)
  const b = sdr.textToSdr("Apple Pie", false)
  const c = sdr.textToSdr("Banana", false)

  assert.strictEqual(sdr.tanimotoSparse(a, a), 1)
  assert.strictEqual(sdr.tanimotoSparse([], a), 0)
  assert.isTrue(sdr.tanimotoSparse(a, b) > sdr.tanimotoSparse(a, c))
})

it("SDRInterpreter.textToSdr is deterministic for non-ascii", async () => {
  const sdr = await SDRInterpreter.default()
  const a = sdr.textToSdr("你好，世界 123", false)
  const b = sdr.textToSdr("你好，世界 123", false)
  assert.deepStrictEqual(a, b)
})
