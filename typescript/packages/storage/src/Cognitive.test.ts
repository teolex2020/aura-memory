import { it } from "vitest"
import { assert } from "@effect/vitest"
import { BinaryWriter } from "../../codec/src/Binary"
import { decodeCognitiveLog } from "./Cognitive"

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of buf) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

it("decode brain.cog minimal", () => {
  const record = { id: "id1", content: "hello" }
  const payload = new TextEncoder().encode(JSON.stringify(record))
  const w = new BinaryWriter()
  w.bytes(new TextEncoder().encode("COG1"))
  w.u8(2)
  w.u8(0x01)
  w.u32le(payload.length)
  w.u32le(crc32(payload))
  w.bytes(payload)

  const ops = decodeCognitiveLog(w.toUint8Array())
  assert.strictEqual(ops.length, 1)
  const first = ops[0]!
  assert.strictEqual(first._tag, "Store")
  assert.deepStrictEqual((first as any).record, record)
})

it("skip entry when CRC mismatches", () => {
  const bad = new TextEncoder().encode(JSON.stringify({ id: "bad" }))
  const good = new TextEncoder().encode(JSON.stringify({ id: "good" }))

  const w = new BinaryWriter()
  w.bytes(new TextEncoder().encode("COG1"))
  w.u8(2)

  w.u8(0x01)
  w.u32le(bad.length)
  w.u32le(0)
  w.bytes(bad)

  w.u8(0x02)
  w.u32le(good.length)
  w.u32le(crc32(good))
  w.bytes(good)

  const ops = decodeCognitiveLog(w.toUint8Array())
  assert.strictEqual(ops.length, 1)
  const first = ops[0]!
  assert.strictEqual(first._tag, "Update")
  assert.strictEqual((first as any).record.id, "good")
})

it("decode delete id as 12 bytes and strip \\0", () => {
  const idBytes = new Uint8Array(12)
  idBytes.set(new TextEncoder().encode("abc"), 0)

  const w = new BinaryWriter()
  w.bytes(new TextEncoder().encode("COG1"))
  w.u8(2)
  w.u8(0x03)
  w.u32le(idBytes.length)
  w.u32le(crc32(idBytes))
  w.bytes(idBytes)

  const ops = decodeCognitiveLog(w.toUint8Array())
  assert.strictEqual(ops.length, 1)
  const first = ops[0]!
  assert.strictEqual(first._tag, "Delete")
  assert.strictEqual((first as any).id, "abc")
})
