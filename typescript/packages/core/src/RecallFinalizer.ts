import { Effect, Layer } from "effect"
import {
  Clock,
  FileFormatError,
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  FinalizeError,
  RecallFinalizer,
  type RecallScored,
  type Record as AuraRecord,
} from "@aura/contract"
import { CognitiveStoreFile, loadCognitiveRecords } from "@aura/storage"

const MAX_FINALIZED_RECORDS = 10
const ACTIVATION_VELOCITY_ALPHA = 0.3

/**
 * Aura-owned session-scoped co-activation tracker.
 * Aura 实例持有的 session 范围共同激活追踪器。
 * Rust reference: `SessionTracker` (`../src/graph.rs`).
 */
export type RecallSessionTracker = Map<string, Set<string>>

// ── Activation & Co-recall strengthening ──

/**
 * Activate a recalled record and update activation velocity.
 * 激活被召回的 record，并更新 activation velocity。
 * Rust reference: `Record::activate` / `activate_and_strengthen` (`../src/record.rs`, `../src/recall.rs`).
 */
function activateRecord(record: AuraRecord, nowSeconds: number): AuraRecord {
  const gapDays = Math.max((nowSeconds - record.last_activated) / 86_400, 0.001)
  const instantRate = Math.min(1 / gapDays, 100)
  return {
    ...record,
    strength: Math.min(record.strength + 0.2, 1),
    activation_count: record.activation_count + 1,
    last_activated: nowSeconds,
    activation_velocity:
      ACTIVATION_VELOCITY_ALPHA * instantRate +
      (1 - ACTIVATION_VELOCITY_ALPHA) * record.activation_velocity,
  }
}

/**
 * Strengthen a co-recalled pair with diminishing returns.
 * 用递减收益增强共同召回 pair。
 * Rust reference: `activate_and_strengthen` (`../src/recall.rs`).
 */
function strengthenPair(record: AuraRecord, otherId: string): AuraRecord {
  const current = record.connections[otherId] ?? 0
  const delta = 0.05 * (1 - current)
  const boosted = Math.min(current + delta, 1)
  return {
    ...record,
    connections: {
      ...record.connections,
      [otherId]: boosted,
    },
  }
}

/**
 * Strengthen a session pair and preserve existing relation type.
 * 增强 session pair，并保留已有 relation type。
 * Rust reference: `SessionTracker::end_session` / `consolidate_session` (`../src/graph.rs`).
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
 * Limit recall finalization to the same top-N records as Rust.
 * 将 recall finalize 限制为与 Rust 相同的 top-N records。
 * Rust reference: `activate_and_strengthen` (`../src/recall.rs`).
 */
function topRecordIds(scored: RecallScored): ReadonlyArray<string> {
  return scored.slice(0, MAX_FINALIZED_RECORDS).map(([, recordId]) => recordId)
}

/**
 * Manages session-scoped co-activation tracking.
 * 管理 session 范围的共同激活追踪。
 * Rust reference: `SessionTracker::new` (`../src/graph.rs`).
 */
export function createRecallSessionTracker(): RecallSessionTracker {
  return new Map<string, Set<string>>()
}

/**
 * Track that these record IDs were activated in a session.
 * 记录这些 record IDs 在同一个 session 中被激活。
 * Rust reference: `SessionTracker::track_activation` (`../src/graph.rs`).
 */
export function trackRecallSession(
  sessionTracker: RecallSessionTracker | undefined,
  sessionId: string | undefined,
  recordIds: ReadonlyArray<string>
): void {
  if (sessionTracker === undefined || sessionId === undefined) return
  let ids = sessionTracker.get(sessionId)
  if (ids === undefined) {
    ids = new Set<string>()
    sessionTracker.set(sessionId, ids)
  }
  for (const id of recordIds) ids.add(id)
}

/**
 * End a session and return co-activation strengthening stats.
 * 结束 session 并返回共同激活增强统计。
 * Rust reference: `Aura::end_session` and `SessionTracker::end_session` (`../src/aura.rs`, `../src/graph.rs`).
 */
