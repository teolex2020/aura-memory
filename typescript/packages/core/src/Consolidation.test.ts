import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { FileWrite, Level, Record as AuraRecord } from "@aura/contract"
import { NGramIndex } from "@aura/indexing"
import { consolidate, createAuraIndex, type ConsolidationStore } from "./Consolidation"
import { createTagIndex } from "./Graph"

const NoopFileWrite = {
  mkdirp: () => Effect.void,
  writeFile: () => Effect.void,
  appendFile: () => Effect.void,
  writeAt: () => Effect.void,
  fsync: () => Effect.void,
  rename: () => Effect.void,
}

function record(overrides: Partial<AuraRecord> = {}): AuraRecord {
  const id = overrides.id ?? "record-1"
  return {
    id,
    content: "duplicate consolidation memory",
    level: Level.Working,
    strength: 1,
    activation_count: 0,
    created_at: 0,
    last_activated: 0,
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
    aura_id: `aura-${id}`,
    caused_by_id: null,
    confidence: 0.9,
    support_mass: 0,
    conflict_mass: 0,
    volatility: 0,
    ...overrides,
  }
}

function index(records: ReadonlyMap<string, AuraRecord>): NGramIndex {
  const ngram = NGramIndex.withSeed0()
  for (const item of records.values()) ngram.add(item.id, item.content)
  return ngram
}

function store() {
  const updates: AuraRecord[] = []
  const deletes: string[] = []
  let flushes = 0
  const api: ConsolidationStore = {
    appendUpdate: (item) => Effect.sync(() => { updates.push(item) }),
    appendDelete: (id) => Effect.sync(() => { deletes.push(id) }),
    flush: () => Effect.sync(() => { flushes += 1 }),
  }
  return { api, updates, deletes, get flushes() { return flushes } }
}

describe("consolidation", () => {
  it.effect("hard-merges same-namespace duplicates through Graph.mergeRecords", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      ["low", record({ id: "low", level: Level.Working, strength: 0.2, tags: ["shared", "low"] })],
      ["high", record({ id: "high", level: Level.Domain, strength: 1, tags: ["shared", "high"] })],
    ])
    const ngram = index(records)
    const tagIndex = createTagIndex(records)
    const auraIndex = createAuraIndex(records)
    const sink = store()

    const result = yield* consolidate(records, ngram, tagIndex, auraIndex, sink.api).pipe(
      Effect.provideService(FileWrite, NoopFileWrite),
    )

    assert.deepStrictEqual(result, { merged: 1, checked: 1 })
    assert.strictEqual(records.has("low"), false)
    assert.strictEqual(records.has("high"), true)
    assert.strictEqual(records.get("high")?.tags.includes("low"), true)
    assert.strictEqual(ngram.contains("low"), false)
    assert.strictEqual(tagIndex.get("low")?.has("low"), false)
    assert.strictEqual(auraIndex.has("aura-low"), false)
    assert.deepStrictEqual(sink.deletes, ["low"])
    assert.deepStrictEqual(sink.updates.map((item) => item.id), ["high"])
    assert.strictEqual(sink.flushes, 1)
  }))

  it.effect("does not merge duplicate content across namespaces", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      ["default", record({ id: "default", namespace: "default" })],
      ["ops", record({ id: "ops", namespace: "ops" })],
    ])
    const sink = store()

    const result = yield* consolidate(records, index(records), createTagIndex(records), createAuraIndex(records), sink.api).pipe(
      Effect.provideService(FileWrite, NoopFileWrite),
    )

    assert.deepStrictEqual(result, { merged: 0, checked: 0 })
    assert.strictEqual(records.size, 2)
    assert.deepStrictEqual(sink.deletes, [])
    assert.strictEqual(sink.flushes, 0)
  }))
})
