import { Effect, Layer } from "effect"
import {
  FileFormatError,
  FileRead,
  FileReadError,
  JsonParseError,
  RecallViewTag,
  type RecallView as ContractRecallView
} from "@aura/contract"
import { IndexFormatError, InvertedIndex } from "@aura/indexing"
import { readBrainAuraFile } from "./BrainAura"
import { CognitiveRecord, loadCognitiveRecords } from "./CognitiveRecord"

type AuraHeader = { sdr_indices: ReadonlyArray<number> }

function trigrams(text: string): ReadonlySet<string> {
  const clean = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .replaceAll(/\s+/g, " ")
  if (clean.length === 0) return new Set()
  if (clean.length < 3) return new Set([clean])

  const out = new Set<string>()
  for (let i = 0; i <= clean.length - 3; i++) {
    out.add(clean.slice(i, i + 3))
  }
  return out
}

function trigramJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) {
    if (b.has(x)) inter++
  }
  const union = a.size + b.size - inter
  if (union === 0) return 0
  return inter / union
}

function buildNgramIndex(
  records: ReadonlyMap<string, CognitiveRecord>
): ContractRecallView["ngramIndex"] {
  // SIMPLE IMPLEMENTATION: trigram Jaccard over `content` for fuzzy match.
  // FULL IMPLEMENTATION: port Rust `NGramIndex` (minhash/LSH) for recall-scale performance and parity.
  const sigs = new Map<string, ReadonlySet<string>>()
  for (const [id, rec] of records.entries()) {
    sigs.set(id, trigrams(String(rec.content ?? "")))
  }

  return {
    query: (text: string, topK: number) => {
      const q = trigrams(text)
      const scored: Array<[number, string]> = []
      for (const [id, s] of sigs.entries()) {
        const sim = trigramJaccard(q, s)
        if (sim > 0) scored.push([sim, id])
      }
      scored.sort((a, b) => b[0] - a[0])
      scored.length = Math.min(scored.length, topK)
      return scored
    }
  }
}

function buildTagIndex(records: ReadonlyMap<string, CognitiveRecord>): ReadonlyMap<string, ReadonlySet<string>> {
  const tagIndex = new Map<string, Set<string>>()
  for (const [id, rec] of records.entries()) {
    const tags = Array.isArray(rec.tags) ? rec.tags : []
    for (const t of tags) {
      const key = String(t).toLowerCase()
      const set = tagIndex.get(key) ?? new Set<string>()
      set.add(id)
      tagIndex.set(key, set)
    }
  }
  return tagIndex
}

function buildAuraIndex(records: ReadonlyMap<string, CognitiveRecord>): ReadonlyMap<string, string> {
  const auraIndex = new Map<string, string>()
  for (const rec of records.values()) {
    if (typeof rec.aura_id === "string" && rec.aura_id.length > 0) {
      auraIndex.set(rec.aura_id, rec.id)
    }
  }
  return auraIndex
}

export function buildRecallView(
  dir: string
): Effect.Effect<
  ContractRecallView,
  FileReadError | JsonParseError | FileFormatError | IndexFormatError,
  FileRead
> {
  const indexDir = `${dir}/index`
  const auraPath = `${dir}/brain.aura`

  return Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)

    const records = yield* loadCognitiveRecords(dir)

    const auraHeaders = new Map<string, AuraHeader>()
    const hasAura = yield* fr.exists(auraPath)
    if (hasAura) {
      const buf = yield* fr.readFile(auraPath)
      const parsed = yield* Effect.try({
        try: () => readBrainAuraFile(buf),
        catch: (cause) =>
          new FileFormatError({
            path: auraPath,
            message: cause instanceof Error ? cause.message : String(cause)
          })
      })
      for (const rec of parsed.records) {
        auraHeaders.set(rec.id, { sdr_indices: rec.sdr_indices })
      }
    }

    // SIMPLE IMPLEMENTATION: load `index/` into memory using `@aura/indexing` implementation.
    // FULL IMPLEMENTATION: ensure byte-level parity with Rust `index.rs` search semantics and ordering under heavy load.
    const idx = yield* InvertedIndex.load(indexDir)

    const view: ContractRecallView = {
      records,
      auraIndex: buildAuraIndex(records),
      auraHeaders,
      invertedIndex: {
        search: (bits: ReadonlyArray<number>, topK: number, minOverlap: number) =>
          idx.searchScored(Array.from(bits), topK, minOverlap)
      },
      ngramIndex: buildNgramIndex(records),
      tagIndex: buildTagIndex(records)
    }

    return view
  })
}

export function RecallViewLive(
  dir: string
): Layer.Layer<RecallViewTag, FileReadError | JsonParseError | FileFormatError | IndexFormatError, FileRead> {
  // SIMPLE IMPLEMENTATION: build a single in-memory RecallView at startup.
  // FULL IMPLEMENTATION: add incremental refresh/update hooks so finalize can mutate without full reload.
  return Layer.effect(RecallViewTag, buildRecallView(dir))
}
