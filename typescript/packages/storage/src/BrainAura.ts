import { BinaryReader, decryptData } from "@aura/codec"

export type BrainAuraHeader = {
  magic: "AURA"
  version: number
  count: bigint
  created: number
}

export type BrainAuraRecord = {
  id: string
  dna: string
  timestamp: number
  intensity: number
  stability: number
  decay_velocity: number
  entropy: number
  sdr_indices: number[]
  text: string
  offset: bigint
  encrypted_flag: number
}

const td = new TextDecoder()

function decodeFixedString(bytes: Uint8Array): string {
  return td.decode(bytes).replaceAll("\u0000", "")
}

export function readBrainAuraFile(
  buf: Uint8Array,
  key32?: Uint8Array
): { header: BrainAuraHeader; records: BrainAuraRecord[] } {
  const r = new BinaryReader(buf)
  const magic = td.decode(r.bytes(4))
  if (magic !== "AURA") {
    throw new Error("invalid brain.aura magic")
  }

  const version = r.u32le()
  const count = r.u64leAsBigInt()
  const created = r.f64le()
  r.bytes(40)

  const header: BrainAuraHeader = {
    magic: "AURA",
    version,
    count,
    created
  }

  const records: BrainAuraRecord[] = []
  while (r.remaining() > 0) {
    const offset = BigInt(buf.byteLength - r.remaining())
    let idBytes: Uint8Array
    try {
      idBytes = r.bytes(32)
    } catch {
      break
    }

    const id = decodeFixedString(idBytes)
    if (id.length === 0) {
      break
    }

    let dna: string
    let timestamp: number
    let intensity: number
    let stability: number
    let decay_velocity: number
    let entropy: number
    let sdr_count: number
    let text_len: number
    let encrypted_flag: number
    let sdr_indices: number[]
    let textBytes: Uint8Array

    try {
      dna = decodeFixedString(r.bytes(16))
      timestamp = r.f64le()
      intensity = r.f32le()
      stability = r.f32le()
      decay_velocity = r.f32le()
      entropy = r.f32le()
      sdr_count = r.u16le()
      text_len = r.u32le()
      encrypted_flag = r.u8()
      sdr_indices = []
      for (let i = 0; i < sdr_count; i++) {
        sdr_indices.push(r.u16le())
      }
      textBytes = r.bytes(text_len)
    } catch {
      break
    }

    let text: string
    if (encrypted_flag === 1) {
      if (!key32) {
        text = "<encrypted - no key>"
      } else {
        try {
          text = td.decode(decryptData(textBytes, key32))
        } catch {
          text = "<decryption failed>"
        }
      }
    } else {
      text = td.decode(textBytes)
    }
    records.push({
      id,
      dna,
      timestamp,
      intensity,
      stability,
      decay_velocity,
      entropy,
      sdr_indices,
      text,
      offset,
      encrypted_flag
    })
  }

  return { header, records }
}
