import type { RecallView } from "@aura/contract"
import type { RankedList, Scored } from "./Types"

export const RRF_K = 60

// ── RRF Fusion ──

const DEFAULT_NAMESPACE = "default"

type RrfRecord = {
  readonly strength?: unknown
  readonly namespace?: unknown
}

function asRecord(raw: unknown): RrfRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined
  return raw as RrfRecord
}

function strengthOf(rec: RrfRecord): number {
  return typeof rec.strength === "number" && Number.isFinite(rec.strength) ? rec.strength : 1
}

function namespaceOf(rec: RrfRecord): string {
  return typeof rec.namespace === "string" && rec.namespace.length > 0 ? rec.namespace : DEFAULT_NAMESPACE
}

function inNamespaces(rec: RrfRecord, namespaces: ReadonlyArray<string>): boolean {
  if (namespaces.length === 0) return true
  return namespaces.includes(namespaceOf(rec))
}

export function rrfFuse(
  records: RecallView["records"],
  rankedLists: ReadonlyArray<RankedList>,
  minStrength: number,
  topK: number,
  namespaces: ReadonlyArray<string>
): Scored {
  // Reciprocal Rank Fusion — combines multiple ranked lists.
  // 倒数排名融合：组合多个排序列表。
  //
  // RRF score = Σ(1 / (k + rank_i)) for each list where record appears.
  // RRF 分数：对每个包含该 record 的列表累加 1 / (k + rank_i)。
  // Rust reference: `rrf_fuse(records, ranked_lists, min_strength, top_k, namespaces)` (recall.rs).
  const scores = new Map<string, number>()

  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const rid = list[i]![0]
      const share = 1 / (RRF_K + i + 1)
      scores.set(rid, (scores.get(rid) ?? 0) + share)
    }
  }

  const maxPossible = rankedLists.length / (RRF_K + 1)
  const out: Scored = []
  for (const [rid, score] of scores.entries()) {
    const rec = asRecord(records.get(rid))
    if (!rec) continue
    if (strengthOf(rec) < minStrength) continue
    if (!inNamespaces(rec, namespaces)) continue
    out.push([maxPossible > 0 ? score / maxPossible : score, rid])
  }

  out.sort((a, b) => b[0] - a[0])
  if (out.length > topK) out.length = Math.max(0, topK)
  return out
}
