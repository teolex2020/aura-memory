import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { Clock } from "@aura/contract"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BrainAuraFile, CognitiveStoreFile } from "@aura/storage"
import { Aura, recallRecords, recallScored } from "./index"

function fixedClock(nowUnixSec: number) {
  return { nowSeconds: () => Effect.succeed(nowUnixSec) }
}

it("core recallScored + recallRecords work via RecallViewLive + recallPipeline", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-core-recall-"))
  const indexDir = path.join(dir, "index")
  fs.mkdirSync(indexDir, { recursive: true })

  fs.copyFileSync(
    path.join(process.cwd(), "test/fixtures/minimal_index/index_manifest.json"),
    path.join(indexDir, "index_manifest.json")
  )
  fs.copyFileSync(path.join(process.cwd(), "test/fixtures/minimal_index/sdr.idx"), path.join(indexDir, "sdr.idx"))

  await Effect.runPromise(
    Effect.gen(function* () {
      const aura = yield* BrainAuraFile.open(dir)
      yield* aura.append({
        id: "ts_fixture_1",
        dna: "user_core",
        timestamp: 1,
        intensity: 0.1,
        stability: 0.2,
        decay_velocity: 0.3,
        entropy: 0.4,
        sdr_indices: [1, 10, 100, 2000],
        text: "Hello TS Fixture"
      })
      yield* aura.flush()
    }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  )

  const recordsToWrite: ReadonlyArray<Record<string, unknown>> = [
    { id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" },
    { id: "cog_2", content: "hello index", tags: ["index"], aura_id: "doc_a" }
  ]

  await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CognitiveStoreFile.open(dir)
      for (const r of recordsToWrite) {
        yield* store.appendStore(r)
      }
      yield* store.flush()
      yield* store.writeSnapshot(recordsToWrite)
    }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )

  const clock = fixedClock(1_700_000_000)

  const scored = await Effect.runPromise(
    recallScored(dir, "ts", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(scored.some(([, id]) => id === "cog_1"))

  type HitRecord = { id: string }
  const hits = await Effect.runPromise(
    recallRecords<HitRecord>(dir, "ts", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(hits.some(([, rec]) => rec.id === "cog_1"))
})

it("Aura.recall* facade delegates to core Recall.ts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-core-recall-facade-"))
  const indexDir = path.join(dir, "index")
  fs.mkdirSync(indexDir, { recursive: true })

  fs.copyFileSync(
    path.join(process.cwd(), "test/fixtures/minimal_index/index_manifest.json"),
    path.join(indexDir, "index_manifest.json")
  )
  fs.copyFileSync(path.join(process.cwd(), "test/fixtures/minimal_index/sdr.idx"), path.join(indexDir, "sdr.idx"))

  await Effect.runPromise(
    Effect.gen(function* () {
      const aura = yield* BrainAuraFile.open(dir)
      yield* aura.append({
        id: "ts_fixture_1",
        dna: "user_core",
        timestamp: 1,
        intensity: 0.1,
        stability: 0.2,
        decay_velocity: 0.3,
        entropy: 0.4,
        sdr_indices: [1, 10, 100, 2000],
        text: "Hello TS Fixture"
      })
      yield* aura.flush()
    }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  )

  await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* CognitiveStoreFile.open(dir)
      yield* store.appendStore({ id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" })
      yield* store.flush()
      yield* store.writeSnapshot([
        { id: "cog_1", content: "Hello TS Fixture", tags: ["ts"], aura_id: "ts_fixture_1" }
      ])
    }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )

  const clock = fixedClock(1_700_000_000)

  const scored = await Effect.runPromise(
    Aura.recallScored(dir, "ts", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(scored.some(([, id]) => id === "cog_1"))
})
