import { Effect } from "effect"
import { Record as AuraRecord, type FileWrite, type FileWriteError } from "@aura/contract"
import type { NGramIndex } from "@aura/indexing"
import * as Graph from "./Graph"

/**
 * Hard merge threshold — no LLM needed.
 *
 * @zh 硬合并阈值；不需要 LLM 参与。
 *
 * Rust reference: `CONSOLIDATION_THRESHOLD` (`../src/consolidation.rs`).
 */
export const CONSOLIDATION_THRESHOLD = 0.85

/**
 * Soft merge threshold — LLM-assisted range.
 *
 * @zh 软合并阈值；Rust 中为 LLM 辅助区间。
 *
 * Rust reference: `CONSOLIDATION_SOFT_THRESHOLD` (`../src/consolidation.rs`).
 */
export const CONSOLIDATION_SOFT_THRESHOLD = 0.5

/**
 * Result of a consolidation run.
 *
 * @zh 一次 consolidation 运行结果。
 *
 * Rust reference: `ConsolidationResult` (`../src/consolidation.rs`).
 */
export interface ConsolidationResult {
  readonly merged: number
  readonly checked: number
}

/**
 * Store operations needed by hard-merge consolidation.
 *
 * @zh 硬合并 consolidation 需要的认知存储操作。
 *
 * Rust reference: `CognitiveStore` usage in `graph::merge_records` (`../src/graph.rs`).
 */
export interface ConsolidationStore {
  readonly appendUpdate: (record: AuraRecord) => Effect.Effect<void, FileWriteError, FileWrite>
  readonly appendDelete: (id: string) => Effect.Effect<void, FileWriteError, FileWrite>
  readonly flush: () => Effect.Effect<void, FileWriteError, FileWrite>
}

/**
 * Build the Aura ID index used by consolidation.
 *
 * @zh 构建 consolidation 使用的 aura_id 到 record ID 索引。
 *
 * Rust reference: `Aura { aura_index }` and `graph::merge_records` (`../src/aura.rs`, `../src/graph.rs`).
 */
export function createAuraIndex(records: ReadonlyMap<string, AuraRecord>): Map<string, string> {
  const auraIndex = new Map<string, string>()
  for (const [recordId, record] of records) {
    if (typeof record.aura_id === "string" && record.aura_id.length > 0) {
      auraIndex.set(record.aura_id, recordId)
    }
  }
  return auraIndex
}

/**
 * Run hard-merge consolidation (MinHash >= 0.85).
 *
 * Finds duplicate pairs, keeps the higher-importance record, then merges
 * tags/connections/strength from the other record through `graph::merge_records`.
 *
 * @zh 查找重复 pair，保留 importance 更高的 record，并通过 `graph::merge_records`
 * 合并另一条 record 的 tags/connections/strength。
 *
 * Rust reference: `consolidation::consolidate` (`../src/consolidation.rs`).
 */
export function consolidate(
  records: Map<string, AuraRecord>,
  ngramIndex: NGramIndex,
  tagIndex: Map<string, Set<string>>,
  auraIndex: Map<string, string>,
  store: ConsolidationStore,
): Effect.Effect<ConsolidationResult, FileWriteError, FileWrite> {
  return Effect.gen(function* () {
    let merged = 0
    const nsMap = new Map<string, string>()
    for (const [id, record] of records) nsMap.set(id, record.namespace)

    const pairs = ngramIndex
      .findSimilarPairs(CONSOLIDATION_THRESHOLD)
      .filter(([idA, idB]) => nsMap.get(idA) === nsMap.get(idB))
    const checked = pairs.length
    const removed = new Set<string>()

    for (const [idA, idB] of pairs) {
      if (removed.has(idA) || removed.has(idB)) continue

      const recordA = records.get(idA)
      const recordB = records.get(idB)
      const impA = recordA === undefined ? 0 : AuraRecord.importance(recordA)
      const impB = recordB === undefined ? 0 : AuraRecord.importance(recordB)
      const [keepId, removeId] = impA >= impB ? [idA, idB] : [idB, idA]
      const removeBefore = records.get(removeId)

      const merge = yield* Graph.mergeRecords(keepId, removeId, records)
      replaceRecords(records, merge.records)

      if (removeBefore !== undefined) {
        removeFromIndexes(removeBefore, ngramIndex, tagIndex, auraIndex)
        yield* store.appendDelete(removeId)
        if (merge.keep !== null) {
          yield* store.appendUpdate(merge.keep)
        }
      }

      removed.add(removeId)
      merged += 1
    }

    if (merged > 0) {
      yield* store.flush()
    }

    return { merged, checked }
  })
}

function replaceRecords(target: Map<string, AuraRecord>, source: ReadonlyMap<string, AuraRecord>): void {
  target.clear()
  for (const [id, record] of source) target.set(id, record)
}

function removeFromIndexes(
  record: AuraRecord,
  ngramIndex: NGramIndex,
  tagIndex: Map<string, Set<string>>,
  auraIndex: Map<string, string>,
): void {
  ngramIndex.remove(record.id)
  for (const tag of record.tags) {
    tagIndex.get(tag)?.delete(record.id)
  }
  if (typeof record.aura_id === "string" && record.aura_id.length > 0) auraIndex.delete(record.aura_id)
}
