import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"
import { BinaryReader, BinaryWriter } from "@aura/codec"
import { crc32, fixedBytes } from "@aura/utils"

const te = new TextEncoder()
const td = new TextDecoder()

const MAGIC = "COG1"
const VERSION = 2

const OP_STORE = 0x01
const OP_UPDATE = 0x02
const OP_DELETE = 0x03

const SNAP_MAGIC = "CSN1"

function decodeFixedString(bytes: Uint8Array): string {
  return td.decode(bytes).replaceAll("\u0000", "")
}

export class CognitiveStoreFile {
  private constructor(
    private readonly logPath: string,
    private readonly snapPath: string
  ) {}

  static open(dir: string): Effect.Effect<CognitiveStoreFile, unknown, FileRead | FileWrite> {
    const logPath = `${dir}/brain.cog`
    const snapPath = `${dir}/brain.snap`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)

      const exists = yield* fr.exists(logPath)
      if (!exists) {
        const w = new BinaryWriter()
        w.bytes(te.encode(MAGIC))
        w.u8(VERSION)
        yield* fw.writeFile(logPath, w.toUint8Array())
        yield* fw.fsync(logPath)
      }

      return new CognitiveStoreFile(logPath, snapPath)
    })
  }

  appendStore(record: unknown): Effect.Effect<void, unknown, FileWrite> {
    return this.appendEntry(OP_STORE, te.encode(JSON.stringify(record)))
  }

  appendUpdate(record: unknown): Effect.Effect<void, unknown, FileWrite> {
    return this.appendEntry(OP_UPDATE, te.encode(JSON.stringify(record)))
  }

  appendDelete(id: string): Effect.Effect<void, unknown, FileWrite> {
    return this.appendEntry(OP_DELETE, fixedBytes(id, 12))
  }

  flush(): Effect.Effect<void, unknown, FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.fsync(self.logPath)
    })
  }

  writeSnapshot(records: ReadonlyArray<unknown>): Effect.Effect<void, unknown, FileRead | FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const fw = yield* Effect.service(FileWrite)

      const logStat = yield* fr.stat(self.logPath)
      const logPos = BigInt(logStat.size)

      const w = new BinaryWriter()
      w.bytes(te.encode(SNAP_MAGIC))
      w.u8(VERSION)
      w.u64leFromBigInt(logPos)
      w.u32le(records.length)
      for (const rec of records) {
        const payload = te.encode(JSON.stringify(rec))
        w.u32le(payload.byteLength)
        w.bytes(payload)
      }

      const tmp = `${self.snapPath}.tmp`
      yield* fw.writeFile(tmp, w.toUint8Array())
      yield* fw.fsync(tmp)
      yield* fw.rename(tmp, self.snapPath)
      yield* fw.fsync(self.snapPath)
    })
  }

  loadAll(): Effect.Effect<Map<string, unknown>, unknown, FileRead> {
    const self = this
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const records = new Map<string, unknown>()

      let snapPos = 5
      const hasSnap = yield* fr.exists(self.snapPath)
      if (hasSnap) {
        try {
          const snapBytes = yield* fr.readFile(self.snapPath)
          const r = new BinaryReader(snapBytes)
          const magic = td.decode(r.bytes(4))
          if (magic !== SNAP_MAGIC) {
            throw new Error("invalid brain.snap magic")
          }
          r.u8()
          const logPos = r.u64leAsBigInt()
          const recordCount = r.u32le()
          for (let i = 0; i < recordCount; i++) {
            const len = r.u32le()
            const payload = r.bytes(len)
            try {
              const rec = JSON.parse(td.decode(payload)) as any
              if (rec && typeof rec.id === "string") {
                records.set(rec.id, rec)
              }
            } catch {}
          }
          if (logPos <= BigInt(Number.MAX_SAFE_INTEGER)) {
            snapPos = Number(logPos)
          }
        } catch {
          records.clear()
          snapPos = 5
        }
      }

      const logBytes = yield* fr.readFile(self.logPath)
      if (logBytes.byteLength < 5) {
        return records
      }
      const header = new BinaryReader(logBytes.subarray(0, 5))
      const logMagic = td.decode(header.bytes(4))
      if (logMagic !== MAGIC) {
        throw new Error("invalid brain.cog magic")
      }
      const version = header.u8()
      if (version !== VERSION) {
        throw new Error("unsupported brain.cog version")
      }

      const r = new BinaryReader(logBytes.subarray(snapPos))
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

        if (op === OP_STORE || op === OP_UPDATE) {
          try {
            const rec = JSON.parse(td.decode(payload)) as any
            if (rec && typeof rec.id === "string") {
              records.set(rec.id, rec)
            }
          } catch {}
          continue
        }

        if (op === OP_DELETE) {
          if (payloadLen !== 12) continue
          records.delete(decodeFixedString(payload))
          continue
        }
      }

      return records
    })
  }

  private appendEntry(op: number, payload: Uint8Array): Effect.Effect<void, unknown, FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      const w = new BinaryWriter()
      w.u8(op)
      w.u32le(payload.byteLength)
      w.u32le(crc32(payload))
      w.bytes(payload)
      yield* fw.appendFile(self.logPath, w.toUint8Array())
    })
  }
}

