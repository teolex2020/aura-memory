import * as fs from "node:fs"
import * as path from "node:path"
import { BinaryReader, BinaryWriter } from "../../codec/src/Binary"
import { encryptData } from "../../codec/src/Crypto"

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

function fixedBytes(s: string, len: number): Uint8Array {
  const out = new Uint8Array(len)
  const b = te.encode(s)
  out.set(b.subarray(0, len), 0)
  return out
}

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
    private readonly fd: number,
    private readonly filePath: string,
    private readonly key32: Uint8Array | undefined,
    private count: bigint,
    private endOff: number
  ) {}

  static open(dir: string, key32?: Uint8Array): BrainAuraFile {
    const filePath = path.join(dir, "brain.aura")
    if (!fs.existsSync(filePath)) {
      const fd = fs.openSync(filePath, "w+")
      const created = Date.now() / 1000
      const header = headerBytes(created, 0n)
      fs.writeSync(fd, header, 0, header.byteLength, 0)
      return new BrainAuraFile(fd, filePath, key32, 0n, header.byteLength)
    }

    const fd = fs.openSync(filePath, "r+")
    const headerBuf = new Uint8Array(64)
    const n = fs.readSync(fd, headerBuf, 0, headerBuf.byteLength, 0)
    if (n !== headerBuf.byteLength) {
      throw new Error("invalid brain.aura header")
    }
    const r = new BinaryReader(headerBuf)
    const magic = td.decode(r.bytes(4))
    if (magic !== "AURA") {
      throw new Error("invalid brain.aura magic")
    }
    r.u32le()
    const count = r.u64leAsBigInt()
    const endOff = fs.fstatSync(fd).size
    return new BrainAuraFile(fd, filePath, key32, count, endOff)
  }

  append(record: BrainAuraFileAppendRecord): void {
    const encrypted_flag = record.encrypted_flag === 1 ? 1 : 0
    const plaintext = te.encode(record.text)
    const textBytes =
      encrypted_flag === 1
        ? (() => {
            if (!this.key32) {
              throw new Error("missing key32 for encryption")
            }
            return encryptData(plaintext, this.key32)
          })()
        : plaintext

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
    fs.writeSync(this.fd, buf, 0, buf.byteLength, this.endOff)
    this.endOff += buf.byteLength
    this.count += 1n
  }

  flush(): void {
    const w = new BinaryWriter()
    w.u64leFromBigInt(this.count)
    const buf = w.toUint8Array()
    fs.writeSync(this.fd, buf, 0, buf.byteLength, 8)
    fs.fsyncSync(this.fd)
  }

  close(): void {
    try {
      fs.closeSync(this.fd)
    } catch {}
  }
}
