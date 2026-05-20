import { BinaryReader } from "../../codec/src/Binary"

export type CognitiveOp =
  | { _tag: "Store"; record: unknown }
  | { _tag: "Update"; record: unknown }
  | { _tag: "Delete"; id: string }

const td = new TextDecoder()

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

function decodeFixedString(bytes: Uint8Array): string {
  return td.decode(bytes).replaceAll("\u0000", "")
}

export function decodeCognitiveLog(buf: Uint8Array): CognitiveOp[] {
  const r = new BinaryReader(buf)
  const magic = td.decode(r.bytes(4))
  if (magic !== "COG1") {
    throw new Error("invalid brain.cog magic")
  }
  const version = r.u8()
  if (version !== 2) {
    throw new Error("unsupported brain.cog version")
  }

  const ops: CognitiveOp[] = []
  while (r.remaining() > 0) {
    let op: number
    let payloadLen: number
    let expectedCrc: number
    let payload: Uint8Array
    try {
      op = r.u8()
      payloadLen = r.u32le()
      expectedCrc = r.u32le()
      payload = r.bytes(payloadLen)
    } catch {
      break
    }

    if (crc32(payload) !== expectedCrc) {
      continue
    }

    if (op === 0x01 || op === 0x02) {
      try {
        const record = JSON.parse(td.decode(payload))
        ops.push({ _tag: op === 0x01 ? "Store" : "Update", record })
      } catch {
        continue
      }
      continue
    }

    if (op === 0x03) {
      if (payloadLen !== 12) {
        continue
      }
      ops.push({ _tag: "Delete", id: decodeFixedString(payload) })
      continue
    }
  }

  return ops
}
