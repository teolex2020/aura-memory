import type { Record as AuraRecord } from "@aura/contract"

export interface RemoveRecordResult {
  readonly removed: AuraRecord | null
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

/**
 * Remove a record from an in-memory graph and clean its bidirectional neighbors.
 *
 * @zh 从内存 graph 中移除 record，并清理目标 record 已知邻居上的反向连接。
 *
 * Rust reference: `graph::remove_record` (`../src/graph.rs`).
 */
export function removeRecord(
  recordId: string,
  records: ReadonlyMap<string, AuraRecord>,
): RemoveRecordResult {
  const existing = records.get(recordId)
  const next = new Map(records)
  if (existing === undefined) {
    return { removed: null, records: next, updatedNeighbors: [] }
  }

  const updatedNeighbors: AuraRecord[] = []
  for (const neighborId of Object.keys(existing.connections)) {
    const neighbor = next.get(neighborId)
    if (neighbor === undefined) continue

    const hasConnection = neighbor.connections[recordId] !== undefined
    const hasConnectionType = neighbor.connection_types[recordId] !== undefined
    if (!hasConnection && !hasConnectionType) continue

    const connections: { [recordId: string]: number } = { ...neighbor.connections }
    const connectionTypes: { [recordId: string]: string } = { ...neighbor.connection_types }
    delete connections[recordId]
    delete connectionTypes[recordId]

    const updated: AuraRecord = {
      ...neighbor,
      connections,
      connection_types: connectionTypes,
    }
    next.set(neighborId, updated)
    updatedNeighbors.push(updated)
  }

  next.delete(recordId)
  return { removed: existing, records: next, updatedNeighbors }
}
