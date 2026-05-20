import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryReader, BinaryWriter } from "./index"

it("BinaryReader/BinaryWriter roundtrip", () => {
  const w = new BinaryWriter()
  w.u8(1)
  w.u16le(0x2233)
  w.u32le(0x44556677)
  w.f32le(12.25)
  w.f64le(123.5)
  w.bytes(Uint8Array.from([9, 8, 7]))

  const buf = w.toUint8Array()
  const r = new BinaryReader(buf)
  assert.strictEqual(r.u8(), 1)
  assert.strictEqual(r.u16le(), 0x2233)
  assert.strictEqual(r.u32le(), 0x44556677)
  assert.strictEqual(r.f32le(), 12.25)
  assert.strictEqual(r.f64le(), 123.5)
  assert.deepStrictEqual(Array.from(r.bytes(3)), [9, 8, 7])
  assert.strictEqual(r.remaining(), 0)
})
