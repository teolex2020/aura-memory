import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"
import { BinaryReader, BinaryWriter } from "@aura/codec"
import { RoaringBitmap } from "./Roaring"

export type IndexManifest = {
  next_doc_id: number
  id_map: Record<string, number>
}

const te = new TextEncoder()
const td = new TextDecoder()

export class InvertedIndex {
  private constructor(
    private nextDocId: number,
    private readonly idMap: Map<string, number>,
    private readonly reverseMap: Map<number, string>,
    private readonly bitToDocs: Map<number, RoaringBitmap>
  ) {}

  static empty(): InvertedIndex {
    return new InvertedIndex(1, new Map(), new Map(), new Map())
  }

  static load(dir: string): Effect.Effect<InvertedIndex, unknown, FileRead> {
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
      const manifest = JSON.parse(td.decode(manifestBytes)) as IndexManifest

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
          throw new Error("sdr.idx entry too large")
        }
        const payload = r.bytes(Number(size))
        bitToDocs.set(bit, RoaringBitmap.deserialize(payload))
      }

      return new InvertedIndex(manifest.next_doc_id, idMap, reverseMap, bitToDocs)
    })
  }

  save(dir: string): Effect.Effect<void, unknown, FileWrite> {
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

  remove(externalId: string, bits: number[]): void {
    const docId = this.idMap.get(externalId)
    if (docId === undefined) return
    for (const b of bits) {
      const bit = b & 0xffff
      const bm = this.bitToDocs.get(bit)
      if (!bm) continue
      bm.remove(docId)
    }
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

  searchScored(bits: number[], topK: number, minOverlap: number): Array<[string, number]> {
    // SIMPLE IMPLEMENTATION: count overlaps by iterating all matching doc IDs across all bitmaps.
    // FULL IMPLEMENTATION: match Rust heuristics (rarity-based pruning / max_bits / thread-local sparse buffer).
    if (bits.length === 0) return []

    const counts = new Map<number, number>()
    for (const b of bits) {
      const bm = this.bitToDocs.get(b & 0xffff)
      if (!bm) continue
      for (const docId of bm.toArray()) {
        counts.set(docId, (counts.get(docId) ?? 0) + 1)
      }
    }

    const out: Array<[string, number]> = []
    for (const [docId, c] of counts.entries()) {
      if (c < minOverlap) continue
      const ext = this.reverseMap.get(docId)
      if (ext !== undefined) out.push([ext, c])
    }
    out.sort((a, b) => b[1] - a[1])
    if (topK > 0 && out.length > topK) out.length = topK
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
