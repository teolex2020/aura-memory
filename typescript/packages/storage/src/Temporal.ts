import { BinaryReader, bincodeDecodeStringMap } from "@aura/codec"

const td = new TextDecoder()

export function decodeTemporalBin(buf: Uint8Array): Map<string, string> {
  const r = new BinaryReader(buf)
  const magic = td.decode(r.bytes(4))
  if (magic !== "TPL1") {
    throw new Error("invalid temporal.bin magic")
  }
  const version = r.u8()
  if (version !== 1) {
    throw new Error("unsupported temporal.bin version")
  }
  return bincodeDecodeStringMap(r.sliceRemaining())
}
