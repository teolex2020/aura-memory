import { Effect } from "effect"
import { Clock, Level, type Record as AuraRecord } from "@aura/contract"

/**
 * Knowledge graph and connection helpers.
 *
 * @zh 知识图谱与连接辅助逻辑，对应 Rust `graph.rs` 的纯内存部分。
 *
 * Rust reference: module `graph` (`../src/graph.rs`).
 */
export const MAX_CONNECTIONS = 50

/**
 * Session timeout in seconds (30 minutes).
 *
 * @zh session 空闲超时时间，单位秒。
 *
 * Rust reference: `SESSION_TIMEOUT` (`../src/graph.rs`).
 */
export const SESSION_TIMEOUT = 1800

/**
 * Ephemeral session buffer for co-activation tracking.
 *
 * @zh 用于共同激活追踪的短生命周期 session buffer。
 *
 * Rust reference: `SessionBuffer` (`../src/graph.rs`).
 */
export interface SessionBuffer {
  readonly record_ids: Set<string>
  readonly started_at: number
  last_activity: number
}

/**
 * Manages session-scoped co-activation tracking.
 *
 * @zh 管理 session 范围的共同激活追踪。
 *
 * Rust reference: `SessionTracker` (`../src/graph.rs`).
 */
export type SessionTracker = Map<string, SessionBuffer>

/**
 * Tag-to-record index used by graph auto-connect.
 *
 * @zh graph 自动连接使用的 tag 到 record ID 索引。
 *
 * Rust reference: `tag_index: HashMap<String, HashSet<String>>` in `graph::auto_connect` (`../src/graph.rs`).
 */
export type TagIndex = ReadonlyMap<string, ReadonlySet<string>>

/**
 * Result of graph auto-connect.
 *
 * @zh graph 自动连接结果；`records` 仅包含 Rust 中传入的既有 records 及其更新，不插入新 record。
 *
 * Rust reference: `graph::auto_connect` (`../src/graph.rs`).
 */
export interface AutoConnectResult {
  readonly connected: number
  readonly record: AuraRecord
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

/**
 * Result of graph record removal.
 *
 * @zh graph record 删除结果。
 *
 * Rust reference: `graph::remove_record` (`../src/graph.rs`).
 */
export interface RemoveRecordResult {
  readonly removed: AuraRecord | null
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

/**
 * Result of graph record merge.
 *
 * @zh graph record 合并结果。
 *
 * Rust reference: `graph::merge_records` (`../src/graph.rs`).
 */
export interface MergeRecordsResult {
  readonly keep: AuraRecord | null
  readonly removed: AuraRecord | null
  readonly records: Map<string, AuraRecord>
  readonly updatedNeighbors: ReadonlyArray<AuraRecord>
}

/**
 * Result of ending one recall session.
 *
 * @zh 结束一个 recall session 的结果。
 *
 * Rust reference: `SessionTracker::end_session` (`../src/graph.rs`).
 */
export interface SessionResult {
  readonly stats: Record<string, number>
  readonly records: Map<string, AuraRecord>
  readonly updatedRecords: ReadonlyArray<AuraRecord>
}

/**
 * Result of stale session cleanup.
 *
 * @zh 清理超时 session 的结果。
 *
 * Rust reference: `SessionTracker::cleanup_stale_sessions` (`../src/graph.rs`).
 */
export interface CleanupStaleSessionsResult {
  readonly consolidatedSessions: ReadonlyArray<string>
  readonly records: Map<string, AuraRecord>
  readonly updatedRecords: ReadonlyArray<AuraRecord>
}

function sessionBufferAt(nowSeconds: number): SessionBuffer {
  return {
    record_ids: new Set<string>(),
    started_at: nowSeconds,
    last_activity: nowSeconds,
  }
}

/**
 * Ephemeral session buffer for co-activation tracking.
 *
 * @zh 创建用于共同激活追踪的短生命周期 session buffer。
 *
 * Rust reference: `SessionBuffer::new` (`../src/graph.rs`).
 */
export function createSessionBuffer(): Effect.Effect<SessionBuffer> {
  return Effect.gen(function* () {
    const clock = yield* Clock
    return sessionBufferAt(clock.nowSeconds())
  })
}

/**
 * Manages session-scoped co-activation tracking.
 *
 * @zh 创建 session 范围共同激活追踪器。
 *
 * Rust reference: `SessionTracker::new` (`../src/graph.rs`).
 */
export function createSessionTracker(): SessionTracker {
  return new Map<string, SessionBuffer>()
}

/**
 * Build a Rust-shaped tag index from records.
 *
 * @zh 从 records 构建 Rust 形状的 tag index。
 *
 * Rust reference: `tag_index: HashMap<String, HashSet<String>>` (`../src/aura.rs`, `../src/graph.rs`).
 */
export function createTagIndex(
  records: ReadonlyMap<string, AuraRecord>,
  extraRecords: ReadonlyArray<AuraRecord> = [],
): Map<string, Set<string>> {
  const tagIndex = new Map<string, Set<string>>()
  const addRecord = (record: AuraRecord): void => {
    for (const tag of record.tags) {
      let ids = tagIndex.get(tag)
      if (ids === undefined) {
        ids = new Set<string>()
        tagIndex.set(tag, ids)
      }
      ids.add(record.id)
    }
  }
  for (const record of records.values()) addRecord(record)
  for (const record of extraRecords) addRecord(record)
  return tagIndex
}

/**
 * Track that these record IDs were activated in a session.
 *
 * @zh 记录这些 record IDs 在同一个 session 中被激活。
 *
 * Rust reference: `SessionTracker::track_activation` (`../src/graph.rs`).
 */
export function trackActivation(
  sessionTracker: SessionTracker,
  sessionId: string,
  recordIds: ReadonlyArray<string>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const clock = yield* Clock
    const nowSeconds = clock.nowSeconds()
    let buffer = sessionTracker.get(sessionId)
    if (buffer === undefined) {
      buffer = sessionBufferAt(nowSeconds)
      sessionTracker.set(sessionId, buffer)
    }
    for (const recordId of recordIds) buffer.record_ids.add(recordId)
    buffer.last_activity = nowSeconds
  })
}

