import { Level, type Record as AuraRecord } from "@aura/contract"

/**
 * Knowledge graph and connection helpers.
 *
 * @zh 知识图谱与连接辅助逻辑，对应 Rust `graph.rs` 的纯内存部分。
 *
 * Rust reference: module `graph` (`../src/graph.rs`).
 */
export const MAX_CONNECTIONS = 50

export interface AutoConnectResult {
  readonly connected: number
  readonly record: AuraRecord
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

export interface RemoveRecordResult {
  readonly removed: AuraRecord | null
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

export interface MergeRecordsResult {
  readonly keep: AuraRecord | null
  readonly removed: AuraRecord | null
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

/**
 * Auto-connect a new record with existing records that share tags.
 *
 * @zh 将新 record 与共享 tag 的既有 records 自动连接。
 *
 * Rust reference: `graph::auto_connect` (`../src/graph.rs`).
 */
export function autoConnect(
  newRecord: AuraRecord,
  records: ReadonlyMap<string, AuraRecord>,
): AutoConnectResult {
  const next = new Map(records)
  if (newRecord.tags.length === 0) {
    const record: AuraRecord = {
      ...newRecord,
      connections: { ...newRecord.connections },
      connection_types: { ...newRecord.connection_types },
    }
    next.set(record.id, record)
    return { connected: 0, record, records: next, updatedNeighbors: [] }
  }

  const candidates = new Map<string, number>()
  for (const tag of newRecord.tags) {
    for (const [id, record] of records) {
      if (id === newRecord.id) continue
      if (!record.tags.includes(tag)) continue
      candidates.set(id, (candidates.get(id) ?? 0) + 1)
    }
  }

  let connected = 0
  const connections: { [recordId: string]: number } = { ...newRecord.connections }
  const connectionTypes: { [recordId: string]: string } = { ...newRecord.connection_types }
  const updatedNeighbors: AuraRecord[] = []

  for (const [candidateId, candidate] of records) {
    const sharedCount = candidates.get(candidateId)
    if (sharedCount === undefined) continue
    if (Object.keys(connections).length >= MAX_CONNECTIONS) break

    if (candidate.namespace !== newRecord.namespace) continue

    const weight = Math.min(0.2 + 0.15 * sharedCount, 0.8)
    connections[candidateId] = weight
    connectionTypes[candidateId] = "associative"

    if (Object.keys(candidate.connections).length < MAX_CONNECTIONS) {
      const updated: AuraRecord = {
        ...candidate,
        connections: { ...candidate.connections, [newRecord.id]: weight },
        connection_types: { ...candidate.connection_types, [newRecord.id]: "associative" },
      }
      next.set(candidateId, updated)
      updatedNeighbors.push(updated)
    }

    connected += 1
  }

  const record: AuraRecord = {
    ...newRecord,
    connections,
    connection_types: connectionTypes,
  }
  next.set(record.id, record)
  return { connected, record, records: next, updatedNeighbors }
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

/**
 * Merge the `remove` record into the `keep` record, then remove the merged record.
 *
 * @zh 将 `remove` record 合并进 `keep` record，然后删除被合并 record。
 *
 * Rust reference: `graph::merge_records` (`../src/graph.rs`).
 */
export function mergeRecords(
  keepId: string,
  removeId: string,
  records: ReadonlyMap<string, AuraRecord>,
): MergeRecordsResult {
  const remove = records.get(removeId)
  const next = new Map(records)
  if (remove === undefined) {
    return {
      keep: next.get(keepId) ?? null,
      removed: null,
      records: next,
      updatedNeighbors: [],
    }
  }

  const keep = next.get(keepId)
  if (keep !== undefined) {
    const tags = [...keep.tags]
    for (const tag of remove.tags) {
      if (!tags.includes(tag)) tags.push(tag)
    }

    const connections: { [recordId: string]: number } = { ...keep.connections }
    const connectionTypes: { [recordId: string]: string } = { ...keep.connection_types }
    for (const [connectionId, weight] of Object.entries(remove.connections)) {
      if (connectionId === keepId) continue
      if (Object.keys(connections).length >= MAX_CONNECTIONS) break
      connections[connectionId] = Math.max(connections[connectionId] ?? 0, weight)

      const relationship = remove.connection_types[connectionId]
      if (relationship !== undefined && connectionTypes[connectionId] === undefined) {
        connectionTypes[connectionId] = relationship
      }
    }

    const updatedKeep: AuraRecord = {
      ...keep,
      level: levelRank(remove.level) > levelRank(keep.level) ? remove.level : keep.level,
      tags,
      connections,
      connection_types: connectionTypes,
      strength: Math.min(keep.strength + 0.3 * remove.strength, 1),
      activation_count: keep.activation_count + remove.activation_count,
      source_type:
        sourceTypeRank(remove.source_type) > sourceTypeRank(keep.source_type)
          ? remove.source_type
          : keep.source_type,
    }
    next.set(keepId, updatedKeep)
  }

  const removal = removeRecord(removeId, next)
  return {
    keep: removal.records.get(keepId) ?? null,
    removed: remove,
    records: removal.records,
    updatedNeighbors: removal.updatedNeighbors,
  }
}

function levelRank(level: Level): number {
  switch (level) {
    case Level.Working:
      return 0
    case Level.Decisions:
      return 1
    case Level.Domain:
      return 2
    case Level.Identity:
      return 3
  }
}

function sourceTypeRank(sourceType: string): number {
  switch (sourceType) {
    case "recorded":
      return 3
    case "retrieved":
      return 2
    case "inferred":
      return 1
    default:
      return 0
  }
}
