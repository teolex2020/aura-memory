import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Level, Record as AuraRecord } from "./index"

function record(overrides: Partial<AuraRecord> = {}): AuraRecord {
  return {
    id: "record-1",
    content: "importance fixture",
    level: Level.Identity,
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
    aura_id: null,
    caused_by_id: null,
    confidence: 0.9,
    support_mass: 0,
    conflict_mass: 0,
    volatility: 0,
    ...overrides,
  }
}

it("Record.importance mirrors the Rust weighted formula", () => {
  assert.ok(Math.abs(AuraRecord.importance(record()) - 0.65) < 0.0001)
  assert.ok(AuraRecord.importance(record({ salience: 1 })) > AuraRecord.importance(record({ salience: 0 })))
  assert.ok(AuraRecord.importance(record({ salience: 2 })) <= AuraRecord.importance(record({ salience: 1 })))
})
