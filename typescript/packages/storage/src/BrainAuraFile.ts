import { Effect } from "effect"
import { Clock, Crypto, CryptoError, FileRead, FileReadError, FileWrite, FileWriteError } from "@aura/contract"
import { BinaryReader, BinaryWriter } from "@aura/codec"
import { fixedBytes } from "@aura/utils"

export type BrainAuraFileAppendRecord = {
  id: string
  dna: string
  timestamp: number
  intensity: number
  stability: number
  decay_velocity: number
  entropy: number
  sdr_indices: number[]
  text: string
  encrypted_flag?: number
}

const te = new TextEncoder()
const td = new TextDecoder()

function headerBytes(createdSecF64: number, count: bigint): Uint8Array {
  const w = new BinaryWriter()
  w.bytes(te.encode("AURA"))
  w.u32le(3)
  w.u64leFromBigInt(count)
  w.f64le(createdSecF64)
  w.bytes(new Uint8Array(40))
  return w.toUint8Array()
}

export class BrainAuraFile {
  private constructor(
    private readonly filePath: string,
    private readonly key32: Uint8Array | undefined,
    private count: bigint,
    private endOff: number
  ) {}

  static open(
    dir: string,
    key32?: Uint8Array
  ): Effect.Effect<BrainAuraFile, FileReadError | FileWriteError, FileRead | FileWrite | Clock> {
    const filePath = `${dir}/brain.aura`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const fw = yield* Effect.service(FileWrite)
      const clock = yield* Effect.service(Clock)
      yield* fw.mkdirp(dir)

      const exists = yield* fr.exists(filePath)
      if (!exists) {
        const created = yield* clock.nowSeconds()
        const header = headerBytes(created, 0n)
        yield* fw.writeFile(filePath, header)
        return new BrainAuraFile(filePath, key32, 0n, header.byteLength)
      }

      const stat = yield* fr.stat(filePath)
      const buf = yield* fr.readFile(filePath)
      if (buf.byteLength < 64) {
        throw new Error("invalid brain.aura header")
      }
      const r = new BinaryReader(buf.subarray(0, 64))
      const magic = td.decode(r.bytes(4))
      if (magic !== "AURA") {
        throw new Error("invalid brain.aura magic")
      }
      r.u32le()
      const count = r.u64leAsBigInt()
      return new BrainAuraFile(filePath, key32, count, stat.size)
    })
  }

  append(record: BrainAuraFileAppendRecord): Effect.Effect<void, FileWriteError | CryptoError, FileWrite | Crypto> {
    const encrypted_flag = record.encrypted_flag === 1 ? 1 : 0
    const self = this
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      const crypto = yield* Effect.service(Crypto)

      const plaintext: Uint8Array = te.encode(record.text)
      let textBytes: Uint8Array = plaintext
      if (encrypted_flag === 1) {
        if (!self.key32) {
          throw new Error("missing key32 for encryption")
        }
        const enc: Uint8Array = yield* crypto.encryptData(plaintext, self.key32)
        textBytes = enc
      }

      const sdr_count = record.sdr_indices.length
      if (sdr_count > 0xffff) {
        throw new Error("sdr_indices too large")
      }

      const w = new BinaryWriter()
      w.bytes(fixedBytes(record.id, 32))
      w.bytes(fixedBytes(record.dna, 16))
      w.f64le(record.timestamp)
      w.f32le(record.intensity)
      w.f32le(record.stability)
      w.f32le(record.decay_velocity)
      w.f32le(record.entropy)
      w.u16le(sdr_count)
      w.u32le(textBytes.byteLength)
      w.u8(encrypted_flag)
      for (const idx of record.sdr_indices) {
        w.u16le(idx)
      }
      w.bytes(textBytes)

      const buf = w.toUint8Array()
      yield* fw.appendFile(self.filePath, buf)
      self.endOff += buf.byteLength
      self.count += 1n
    })
  }

  flush(): Effect.Effect<void, FileWriteError, FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      const w = new BinaryWriter()
      w.u64leFromBigInt(self.count)
      const buf = w.toUint8Array()
      yield* fw.writeAt(self.filePath, 8, buf)
      yield* fw.fsync(self.filePath)
    })
  }

  close(): Effect.Effect<void> {
    return Effect.succeed(undefined)
  }
}