/**
 * End a session and return co-activation strengthening stats.
 *
 * @zh 结束 session 并返回共同激活增强统计。
 *
 * Rust reference: `SessionTracker::end_session` (`../src/graph.rs`).
 */
export function endSession(
  sessionTracker: SessionTracker,
  sessionId: string,
  records: ReadonlyMap<string, AuraRecord>,
): Effect.Effect<SessionResult> {
  return Effect.sync(() => {
    const buffer = sessionTracker.get(sessionId)
    const next = new Map(records)
    if (buffer === undefined) {
      return { stats: {}, records: next, updatedRecords: [] }
    }
    sessionTracker.delete(sessionId)
    return consolidateSession(buffer, next)
  })
}

/**
 * Remove stale sessions (inactive for > SESSION_TIMEOUT).
 *
 * @zh 清理超时 session，并在清理前按 Rust 语义执行共同激活 consolidation。
 *
 * Rust reference: `SessionTracker::cleanup_stale_sessions` (`../src/graph.rs`).
 */
export function cleanupStaleSessions(
  sessionTracker: SessionTracker,
  records: ReadonlyMap<string, AuraRecord>,
): Effect.Effect<CleanupStaleSessionsResult> {
  return Effect.gen(function* () {
    const clock = yield* Clock
    const nowSeconds = clock.nowSeconds()
    let next = new Map(records)
    const consolidatedSessions: string[] = []
    const updatedById = new Map<string, AuraRecord>()
    const staleSessionIds: string[] = []

    for (const [sessionId, buffer] of sessionTracker) {
      if (nowSeconds - buffer.last_activity > SESSION_TIMEOUT) {
        staleSessionIds.push(sessionId)
      }
    }

    for (const sessionId of staleSessionIds) {
      const buffer = sessionTracker.get(sessionId)
      if (buffer === undefined) continue
      sessionTracker.delete(sessionId)
      const result = consolidateSession(buffer, next)
      next = result.records
      consolidatedSessions.push(sessionId)
      for (const record of result.updatedRecords) updatedById.set(record.id, record)
    }

    return {
      consolidatedSessions,
      records: next,
      updatedRecords: Array.from(updatedById.values()),
    }
  })
}

/**
 * Strengthen connections between all records in a session.
 *
 * @zh 增强同一 session 内所有 records 两两之间的连接。
 *
 * Rust reference: `SessionTracker::consolidate_session` (`../src/graph.rs`).
 */
function consolidateSession(
  buffer: SessionBuffer,
  records: ReadonlyMap<string, AuraRecord>,
): SessionResult {
  const ids = Array.from(buffer.record_ids)
  const next = new Map(records)
  const updatedById = new Map<string, AuraRecord>()
  let pairsStrengthened = 0

  for (let i = 0; i < ids.length; i++) {
    const idA = ids[i]!
    for (let j = i + 1; j < ids.length; j++) {
      const idB = ids[j]!
      const recA = updatedById.get(idA) ?? next.get(idA)
      const recB = updatedById.get(idB) ?? next.get(idB)
      if (recA === undefined || recB === undefined) continue
      if (recA.namespace !== recB.namespace) continue

      const current = recA.connections[idB] ?? 0
      const delta = 0.05 * (1 - current)
      const boosted = Math.min(current + delta, 1)
      const updatedA = strengthenSessionPair(recA, idB, boosted)
      const updatedB = strengthenSessionPair(recB, idA, boosted)
      next.set(idA, updatedA)
      next.set(idB, updatedB)
      updatedById.set(idA, updatedA)
      updatedById.set(idB, updatedB)
      pairsStrengthened += 1
    }
  }

  return {
    stats: {
      pairs_strengthened: pairsStrengthened,
      session_records: ids.length,
    },
    records: next,
    updatedRecords: Array.from(updatedById.values()),
  }
}

