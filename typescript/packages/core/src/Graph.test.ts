import { describe, it } from "vitest"
import { assert } from "@effect/vitest"
import { Level, type Record as AuraRecord } from "@aura/contract"
import { autoConnect, mergeRecords, removeRecord } from "./Graph"

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
  it("connects same-namespace records by shared tag count", () => {
    const records = new Map<string, AuraRecord>([
      ["b", record("b", {}, {}, ["rust"])],
      ["c", record("c", {}, {}, ["rust", "memory"])],
      ["other", record("other", {}, {}, ["rust", "memory"], "ops")],
    ])
    const next = record("a", {}, {}, ["rust", "memory"])

    const result = autoConnect(next, records)

    assert.strictEqual(result.connected, 2)
    assert.strictEqual(result.record.connections.b, 0.35)
    assert.strictEqual(result.record.connections.c, 0.5)
    assert.strictEqual(result.record.connections.other, undefined)
    assert.strictEqual(result.record.connection_types.b, "associative")
    assert.strictEqual(result.records.get("b")?.connections.a, 0.35)
    assert.strictEqual(result.records.get("c")?.connections.a, 0.5)
    assert.strictEqual(result.records.get("other")?.connections.a, undefined)
  })

  it("adds the new record without connections when it has no tags", () => {
    const result = autoConnect(record("a"), new Map())

    assert.strictEqual(result.connected, 0)
    assert.strictEqual(result.records.get("a")?.id, "a")
    assert.deepStrictEqual(result.record.connections, {})
  })
})

describe("graph removeRecord", () => {
  it("removes the target and cleans reverse edges on known neighbors", () => {
    const records = new Map<string, AuraRecord>([
      ["a", record("a", { b: 0.7, c: 0.4 }, { b: "causal", c: "associative" })],
      ["b", record("b", { a: 0.7 }, { a: "causal" })],
      ["c", record("c", { a: 0.4 }, { a: "associative" })],
    ])

    const result = removeRecord("a", records)

    assert.strictEqual(result.removed?.id, "a")
    assert.strictEqual(result.records.has("a"), false)
    assert.strictEqual(result.records.get("b")?.connections.a, undefined)
    assert.strictEqual(result.records.get("b")?.connection_types.a, undefined)
    assert.strictEqual(result.records.get("c")?.connections.a, undefined)
    assert.strictEqual(result.records.get("c")?.connection_types.a, undefined)
    assert.deepStrictEqual(result.updatedNeighbors.map((neighbor) => neighbor.id), ["b", "c"])
  })

  it("matches Rust remove_record by only visiting the target's connection keys", () => {
    const records = new Map<string, AuraRecord>([
      ["a", record("a")],
      ["orphan", record("orphan", { a: 0.9 }, { a: "associative" })],
    ])

    const result = removeRecord("a", records)

    assert.strictEqual(result.records.has("a"), false)
    assert.strictEqual(result.records.get("orphan")?.connections.a, 0.9)
    assert.strictEqual(result.records.get("orphan")?.connection_types.a, "associative")
    assert.strictEqual(result.updatedNeighbors.length, 0)
  })
})

describe("graph mergeRecords", () => {
  it("merges record fields then removes the merged record", () => {
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

    const result = mergeRecords("keep", "remove", records)
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
  })
})
