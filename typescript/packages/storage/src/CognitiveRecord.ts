import { Effect } from "effect"
import { FileRead } from "@aura/contract"
import { BinaryReader } from "@aura/codec"
import { crc32 } from "@aura/utils"

export type CognitiveRecord = {
  id: string
  content: string
  tags: string[]
  aura_id?: string | null
  [k: string]: unknown
}

const td = new TextDecoder()

function decodeFixedString(bytes: Uint8Array): string {
  return td.decode(bytes).replaceAll("\u0000", "")
}

export function normalizeCognitiveRecord(raw: unknown): CognitiveRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as Record<string, unknown>
  const id = typeof o.id === "string" ? o.id : undefined
  if (!id) return undefined

  const content = typeof o.content === "string" ? o.content : ""
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : []
  const aura_id =
    typeof o.aura_id === "string" ? o.aura_id : o.aura_id === null ? null : undefined

  const rec: CognitiveRecord = { ...(o as any), id, content, tags }
  if (aura_id !== undefined) {
    rec.aura_id = aura_id
  }

  // SIMPLE IMPLEMENTATION: only normalize a minimal subset of fields required by recall.
  // FULL IMPLEMENTATION: validate and default all Rust `Record` fields (levels, source_type, namespace, connections, etc).
  if (typeof rec.content_type !== "string") {
    rec.content_type = "text"
  }
  if (!rec.metadata || typeof rec.metadata !== "object") {
    rec.metadata = {}
  }
  if (!rec.connections || typeof rec.connections !== "object") {
    rec.connections = {}
  }

  return rec
}

const LOG_MAGIC = "COG1"
const LOG_VERSION = 2
const SNAP_MAGIC = "CSN1"

export function loadCognitiveRecords(
  dir: string
): Effect.Effect<Map<string, CognitiveRecord>, unknown, FileRead> {
  const logPath = `${dir}/brain.cog`
  const snapPath = `${dir}/brain.snap`
  return Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)
    const records = new Map<string, CognitiveRecord>()

    const hasLog = yield* fr.exists(logPath)
    if (!hasLog) return records

    let snapPos = 5
    const hasSnap = yield* fr.exists(snapPath)

    if (hasSnap) {
      try {
        const snapBytes = yield* fr.readFile(snapPath)
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
            const parsed = JSON.parse(td.decode(payload))
            const rec = normalizeCognitiveRecord(parsed)
            if (rec) records.set(rec.id, rec)
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

    const logBytes = yield* fr.readFile(logPath)
    if (logBytes.byteLength < 5) {
      return records
    }

    const header = new BinaryReader(logBytes.subarray(0, 5))
    const logMagic = td.decode(header.bytes(4))
    if (logMagic !== LOG_MAGIC) {
      throw new Error("invalid brain.cog magic")
    }
    const version = header.u8()
    if (version !== LOG_VERSION) {
      throw new Error("unsupported brain.cog version")
    }

    if (snapPos > logBytes.byteLength) {
      snapPos = 5
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

      if (op === 0x01 || op === 0x02) {
        try {
          const parsed = JSON.parse(td.decode(payload))
          const rec = normalizeCognitiveRecord(parsed)
          if (rec) records.set(rec.id, rec)
        } catch {}
        continue
      }

      if (op === 0x03) {
        if (payloadLen !== 12) continue
        records.delete(decodeFixedString(payload))
        continue
      }
    }

    return records
  })
}
