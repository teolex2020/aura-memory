import type { RecallView } from "@aura/contract"
import type { RecallRecord, Scored } from "./Types"

/**
 * Maximum causal chain depth.
 * 最大 causal chain 深度。
 *
 * Rust reference: `CAUSAL_MAX_DEPTH` (`../src/recall.rs`).
 */
export const CAUSAL_MAX_DEPTH = 3

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

/**
 * Rust reference: `in_namespace` uses `namespaces.contains(...)`; an empty slice matches nothing.
 * @zh 空 namespaces 与 Rust 一样不匹配任何记录，默认 namespace 由 pipeline 上层注入。
 */
function inNamespaces(rec: RecallRecord, namespaces: ReadonlyArray<string>): boolean {
  return namespaces.includes(namespaceOf(rec))
}

/**
 * Follow caused_by_id chains to discover causal context.
 * 沿 caused_by_id 链发现 causal context。
 *
 * Rust reference: `causal_walk` (`../src/recall.rs`).
 */
export function causalWalk(
  view: RecallView,
  matched: Scored,
  minStrength: number,
  namespaces: ReadonlyArray<string>
): Scored {
  const matchedIds = new Set<string>(matched.map(([, rid]) => rid))
  const additions: Scored = []

  for (const [overlap, rid] of matched) {
    const rawStart = view.records.get(rid)
    let current = asRecord(rawStart)
    if (!current) continue

    const visited = new Set<string>([current.id])

    for (let depth = 0; depth < CAUSAL_MAX_DEPTH; depth++) {
      const parentId =
        typeof current.caused_by_id === "string" && current.caused_by_id.length > 0
          ? current.caused_by_id
          : undefined
      if (!parentId) break

      if (matchedIds.has(parentId) || visited.has(parentId)) break
      const rawParent = view.records.get(parentId)
      const parent = asRecord(rawParent)
      if (!parent) break
      if (!inNamespaces(parent, namespaces)) break
      if (strengthOf(parent) < minStrength) break

      visited.add(parentId)
      const causalScore = overlap * 0.8 * Math.pow(0.9, depth)
      additions.push([causalScore, parentId])
      matchedIds.add(parentId)

      current = parent
    }
  }

  matched.push(...additions)
  return matched
}
