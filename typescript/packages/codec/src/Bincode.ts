import { BinaryReader, BinaryWriter } from "./Binary"

const te = new TextEncoder()
const td = new TextDecoder()

function toNumberOrThrow(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("length overflow")
  }
  return Number(v)
}

export function bincodeEncodeStringMap(map: Map<string, string>): Uint8Array {
  const w = new BinaryWriter()
  w.u64leFromBigInt(BigInt(map.size))
  for (const [k, v] of map.entries()) {
    const kb = te.encode(k)
    const vb = te.encode(v)
    w.u64leFromBigInt(BigInt(kb.length))
    w.bytes(kb)
    w.u64leFromBigInt(BigInt(vb.length))
    w.bytes(vb)
  }
  return w.toUint8Array()
}

export function bincodeDecodeStringMap(buf: Uint8Array): Map<string, string> {
  const r = new BinaryReader(buf)
  const n = r.u64leAsBigInt()
  const out = new Map<string, string>()
  for (let i = 0n; i < n; i++) {
    const kLen = toNumberOrThrow(r.u64leAsBigInt())
    const k = td.decode(r.bytes(kLen))
    const vLen = toNumberOrThrow(r.u64leAsBigInt())
    const v = td.decode(r.bytes(vLen))
    out.set(k, v)
  }
  return out
}
