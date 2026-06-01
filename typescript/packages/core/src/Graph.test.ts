import { describe, it } from "vitest"
import { assert } from "@effect/vitest"
import { Level, type Record as AuraRecord } from "@aura/contract"
import { removeRecord } from "./Graph"

function record(
  id: string,
  connections: Readonly<Record<string, number>> = {},
  connectionTypes: Readonly<Record<string, string>> = {},
): AuraRecord {
  return {
    id,
    content: id,
    level: Level.Working,
    strength: 1,
    activation_count: 0,
    created_at: 0,
    last_activated: 0,
    tags: [],
    connections,
    connection_types: connectionTypes,
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
  }
}

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
