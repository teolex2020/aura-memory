import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Clock, Level, type Record as AuraRecord } from "@aura/contract"
import {
  SESSION_TIMEOUT,
  autoConnect,
  cleanupStaleSessions,
  createSessionTracker,
  createTagIndex,
  endSession,
  mergeRecords,
  removeRecord,
  trackActivation,
} from "./Graph"

function record(
  id: string,
  connections: Readonly<Record<string, number>> = {},
  connectionTypes: Readonly<Record<string, string>> = {},
  tags: ReadonlyArray<string> = [],
  namespace = "default",
  level = Level.Working,
  strength = 1,
  activationCount = 0,
  sourceType = "recorded",
): AuraRecord {
  return {
    id,
    content: id,
    level,
    strength,
    activation_count: activationCount,
    created_at: 0,
    last_activated: 0,
    tags,
    connections,
    connection_types: connectionTypes,
    content_type: "text",
    source_type: sourceType,
    namespace,
    semantic_type: "fact",
    activation_velocity: 0,
    salience: 0,
    metadata: {},
    caused_by_id: null,
    confidence: 0.9,
    support_mass: 0,
    conflict_mass: 0,
    volatility: 0,
  }
}

describe("graph autoConnect", () => {
  it.effect("connects same-namespace records by shared tag count", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      ["b", record("b", {}, {}, ["rust"])],
      ["c", record("c", {}, {}, ["rust", "memory"])],
      ["other", record("other", {}, {}, ["rust", "memory"], "ops")],
    ])
    const next = record("a", {}, {}, ["rust", "memory"])

    const tagIndex = createTagIndex(records, [next])
    const result = yield* autoConnect(next, tagIndex, records)

    assert.strictEqual(result.connected, 2)
    assert.strictEqual(result.record.connections.b, 0.35)
    assert.strictEqual(result.record.connections.c, 0.5)
    assert.strictEqual(result.record.connections.other, undefined)
    assert.strictEqual(result.record.connection_types.b, "associative")
    assert.strictEqual(result.records.get("b")?.connections.a, 0.35)
    assert.strictEqual(result.records.get("c")?.connections.a, 0.5)
    assert.strictEqual(result.records.get("other")?.connections.a, undefined)
    assert.strictEqual(result.records.has("a"), false)
  }))

  it.effect("adds the new record without connections when it has no tags", () => Effect.gen(function* () {
    const result = yield* autoConnect(record("a"), new Map(), new Map())

    assert.strictEqual(result.connected, 0)
    assert.strictEqual(result.records.has("a"), false)
    assert.deepStrictEqual(result.record.connections, {})
  }))

  it.effect("uses the Rust-shaped tag index as the candidate source", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      ["b", record("b", {}, {}, ["rust"])],
    ])
    const next = record("a", {}, {}, ["rust"])

    const result = yield* autoConnect(next, new Map(), records)

    assert.strictEqual(result.connected, 0)
    assert.strictEqual(result.record.connections.b, undefined)
    assert.strictEqual(result.records.get("b")?.connections.a, undefined)
  }))
})

describe("graph removeRecord", () => {
  it.effect("removes the target and cleans reverse edges on known neighbors", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      ["a", record("a", { b: 0.7, c: 0.4 }, { b: "causal", c: "associative" })],
      ["b", record("b", { a: 0.7 }, { a: "causal" })],
      ["c", record("c", { a: 0.4 }, { a: "associative" })],
    ])

    const result = yield* removeRecord("a", records)

    assert.strictEqual(result.removed?.id, "a")
    assert.strictEqual(result.records.has("a"), false)
    assert.strictEqual(result.records.get("b")?.connections.a, undefined)
    assert.strictEqual(result.records.get("b")?.connection_types.a, undefined)
    assert.strictEqual(result.records.get("c")?.connections.a, undefined)
    assert.strictEqual(result.records.get("c")?.connection_types.a, undefined)
    assert.deepStrictEqual(result.updatedNeighbors.map((neighbor) => neighbor.id), ["b", "c"])
  }))

  it.effect("matches Rust remove_record by only visiting the target's connection keys", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      ["a", record("a")],
      ["orphan", record("orphan", { a: 0.9 }, { a: "associative" })],
    ])

    const result = yield* removeRecord("a", records)

    assert.strictEqual(result.records.has("a"), false)
    assert.strictEqual(result.records.get("orphan")?.connections.a, 0.9)
    assert.strictEqual(result.records.get("orphan")?.connection_types.a, "associative")
    assert.strictEqual(result.updatedNeighbors.length, 0)
  }))
})

