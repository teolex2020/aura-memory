import { Data, Effect } from "effect"
import { FileRead, FileReadError, FileWrite, FileWriteError, JsonParseError } from "@aura/contract"
import { BinaryReader, BinaryWriter } from "@aura/codec"
import { RoaringBitmap } from "./Roaring"

export type IndexManifest = {
  next_doc_id: number
  id_map: Record<string, number>
}

const te = new TextEncoder()
const td = new TextDecoder()

export class IndexFormatError extends Data.TaggedError("IndexFormatError")<{
  readonly path: string
  readonly message: string
}> {}

export class InvertedIndex {
  private constructor(
    private nextDocId: number,
    private readonly idMap: Map<string, number>,
    private readonly reverseMap: Map<number, string>,
    private readonly bitToDocs: Map<number, RoaringBitmap>
  ) {}

  static empty(): InvertedIndex {
    return new InvertedIndex(0, new Map(), new Map(), new Map())
  }

  static load(dir: string): Effect.Effect<InvertedIndex, FileReadError | JsonParseError | IndexFormatError, FileRead> {
    const manifestPath = `${dir}/index_manifest.json`
    const sdrPath = `${dir}/sdr.idx`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const hasManifest = yield* fr.exists(manifestPath)
      const hasSdr = yield* fr.exists(sdrPath)
      if (!hasManifest || !hasSdr) {
        return InvertedIndex.empty()
      }

      const manifestBytes = yield* fr.readFile(manifestPath)
      const manifest = (yield* Effect.try({
        try: () => JSON.parse(td.decode(manifestBytes)) as IndexManifest,
        catch: (cause) => new JsonParseError({ path: manifestPath, cause })
      })) as IndexManifest

      const idMap = new Map<string, number>()
      for (const [k, v] of Object.entries(manifest.id_map)) {
        idMap.set(k, v)
      }
      const reverseMap = new Map<number, string>()
      for (const [k, v] of idMap.entries()) {
        reverseMap.set(v, k)
      }

      const sdrBytes = yield* fr.readFile(sdrPath)
      const r = new BinaryReader(sdrBytes)
      const bitToDocs = new Map<number, RoaringBitmap>()
      while (r.remaining() > 0) {
        const bit = r.u16le()
        const size = r.u64leAsBigInt()
        if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
          return yield* Effect.fail(
            new IndexFormatError({ path: sdrPath, message: "sdr.idx entry too large" })
          )
        }
        const payload = r.bytes(Number(size))
        bitToDocs.set(bit, RoaringBitmap.deserialize(payload))
      }

      return new InvertedIndex(manifest.next_doc_id, idMap, reverseMap, bitToDocs)
    })
  }

  save(dir: string): Effect.Effect<void, FileWriteError, FileWrite> {
    const self = this
    const manifestPath = `${dir}/index_manifest.json`
    const sdrPath = `${dir}/sdr.idx`
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)

      const id_map: Record<string, number> = {}
      for (const [k, v] of self.idMap.entries()) {
        id_map[k] = v
      }
      const manifest: IndexManifest = { next_doc_id: self.nextDocId, id_map }
      yield* fw.writeFile(manifestPath, te.encode(JSON.stringify(manifest)))

      const w = new BinaryWriter()
      const entries = Array.from(self.bitToDocs.entries()).sort((a, b) => a[0] - b[0])
      for (const [bit, bm] of entries) {
        const payload = bm.serialize()
        w.u16le(bit)
        w.u64leFromBigInt(BigInt(payload.byteLength))
        w.bytes(payload)
      }
      yield* fw.writeFile(sdrPath, w.toUint8Array())
      yield* fw.fsync(sdrPath)
    })
  }

  add(externalId: string, bits: number[]): void {
    const docId = this.getOrCreateDocId(externalId)
    for (const b of bits) {
      const bit = b & 0xffff
      const bm = this.bitToDocs.get(bit) ?? RoaringBitmap.empty()
      bm.add(docId)
      this.bitToDocs.set(bit, bm)
    }
  }

  remove(externalId: string): boolean {
    const docId = this.idMap.get(externalId)
    if (docId === undefined) return false
    this.idMap.delete(externalId)
    this.reverseMap.delete(docId)
    for (const bm of this.bitToDocs.values()) {
      bm.remove(docId)
    }
    return true
  }

  search(bits: number[]): string[] {
    if (bits.length === 0) return []

    const first = this.bitToDocs.get(bits[0]! & 0xffff)
    if (!first) return []

    let acc = first
    for (let i = 1; i < bits.length; i++) {
      const bm = this.bitToDocs.get(bits[i]! & 0xffff)
      if (!bm) return []
      acc = acc.and(bm)
    }

    const out: string[] = []
    for (const docId of acc.toArray()) {
      const ext = this.reverseMap.get(docId)
      if (ext !== undefined) out.push(ext)
    }
    return out
  }

  /**
   * 与 Rust `index.rs` 的 `InvertedIndex::search` 语义对齐：
   *
   * - max_bits 选择（128/256/512）控制处理的 query bit 数量
   * - rarity sort：当 bit 数量超过 max_bits 时，按 bitmap 长度升序（最稀有的优先）
   * - 只处理前 processing_count 个 bitmaps
   * - 结果先截断到 limit = (topK * 10).min(500)，再 resolve external IDs
   */
  searchScored(bits: number[], topK: number, minOverlap: number): Array<[string, number]> {
    if (bits.length === 0) return []

    const maxBits = topK <= 10 ? 128 : topK <= 50 ? 256 : 512

    // Collect bitmaps for each query bit
    const bitmaps: RoaringBitmap[] = []
    for (const b of bits) {
      const bm = this.bitToDocs.get(b & 0xffff)
      if (bm) bitmaps.push(bm)
    }
    if (bitmaps.length === 0) return []

    // Rarity sort: smallest bitmaps first = most selective
    const processingCount = Math.min(bitmaps.length, maxBits)
    if (bitmaps.length > maxBits) {
      bitmaps.sort((a, b) => a.size - b.size)
    }

    // Count overlaps (sparse Map is semantically equivalent to Rust's thread-local array buffer)
    const counts = new Map<number, number>()
    for (let i = 0; i < processingCount; i++) {
      for (const docId of bitmaps[i]!.toArray()) {
        counts.set(docId, (counts.get(docId) ?? 0) + 1)
      }
    }

    // Filter by minOverlap
    const candidates: Array<[number, number]> = []
    for (const [docId, count] of counts.entries()) {
      if (count >= minOverlap) {
        candidates.push([docId, count])
      }
    }

    if (candidates.length === 0) return []

    // Sort by overlap count descending
    candidates.sort((a, b) => b[1] - a[1])

    // Truncate to limit before resolving IDs
    const limit = Math.min(topK * 10, 500)
    if (candidates.length > limit) {
      candidates.length = limit
    }

    // Resolve external IDs
    const out: Array<[string, number]> = []
    for (const [docId, count] of candidates) {
      const ext = this.reverseMap.get(docId)
      if (ext !== undefined) out.push([ext, count])
    }

    return out
  }

  private getOrCreateDocId(externalId: string): number {
    const existing = this.idMap.get(externalId)
    if (existing !== undefined) return existing

    const next = this.nextDocId
    this.nextDocId += 1
    this.idMap.set(externalId, next)
    this.reverseMap.set(next, externalId)
    return next
  }
}
