import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { Clock, Level, Record as AuraRecord } from "@aura/contract"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BrainAuraFile, CognitiveStoreFile, loadCognitiveRecords } from "@aura/storage"
import { Aura, recallRecords, recallScored } from "./index"
import * as RecallService from "./RecallService"

function recallTestRecord(
  id: string,
  content: string,
  level: Level,
  overrides: Partial<AuraRecord> = {},
): AuraRecord {
  return {
    id,
    content,
    level,
    strength: 1,
    activation_count: 0,
    created_at: 1_700_000_000,
    last_activated: 1_700_000_000,
    tags: [],
    connections: {},
    connection_types: {},
    content_type: "text",
    source_type: "recorded",
    namespace: "default",
    semantic_type: "fact",
    activation_velocity: 0,
    salience: 0,
    metadata: {},
    caused_by_id: null,
    confidence: 0.9,
    support_mass: 0,
    conflict_mass: 0,
    volatility: 0,
    ...overrides,
  }
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

  const clock = Clock.fixed(1_700_000_000)

  const scored = await Effect.runPromise(
    recallScored(dir, "ts", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(scored.some(([, id]) => id === "cog_1"))

  type HitRecord = { id: string }
  const hits = await Effect.runPromise(
    recallRecords<HitRecord>(dir, "ts", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(hits.some(([, rec]) => rec.id === "cog_1"))
})

it("RecallService formats preambles with Rust level order and labels", () => {
  const parent = recallTestRecord("parent", "Root causal note that should be previewed", Level.Working)
  const identity = recallTestRecord("identity", "I prefer Rust-shaped modules", Level.Identity, {
    tags: ["profile"],
  })
  const decision = recallTestRecord("decision", "Use RecallService for formatted recall", Level.Decisions, {
    tags: ["recall"],
    source_type: "generated",
    semantic_type: "decision",
    caused_by_id: "parent",
  })
  const records = new Map([
    [parent.id, parent],
    [identity.id, identity],
    [decision.id, decision],
  ])

  const output = RecallService.formatPreamble(
    [[0.8, decision], [0.9, identity]],
    2048,
    records,
  )

  assert.include(output, "=== COGNITIVE CONTEXT ===")
  assert.isTrue(output.indexOf("[IDENTITY]") < output.indexOf("[DECISIONS]"))
  assert.include(output, "I prefer Rust-shaped modules [profile]")
  assert.include(output, "Use RecallService for formatted recall [generated] {decision} [recall]")
  assert.include(output, "^ because: Root causal note")
  assert.include(output, "=== END CONTEXT ===")
})

it("RecallService cache keys and structured cache follow Rust cache semantics", async () => {
  assert.strictEqual(RecallService.textCacheKey("Query", ["beta", "alpha"]), 'Query|ns=["alpha", "beta"]')

  const hit = recallTestRecord("recall-cache", "cacheable structured result", Level.Working)
  const cache = RecallService.createStructuredRecallCache<AuraRecord>()
  let runs = 0
  const runCore = () => Effect.sync(() => {
    runs += 1
    return [[1, hit]] as ReadonlyArray<readonly [number, AuraRecord]>
  })

  const first = await Effect.runPromise(RecallService.recallStructuredCached(
    cache,
    "  Cache Query  ",
    5,
    0.123,
    ["default"],
    runCore,
  ))
  const second = await Effect.runPromise(RecallService.recallStructuredCached(
    cache,
    "cache query",
    5,
    0.12,
    ["default"],
    runCore,
  ))

  assert.strictEqual(runs, 1)
  assert.deepStrictEqual(second, first)
  RecallService.clearStructuredRecallCache(cache)
  await Effect.runPromise(RecallService.recallStructuredCached(cache, "cache query", 5, 0.12, ["default"], runCore))
  assert.strictEqual(runs, 2)
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

  const clock = Clock.fixed(1_700_000_000)

  const scored = await Effect.runPromise(
    Aura.recallScored(dir, "ts", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(scored.some(([, id]) => id === "cog_1"))
})

it("core recall persists Rust-style activation and co-recall strengthening", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-core-recall-finalize-"))
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
      yield* aura.flush()
      const store = yield* CognitiveStoreFile.open(dir)
      yield* store.appendStore({
        id: "rec_a",
        content: "alpha finalizer memory one",
        level: "Working",
        strength: 0.4,
        activation_count: 0,
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
      })
      yield* store.appendStore({
        id: "rec_b",
        content: "alpha finalizer memory two",
        level: "Working",
        strength: 0.5,
        activation_count: 1,
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
      })
      yield* store.flush()
    }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  )

  const clock = Clock.fixed(1_700_000_000)
  const scored = await Effect.runPromise(
    recallScored(dir, "alpha finalizer", { topK: 10, expandConnections: false }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provideService(Clock, clock)
    )
  )
  assert.isTrue(scored.some(([, id]) => id === "rec_a"))
  assert.isTrue(scored.some(([, id]) => id === "rec_b"))

  const records = await Effect.runPromise(loadCognitiveRecords(dir).pipe(Effect.provide(NodeFileReadLive)))
  const recA = records.get("rec_a")!
  const recB = records.get("rec_b")!
  assert.strictEqual(recA.activation_count, 1)
  assert.strictEqual(recB.activation_count, 2)
  assert.strictEqual(recA.last_activated, 1_700_000_000)
  assert.strictEqual(recB.last_activated, 1_700_000_000)
  assert.closeTo(recA.strength, 0.6, 1e-12)
  assert.closeTo(recB.strength, 0.7, 1e-12)
  assert.isTrue(recA.activation_velocity > 0)
  assert.strictEqual(recA.connections.rec_b, 0.05)
  assert.strictEqual(recB.connections.rec_a, 0.05)
})