describe("graph mergeRecords", () => {
  it.effect("merges record fields then removes the merged record", () => Effect.gen(function* () {
    const records = new Map<string, AuraRecord>([
      [
        "keep",
        record(
          "keep",
          { shared: 0.2, remove: 0.9 },
          {},
          ["keep"],
          "default",
          Level.Working,
          0.4,
          2,
          "generated",
        ),
      ],
      [
        "remove",
        record(
          "remove",
          { keep: 0.9, shared: 0.7, extra: 0.5 },
          { keep: "associative", shared: "causal", extra: "reflective" },
          ["remove", "keep"],
          "default",
          Level.Domain,
          0.8,
          3,
          "recorded",
        ),
      ],
      ["shared", record("shared", { remove: 0.7 }, { remove: "causal" })],
      ["extra", record("extra", { remove: 0.5 }, { remove: "reflective" })],
    ])

    const result = yield* mergeRecords("keep", "remove", records)
    const keep = result.keep!

    assert.strictEqual(result.records.has("remove"), false)
    assert.strictEqual(keep.level, Level.Domain)
    assert.deepStrictEqual(keep.tags, ["keep", "remove"])
    assert.strictEqual(keep.connections.shared, 0.7)
    assert.strictEqual(keep.connections.extra, 0.5)
    assert.strictEqual(keep.connections.remove, undefined)
    assert.strictEqual(keep.connection_types.shared, "causal")
    assert.strictEqual(keep.connection_types.extra, "reflective")
    assert.strictEqual(keep.strength, 0.64)
    assert.strictEqual(keep.activation_count, 5)
    assert.strictEqual(keep.source_type, "recorded")
    assert.strictEqual(result.records.get("shared")?.connections.remove, undefined)
    assert.strictEqual(result.records.get("extra")?.connections.remove, undefined)
  }))
})

describe("graph SessionTracker", () => {
  let nowSeconds = 0
  const TestClockLayer = Layer.succeed(Clock)({ nowSeconds: () => nowSeconds }) as Layer.Layer<Clock, never, never>

  it.layer(TestClockLayer)("with injectable Clock", (it) => {
    it.effect("tracks activation and consolidates same-namespace session records", () => Effect.gen(function* () {
      nowSeconds = 100
      const tracker = createSessionTracker()
      const records = new Map<string, AuraRecord>([
        ["a", record("a")],
        ["b", record("b")],
        ["ops", record("ops", {}, {}, [], "ops")],
      ])

      yield* trackActivation(tracker, "s1", ["a", "b", "ops"])
      const result = yield* endSession(tracker, "s1", records)

      assert.strictEqual(tracker.has("s1"), false)
      assert.deepStrictEqual(result.stats, { pairs_strengthened: 1, session_records: 3 })
      assert.strictEqual(result.records.get("a")?.connections.b, 0.05)
      assert.strictEqual(result.records.get("b")?.connections.a, 0.05)
      assert.strictEqual(result.records.get("a")?.connections.ops, undefined)
      assert.strictEqual(result.records.get("a")?.connection_types.b, "coactivation")
      assert.strictEqual(result.records.get("b")?.connection_types.a, "coactivation")
    }))

    it.effect("cleans stale sessions after timeout and leaves active sessions buffered", () => Effect.gen(function* () {
      const tracker = createSessionTracker()
      const records = new Map<string, AuraRecord>([
        ["a", record("a")],
        ["b", record("b")],
        ["c", record("c")],
      ])

      nowSeconds = 100
      yield* trackActivation(tracker, "stale", ["a", "b"])
      nowSeconds = 100 + SESSION_TIMEOUT
      yield* trackActivation(tracker, "active", ["b", "c"])
      nowSeconds = 101 + SESSION_TIMEOUT
      const result = yield* cleanupStaleSessions(tracker, records)

      assert.deepStrictEqual(result.consolidatedSessions, ["stale"])
      assert.strictEqual(tracker.has("stale"), false)
      assert.strictEqual(tracker.has("active"), true)
      assert.strictEqual(result.records.get("a")?.connections.b, 0.05)
      assert.strictEqual(result.records.get("b")?.connections.a, 0.05)
      assert.strictEqual(result.records.get("b")?.connections.c, undefined)
    }))
  })
})
