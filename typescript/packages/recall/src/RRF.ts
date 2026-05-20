import type { RankedList, Scored } from "./Types"

export const RRF_K = 60

export function rrfFuse(rankedLists: ReadonlyArray<RankedList>): Scored {
  // SIMPLE IMPLEMENTATION: 标准 RRF（按名次累加），并按理论最大值做归一化。
  // FULL IMPLEMENTATION: 对齐 Rust [recall.rs](file:///workspace/src/recall.rs) 的 trace 模式、tie-break、以及与后续 rerank 的交互边界。
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
    out.push([maxPossible > 0 ? score / maxPossible : score, rid])
  }

  out.sort((a, b) => b[0] - a[0])
  return out
}

