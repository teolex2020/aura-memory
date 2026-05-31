import type { RecallView } from "@aura/contract"
import type { RecallRecord, Scored } from "./Types"

export const GRAPH_WALK_MAX_HOPS = 2
export const GRAPH_WALK_DAMPING = 0.6
export const GRAPH_WALK_MIN_SCORE = 0.05
export const GRAPH_WALK_MAX_EXPANDED = 30

const DEFAULT_NAMESPACE = "default"

function asRecord(raw: unknown): RecallRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const o = raw as any
  if (typeof o.id !== "string") return undefined
  return o as RecallRecord
}

function strengthOf(rec: RecallRecord): number {
  return typeof rec.strength === "number" && Number.isFinite(rec.strength) ? rec.strength : 1
}

function namespaceOf(rec: RecallRecord): string {
  return typeof rec.namespace === "string" && rec.namespace.length > 0 ? rec.namespace : DEFAULT_NAMESPACE
}

function inNamespaces(rec: RecallRecord, namespaces: ReadonlyArray<string>): boolean {
  // Rust reference: `in_namespace` uses `namespaces.contains(...)`; an empty slice matches nothing.
  // 中文说明：空 namespaces 与 Rust 一样不匹配任何记录，默认 namespace 由 pipeline 上层注入。
  return namespaces.includes(namespaceOf(rec))
}

/**
 * Expand matched records through `Record.connections`.
 * 通过 `Record.connections` 扩展已匹配记录。
 *
 * Rust reference: `graph_walk` (`../src/recall.rs`).
 */
export function graphWalk(
  view: RecallView,
  matched: Scored,
  minStrength: number,
  namespaces: ReadonlyArray<string>
): Scored {
  const matchedIds = new Set<string>(matched.map(([, rid]) => rid))
  let expandedCount = 0

  let frontier: Array<readonly [score: number, recordId: string]> = matched.map(([score, rid]) => [
    score,
    rid
  ])

  for (let hop = 0; hop < GRAPH_WALK_MAX_HOPS; hop++) {
    const next: Array<readonly [score: number, recordId: string]> = []
    for (const [parentScore, parentId] of frontier) {
      const rawParent = view.records.get(parentId)
      const parent = asRecord(rawParent)
      if (!parent) continue
      const conns = parent.connections
      if (!conns || typeof conns !== "object") continue

      for (const [connId, w] of Object.entries(conns)) {
        if (matchedIds.has(connId)) continue
        const weight = typeof w === "number" && Number.isFinite(w) ? w : 0
        if (weight <= 0) continue

        const score = parentScore * weight * GRAPH_WALK_DAMPING
        if (score < GRAPH_WALK_MIN_SCORE) continue
        next.push([score, connId])
      }
    }

    // Deduplicate frontier (keep best score)
    // 去重 frontier（保留最高分）。
    const dedup = new Map<string, number>()
    for (const [score, rid] of next) {
      const prev = dedup.get(rid) ?? 0
      if (score > prev) dedup.set(rid, score)
    }

    // Add to matched results
    // 添加到匹配结果。
    const sorted = Array.from(dedup.entries()).sort((a, b) => b[1] - a[1])
    const newFrontier: Array<readonly [score: number, recordId: string]> = []

    for (const [rid, score] of sorted) {
      if (expandedCount >= GRAPH_WALK_MAX_EXPANDED) break
      if (matchedIds.has(rid)) continue

      const raw = view.records.get(rid)
      const rec = asRecord(raw)
      if (!rec) continue
      if (!inNamespaces(rec, namespaces)) continue
      if (strengthOf(rec) < minStrength) continue

      matched.push([score, rid])
      matchedIds.add(rid)
      newFrontier.push([score, rid])
      expandedCount += 1
    }

    frontier = newFrontier
    if (frontier.length === 0) break
  }

  return matched
}
