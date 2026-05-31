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

// ── Activation & Co-recall strengthening ──

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

function topRecordIds(scored: RecallScored): ReadonlyArray<string> {
  return scored.slice(0, MAX_FINALIZED_RECORDS).map(([, recordId]) => recordId)
}

export function finalizeRecallRecords(
  brainDir: string,
  scored: RecallScored
): Effect.Effect<void, FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
  // Activate top records and strengthen co-recalled connections.
  // 激活 top records，并增强共同召回记录之间的连接。
  // Rust reference: `activate_and_strengthen` (recall.rs).
  // 中文说明：默认 recall_core 副作用必须落盘，否则后续 graph/causal 扩展缺少长期 co-recall 状态。
  const topIds = topRecordIds(scored)
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

export function RecallFinalizerFileLive(brainDir: string) {
  return Layer.effect(
    RecallFinalizer,
    Effect.gen(function* () {
      const fileRead = yield* Effect.service(FileRead)
      const fileWrite = yield* Effect.service(FileWrite)
      const clock = yield* Clock

      return {
        finalize: (scored: RecallScored, _sessionId?: string) =>
          // NON-PARITY IMPLEMENTATION: TS 目前没有 file-backed SessionTracker/AuditLog；
          // Rust reference: activate_and_strengthen(..., session_tracker, session_id) / RecallService::finalize。
          finalizeRecallRecords(brainDir, scored).pipe(
            Effect.provideService(FileRead, fileRead),
            Effect.provideService(FileWrite, fileWrite),
            Effect.provideService(Clock, clock),
            Effect.mapError((cause) => new FinalizeError({ cause }))
          ),
      }
    })
  )
}