export function endRecallSession(
  brainDir: string,
  sessionTracker: RecallSessionTracker,
  sessionId: string
): Effect.Effect<Record<string, number>, FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
  const ids = sessionTracker.get(sessionId)
  if (ids === undefined) return Effect.succeed({})
  sessionTracker.delete(sessionId)
  const recordIds = Array.from(ids)

  return Effect.gen(function* () {
    const records = yield* loadCognitiveRecords(brainDir)
    const updates = new Map<string, AuraRecord>()
    let pairsStrengthened = 0

    for (let i = 0; i < recordIds.length; i++) {
      const idA = recordIds[i]!
      for (let j = i + 1; j < recordIds.length; j++) {
        const idB = recordIds[j]!
        const recA = updates.get(idA) ?? records.get(idA)
        const recB = updates.get(idB) ?? records.get(idB)
        if (recA === undefined || recB === undefined) continue
        if (recA.namespace !== recB.namespace) continue

        const current = recA.connections[idB] ?? 0
        const delta = 0.05 * (1 - current)
        const boosted = Math.min(current + delta, 1)
        updates.set(idA, strengthenSessionPair(recA, idB, boosted))
        updates.set(idB, strengthenSessionPair(recB, idA, boosted))
        pairsStrengthened += 1
      }
    }

    if (updates.size > 0) {
      const store = yield* CognitiveStoreFile.open(brainDir)
      for (const record of updates.values()) {
        yield* store.appendUpdate(record)
      }
      yield* store.flush()
    }

    return {
      pairs_strengthened: pairsStrengthened,
      session_records: recordIds.length,
    }
  })
}

/**
 * Activate top records and strengthen co-recalled connections.
 * 激活 top records，并增强共同召回记录之间的连接。
 * Rust reference: `activate_and_strengthen` (`../src/recall.rs`).
 *
 * @zh 默认 recall_core 副作用必须落盘，否则后续 graph/causal 扩展缺少长期 co-recall 状态。
 */
export function finalizeRecallRecords(
  brainDir: string,
  scored: RecallScored,
  sessionId?: string,
  sessionTracker?: RecallSessionTracker
): Effect.Effect<void, FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
  const topIds = topRecordIds(scored)
  trackRecallSession(sessionTracker, sessionId, topIds)
  if (topIds.length === 0) return Effect.void

  return Effect.gen(function* () {
    const clock = yield* Clock
    const nowSeconds = clock.nowSeconds()
    const records = yield* loadCognitiveRecords(brainDir)
    const updates = new Map<string, AuraRecord>()

    for (const id of topIds) {
      const base = updates.get(id) ?? records.get(id)
      if (base !== undefined) {
        updates.set(id, activateRecord(base, nowSeconds))
      }
    }

    for (let i = 0; i < topIds.length; i++) {
      const idA = topIds[i]!
      if (!updates.has(idA)) continue
      for (let j = i + 1; j < topIds.length; j++) {
        const idB = topIds[j]!
        if (!updates.has(idB)) continue
        updates.set(idA, strengthenPair(updates.get(idA)!, idB))
        updates.set(idB, strengthenPair(updates.get(idB)!, idA))
      }
    }

    if (updates.size === 0) return

    const store = yield* CognitiveStoreFile.open(brainDir)
    for (const record of updates.values()) {
      yield* store.appendUpdate(record)
    }
    yield* store.flush()
  })
}

export function RecallFinalizerFileLive(brainDir: string, sessionTracker?: RecallSessionTracker) {
  return Layer.effect(
    RecallFinalizer,
    Effect.gen(function* () {
      const fileRead = yield* Effect.service(FileRead)
      const fileWrite = yield* Effect.service(FileWrite)
      const clock = yield* Clock

      return {
        finalize: (scored: RecallScored, sessionId?: string) =>
          finalizeRecallRecords(brainDir, scored, sessionId, sessionTracker).pipe(
            Effect.provideService(FileRead, fileRead),
            Effect.provideService(FileWrite, fileWrite),
            Effect.provideService(Clock, clock),
            Effect.mapError((cause) => new FinalizeError({ cause }))
          ),
      }
    })
  )
}
