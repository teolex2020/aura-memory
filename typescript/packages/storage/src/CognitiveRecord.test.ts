import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { CognitiveStoreFile } from "./CognitiveStoreFile"
import { loadCognitiveRecords, normalizeCognitiveRecord } from "./CognitiveRecord"

it("loadCognitiveRecords reads brain.cog + brain.snap and normalizes record shape", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cogrec-"))

  const record: any = {
    id: "r1",
    content: "hello",
    aura_id: "a1"
  }

  const writeProgram = Effect.gen(function* () {
    const store = yield* CognitiveStoreFile.open(dir)
    yield* store.appendStore(record)
    yield* store.flush()
    yield* store.writeSnapshot([record])
  }).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))

  await Effect.runPromise(writeProgram)

  const readProgram = Effect.gen(function* () {
    const records = yield* loadCognitiveRecords(dir)
    const r = records.get("r1")!
    assert.strictEqual(r.id, "r1")
    assert.strictEqual(r.content, "hello")
    assert.deepStrictEqual(r.tags, [])
    assert.strictEqual(r.aura_id, "a1")
    assert.strictEqual(r.source_type, "recorded")
    assert.strictEqual(r.semantic_type, "fact")
    assert.strictEqual(r.activation_velocity, 0)
    assert.strictEqual(r.salience, 0)
    assert.strictEqual(r.confidence, 0.9)
    assert.strictEqual(r.support_mass, 0)
    assert.strictEqual(r.conflict_mass, 0)
    assert.strictEqual(r.volatility, 0)
  }).pipe(Effect.provide(NodeFileReadLive))

  await Effect.runPromise(readProgram)
})

it("normalizeCognitiveRecord filters malformed collection fields and applies Rust defaults", () => {
  const rec = normalizeCognitiveRecord({
    id: "r2",
    content: 42,
    level: "unknown",
    strength: Number.POSITIVE_INFINITY,
    activation_count: "bad",
    tags: ["kept", 1, null],
    connections: { good: 0.5, bad: "x", nan: Number.NaN },
    connection_types: { good: "causal", bad: 1 },
    metadata: { source: "test", ignored: 123 },
    source_type: "retrieved",
    semantic_type: "decision",
  })

  if (!rec) throw new Error("expected normalized record")
  assert.strictEqual(rec.id, "r2")
  assert.strictEqual(rec.content, "")
  assert.strictEqual(rec.level, "Working")
  assert.strictEqual(rec.strength, 1)
  assert.strictEqual(rec.activation_count, 0)
  assert.deepStrictEqual(rec.tags, ["kept"])
  assert.deepStrictEqual(rec.connections, { good: 0.5 })
  assert.deepStrictEqual(rec.connection_types, { good: "causal" })
  assert.deepStrictEqual(rec.metadata, { source: "test" })
  assert.strictEqual(rec.source_type, "retrieved")
  assert.strictEqual(rec.semantic_type, "decision")
  assert.strictEqual(rec.confidence, 0.9)
  assert.strictEqual(rec.activation_velocity, 0)
  assert.strictEqual(rec.salience, 0)
  assert.strictEqual(rec.volatility, 0)
})