/**
 * Set a session pair connection while preserving any existing relation type.
 *
 * @zh 写入 session pair 连接，并在关系类型缺失时补 `coactivation`。
 *
 * Rust reference: `SessionTracker::consolidate_session` (`../src/graph.rs`).
 */
function strengthenSessionPair(record: AuraRecord, otherId: string, boosted: number): AuraRecord {
  return {
    ...record,
    connections: {
      ...record.connections,
      [otherId]: boosted,
    },
    connection_types: {
      ...record.connection_types,
      ...(record.connection_types[otherId] === undefined ? { [otherId]: "coactivation" } : {}),
    },
  }
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
  tagIndex: TagIndex,
  records: ReadonlyMap<string, AuraRecord>,
): Effect.Effect<AutoConnectResult> {
  return Effect.sync(() => autoConnectSync(newRecord, tagIndex, records))
}

function autoConnectSync(
  newRecord: AuraRecord,
  tagIndex: TagIndex,
  records: ReadonlyMap<string, AuraRecord>,
): AutoConnectResult {
  const next = new Map(records)
  if (newRecord.tags.length === 0) {
    const record: AuraRecord = {
      ...newRecord,
      connections: { ...newRecord.connections },
      connection_types: { ...newRecord.connection_types },
    }
    return { connected: 0, record, records: next, updatedNeighbors: [] }
  }

  const candidates = new Map<string, number>()
  for (const tag of newRecord.tags) {
    const ids = tagIndex.get(tag)
    if (ids === undefined) continue
    for (const id of ids) {
      if (id === newRecord.id) continue
      candidates.set(id, (candidates.get(id) ?? 0) + 1)
    }
  }

  let connected = 0
  const connections: { [recordId: string]: number } = { ...newRecord.connections }
  const connectionTypes: { [recordId: string]: string } = { ...newRecord.connection_types }
  const updatedNeighbors: AuraRecord[] = []

  for (const [candidateId, sharedCount] of candidates) {
    if (Object.keys(connections).length >= MAX_CONNECTIONS) break

    const candidate = records.get(candidateId)
    if (candidate !== undefined && candidate.namespace !== newRecord.namespace) continue

    const weight = Math.min(0.2 + 0.15 * sharedCount, 0.8)
    connections[candidateId] = weight
    connectionTypes[candidateId] = "associative"

    if (candidate !== undefined && Object.keys(candidate.connections).length < MAX_CONNECTIONS) {
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
  return { connected, record, records: next, updatedNeighbors }
}

/**
 * Remove a record from an in-memory graph and clean its bidirectional neighbors.
 *
 * @zh 从内存 graph 中移除 record，并清理目标 record 已知邻居上的反向连接。
 *
 * NON-PARITY IMPLEMENTATION: this pure helper does not update `NGramIndex`,
 * `tag_index`, `aura_index`, or call `CognitiveStore.append_delete`; callers
 * must provide those persistent/index mutations at the facade layer.
 * @zh 非完全对齐：该纯 helper 不更新 `NGramIndex`、`tag_index`、`aura_index`，
 * 也不调用 `CognitiveStore.append_delete`；调用方必须在 facade 层补齐持久化/索引变更。
 * Rust reference: `graph::remove_record` (`../src/graph.rs`).
 */
export function removeRecord(
  recordId: string,
  records: ReadonlyMap<string, AuraRecord>,
): Effect.Effect<RemoveRecordResult> {
  return Effect.sync(() => removeRecordSync(recordId, records))
}

function removeRecordSync(
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
 * NON-PARITY IMPLEMENTATION: this pure helper does not update `NGramIndex`,
 * `tag_index`, `aura_index`, or call `CognitiveStore.append_update(keep)`;
 * callers must provide those persistent/index mutations at the facade layer.
 * @zh 非完全对齐：该纯 helper 不更新 `NGramIndex`、`tag_index`、`aura_index`，
 * 也不调用 `CognitiveStore.append_update(keep)`；调用方必须在 facade 层补齐持久化/索引变更。
 * Rust reference: `graph::merge_records` (`../src/graph.rs`).
 */
export function mergeRecords(
  keepId: string,
  removeId: string,
  records: ReadonlyMap<string, AuraRecord>,
): Effect.Effect<MergeRecordsResult> {
  return Effect.sync(() => mergeRecordsSync(keepId, removeId, records))
}

function mergeRecordsSync(
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

  const removal = removeRecordSync(removeId, next)
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
