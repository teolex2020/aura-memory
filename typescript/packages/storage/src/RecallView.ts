import { Effect, Layer } from "effect"
import {
  FileFormatError,
  FileRead,
  FileReadError,
  JsonParseError,
  RecallViewTag,
  type Record as AuraRecord,
  type RecallView as ContractRecallView
} from "@aura/contract"
import { IndexFormatError, InvertedIndex, NGramIndex } from "@aura/indexing"
import { readBrainAuraFile } from "./BrainAura"
import { loadCognitiveRecords } from "./CognitiveRecord"

type AuraHeader = { sdr_indices: ReadonlyArray<number> }

/**
 * Build the recall NGram index with the deterministic verifier seed.
 * 使用确定性 verifier seed 构建召回 NGram 索引。
 *
 * Rust reference: `NGramIndex::with_seed(None, None, 0)` used by `aura-ts-verify-recall`.
 * @zh 召回 parity 使用固定 seed，避免 Rust 默认随机系数导致 TS/Rust 对照不稳定。
 */
function buildNgramIndex(
  records: ReadonlyMap<string, AuraRecord>
): ContractRecallView["ngramIndex"] {
  const index = NGramIndex.withSeed0()
  for (const [id, rec] of records.entries()) {
    index.add(id, String(rec.content ?? ""))
  }

  return index
}

function buildTagIndex(records: ReadonlyMap<string, AuraRecord>): ReadonlyMap<string, ReadonlySet<string>> {
  const tagIndex = new Map<string, Set<string>>()
  for (const [id, rec] of records.entries()) {
    const tags = Array.isArray(rec.tags) ? rec.tags : []
    for (const t of tags) {
      const key = String(t)
      const set = tagIndex.get(key) ?? new Set<string>()
      set.add(id)
      tagIndex.set(key, set)
    }
  }
  return tagIndex
}

function buildAuraIndex(records: ReadonlyMap<string, AuraRecord>): ReadonlyMap<string, string> {
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

    /**
     * Load the persisted SDR inverted index into the recall read model.
     * @zh 将持久化 SDR 倒排索引加载到召回 read model。
     *
     * Rust reference: `InvertedIndex::new(...).load()` in `Aura::open` (`../src/aura.rs`)
     * and `InvertedIndex::search` (`../src/index.rs`).
     */
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

/**
 * Build a RecallView Layer from a single in-memory snapshot.
 * 从单次内存快照构建 RecallView Layer。
 *
 * Rust reference: `Aura::open` constructs records, ngram_index, tag_index,
 * aura_index, and storage/index handles from persisted state (`../src/aura.rs`).
 * @zh core Aura 的写入/召回 facade 在写影响召回结果后刷新 read model；
 * storage 层只负责从当前磁盘状态构建一次 Rust-shaped 召回视图。
 */
export function RecallViewLive(
  dir: string
): Layer.Layer<RecallViewTag, FileReadError | JsonParseError | FileFormatError | IndexFormatError, FileRead> {
  return Layer.effect(RecallViewTag, buildRecallView(dir))
}
