import { Effect } from "effect"
import type { RecallView } from "@aura/contract"
import type { RankedList, RecallRecord } from "./Types"
import { SDRInterpreter } from "./SDRInterpreter"

const DEFAULT_NAMESPACE = "default"

function asRecord(raw: unknown): RecallRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as any
  if (typeof o.id !== "string") return undefined
  return o as RecallRecord
}

function getNamespace(rec: RecallRecord): string {
  return typeof rec.namespace === "string" && rec.namespace.length > 0 ? rec.namespace : DEFAULT_NAMESPACE
}

function inNamespaces(rec: RecallRecord, namespaces: ReadonlyArray<string>): boolean {
  if (namespaces.length === 0) return true
  return namespaces.includes(getNamespace(rec))
}

function uniqueLowerWords(text: string): string[] {
  const out = new Set<string>()
  for (const w of text.split(/\s+/g)) {
    const lw = w.trim().toLowerCase()
    if (lw.length > 0) out.add(lw)
  }
  return Array.from(out)
}

export function collectSdr(
  view: RecallView,
  sdr: SDRInterpreter,
  query: string,
  topK: number,
  namespaces: ReadonlyArray<string>
): RankedList {
  // SIMPLE IMPLEMENTATION: 复刻 Rust 的 aura_id → record_id 映射与 Tanimoto 打分，但 invertedIndex.search 的 overlap 未参与权重。
  // FULL IMPLEMENTATION: 对齐 Rust [collect_sdr](file:///workspace/src/recall.rs#L85-L137) 的候选召回、overlap 参与、以及缓存/剪枝策略。
  const queryBits = sdr.textToSdr(query, false)
  if (queryBits.length === 0) return []

  const candidates = view.invertedIndex.search(queryBits, topK * 2, 1)
  const results: RankedList = []

  for (const [auraId] of candidates) {
    const mapped = view.auraIndex.get(auraId)
    const recordId = mapped ?? (view.records.has(auraId) ? auraId : undefined)
    if (!recordId) continue

    const rawRec = view.records.get(recordId)
    const rec = asRecord(rawRec)
    if (!rec) continue
    if (!inNamespaces(rec, namespaces)) continue

    const header = view.auraHeaders.get(auraId)
    if (!header) continue
    const score = sdr.tanimotoSparse(queryBits, header.sdr_indices)
    if (score > 0) results.push([recordId, score])
  }

  results.sort((a, b) => b[1] - a[1])
  if (topK > 0 && results.length > topK) results.length = topK
  return results
}

export function collectNgram(
  view: RecallView,
  query: string,
  topK: number,
  namespaces: ReadonlyArray<string>
): RankedList {
  // SIMPLE IMPLEMENTATION: 直接使用 RecallView.ngramIndex.query 的结果并做 namespace filter。
  // FULL IMPLEMENTATION: 对齐 Rust [collect_ngram](file:///workspace/src/recall.rs#L141-L159) 的 topK*4 召回、稳定排序与 tie-break。
  const hits = view.ngramIndex.query(query, topK * 4)
  const out: RankedList = []
  for (const [sim, rid] of hits) {
    const raw = view.records.get(rid)
    const rec = asRecord(raw)
    if (!rec) continue
    if (!inNamespaces(rec, namespaces)) continue
    out.push([rid, sim])
    if (topK > 0 && out.length >= topK) break
  }
  return out
}

export function collectTags(
  view: RecallView,
  query: string,
  topK: number,
  namespaces: ReadonlyArray<string>
): RankedList {
  // SIMPLE IMPLEMENTATION: query 分词作为 tag 候选，使用 Jaccard（matched / union）进行打分。
  // FULL IMPLEMENTATION: 对齐 Rust [collect_tags](file:///workspace/src/recall.rs#L162-L212) 的候选聚合、union 构造与性能特征。
  const queryTags = uniqueLowerWords(query)
  if (queryTags.length === 0) return []

  const candidates = new Map<string, Set<string>>()
  for (const qt of queryTags) {
    const ids = view.tagIndex.get(qt)
    if (!ids) continue
    for (const id of ids) {
      const set = candidates.get(id) ?? new Set<string>()
      set.add(qt)
      candidates.set(id, set)
    }
  }

  const out: RankedList = []
  for (const [rid, matchedTags] of candidates.entries()) {
    const raw = view.records.get(rid)
    const rec = asRecord(raw)
    if (!rec) continue
    if (!inNamespaces(rec, namespaces)) continue

    const recTags = new Set<string>()
    if (Array.isArray(rec.tags)) {
      for (const t of rec.tags) {
        if (typeof t === "string") recTags.add(t.toLowerCase())
      }
    }

    const union = new Set<string>()
    for (const t of queryTags) union.add(t)
    for (const t of recTags) union.add(t)
    if (union.size === 0) continue

    const jaccard = matchedTags.size / union.size
    if (jaccard > 0) out.push([rid, jaccard])
  }

  out.sort((a, b) => b[1] - a[1])
  if (topK > 0 && out.length > topK) out.length = topK
  return out
}

export function collectEmbedding(
  view: RecallView,
  embedding: {
    query: (text: string, topK: number) => Effect.Effect<Array<[string, number]>>
  },
  query: string,
  topK: number,
  namespaces: ReadonlyArray<string>
): Effect.Effect<RankedList> {
  // SIMPLE IMPLEMENTATION: 直接透传可选 embedding 服务的 ranked list，并做 namespace filter。
  // FULL IMPLEMENTATION: 对齐 Rust 侧 embedding 信号的归一化、阈值过滤、以及与 SDR/NGram/Tags 的融合权重策略。
  return embedding.query(query, topK).pipe(
    Effect.map((pairs) => {
      const out: RankedList = []
      for (const [rid, score] of pairs) {
        const raw = view.records.get(rid)
        const rec = asRecord(raw)
        if (!rec) continue
        if (!inNamespaces(rec, namespaces)) continue
        out.push([rid, score])
      }
      out.sort((a, b) => b[1] - a[1])
      if (topK > 0 && out.length > topK) out.length = topK
      return out
    })
  )
}
