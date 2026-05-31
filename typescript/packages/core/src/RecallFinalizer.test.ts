import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { Clock, Level, RecallFinalizer, type Record as AuraRecord } from "@aura/contract"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile, loadCognitiveRecords } from "@aura/storage"
import { createRecallSessionTracker, RecallFinalizerFileLive } from "./RecallFinalizer"

function provideNode<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
}

function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function record(id: string, content: string, activationCount = 0): AuraRecord {
  return {
    id,
    content,
    level: Level.Working,
    strength: 0.4,
    activation_count: activationCount,
    created_at: 1_699_913_600,
    last_activated: 1_699_913_600,
    tags: ["alpha"],
    connections: {},
    connection_types: {},
    content_type: "text",
    source_type: "recorded",
    namespace: "default",
    semantic_type: "fact",
    activation_velocity: 0,
    salience: 0,
    metadata: {},
    confidence: 0.9,
    support_mass: 0,
    conflict_mass: 0,
    volatility: 0,
  }
}

function seedRecords(dir: string, records: ReadonlyArray<AuraRecord>) {
  return Effect.gen(function* () {
    const store = yield* CognitiveStoreFile.open(dir)
    for (const rec of records) {
      yield* store.appendStore(rec)
    }
    yield* store.flush()
    yield* store.writeSnapshot(records)
  })
}

describe("RecallFinalizerFileLive", () => {
  it("accepts empty scored lists", async () => {
    const dir = tempDir("aura-core-finalizer-empty-")

    await Effect.runPromise(
      provideNode(
        Effect.gen(function* () {
          const finalizer = yield* Effect.service(RecallFinalizer)
          yield* finalizer.finalize([], "session-empty")
        }).pipe(
          Effect.provide(RecallFinalizerFileLive(dir)),
          Effect.provideService(Clock, Clock.fixed(1_700_000_000))
        )
      )
    )
  })

  it("persists activation and co-recall strengthening", async () => {
    const dir = tempDir("aura-core-finalizer-persist-")
    const clock = Clock.fixed(1_700_000_000)

    await Effect.runPromise(
      provideNode(seedRecords(dir, [
        record("rec_a", "alpha finalizer memory one"),
        record("rec_b", "alpha finalizer memory two", 1),
      ]))
    )

    await Effect.runPromise(
      provideNode(
        Effect.gen(function* () {
          const finalizer = yield* Effect.service(RecallFinalizer)
          yield* finalizer.finalize([[0.9, "rec_a"], [0.8, "rec_b"]])
        }).pipe(Effect.provide(RecallFinalizerFileLive(dir)), Effect.provideService(Clock, clock))
      )
    )

    const records = await Effect.runPromise(loadCognitiveRecords(dir).pipe(Effect.provide(NodeFileReadLive)))
    const recA = records.get("rec_a")!
    const recB = records.get("rec_b")!
    assert.strictEqual(recA.activation_count, 1)
    assert.strictEqual(recB.activation_count, 2)
    assert.strictEqual(recA.last_activated, 1_700_000_000)
    assert.strictEqual(recB.last_activated, 1_700_000_000)
    assert.closeTo(recA.strength, 0.6, 1e-12)
    assert.closeTo(recB.strength, 0.6, 1e-12)
    assert.isTrue(recA.activation_velocity > 0)
    assert.isTrue(recB.activation_velocity > 0)
    assert.strictEqual(recA.connections.rec_b, 0.05)
    assert.strictEqual(recB.connections.rec_a, 0.05)
  })

  it("tracks session ids through Aura-owned session tracker", async () => {
    const dir = tempDir("aura-core-finalizer-session-")
    const clock = Clock.fixed(1_700_000_000)
    const tracker = createRecallSessionTracker()

    await Effect.runPromise(
      provideNode(seedRecords(dir, [
        record("rec_a", "alpha finalizer memory one"),
        record("rec_b", "alpha finalizer memory two"),
      ]))
    )

    await Effect.runPromise(
      provideNode(
        Effect.gen(function* () {
          const finalizer = yield* Effect.service(RecallFinalizer)
          yield* finalizer.finalize([[0.9, "rec_a"], [0.8, "rec_b"]], "session-1")
        }).pipe(Effect.provide(RecallFinalizerFileLive(dir, tracker)), Effect.provideService(Clock, clock))
      )
    )

    assert.deepStrictEqual(Array.from(tracker.get("session-1") ?? []), ["rec_a", "rec_b"])
  })
})
