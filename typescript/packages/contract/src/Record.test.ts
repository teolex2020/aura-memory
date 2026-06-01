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

it("Record.make mirrors Rust Record::new defaults", () => {
  const made = AuraRecord.make("Hello world", Level.Working, { id: "abc123def456", nowSeconds: 1_700_000_000 })

  assert.strictEqual(made.id, "abc123def456")
  assert.strictEqual(made.content, "Hello world")
  assert.strictEqual(made.level, Level.Working)
  assert.strictEqual(made.strength, 1)
  assert.strictEqual(made.activation_count, 0)
  assert.strictEqual(made.created_at, 1_700_000_000)
  assert.strictEqual(made.last_activated, 1_700_000_000)
  assert.deepStrictEqual(made.tags, [])
  assert.deepStrictEqual(made.connections, {})
  assert.deepStrictEqual(made.connection_types, {})
  assert.strictEqual(made.content_type, "text")
  assert.strictEqual(made.namespace, "default")
  assert.strictEqual(made.source_type, "recorded")
  assert.strictEqual(made.semantic_type, "fact")
  assert.strictEqual(made.confidence, 0.9)
  assert.strictEqual(made.support_mass, 0)
  assert.strictEqual(made.conflict_mass, 0)
  assert.strictEqual(made.volatility, 0)
})

it("Record.generateId returns Rust-shaped 12-char hex ids", () => {
  assert.match(AuraRecord.generateId(), /^[0-9a-f]{12}$/)
})

it("Record.activate mirrors Rust activation and velocity update", () => {
  const activated = AuraRecord.activate(record({
    strength: 0.5,
    last_activated: 1_699_913_600,
    activation_velocity: 0.2,
  }), 1_700_000_000)

  assert.strictEqual(activated.strength, 0.7)
  assert.strictEqual(activated.activation_count, 1)
  assert.strictEqual(activated.last_activated, 1_700_000_000)
  assert.ok(Math.abs(activated.activation_velocity - 0.44) < 0.0001)
})

it("Record.applyDecay mirrors Rust adaptive retention", () => {
  assert.ok(Math.abs(AuraRecord.applyDecay(record({ level: Level.Working })).strength - 0.8) < 0.0001)
  assert.ok(Math.abs(AuraRecord.applyDecay(record({ level: Level.Working, activation_count: 10 })).strength - 0.999) < 0.0001)
  assert.ok(AuraRecord.applyDecay(record({ level: Level.Working, salience: 1 })).strength > 0.8)
})

it("Record promotion and liveness helpers mirror Rust thresholds", () => {
  assert.isTrue(AuraRecord.isAlive(record({ strength: 0.05 })))
  assert.isFalse(AuraRecord.isAlive(record({ strength: 0.049 })))
  assert.isTrue(AuraRecord.canPromote(record({ level: Level.Working, activation_count: 5, strength: 0.7 })))
  assert.isFalse(AuraRecord.canPromote(record({ level: Level.Identity, activation_count: 5, strength: 0.7 })))

  const promoted = AuraRecord.promote(record({ level: Level.Working }))
  assert.isTrue(promoted.promoted)
  assert.strictEqual(promoted.record.level, Level.Decisions)
  assert.isFalse(AuraRecord.promote(record({ level: Level.Identity })).promoted)
})

it("Record connection helpers mirror Rust typed connection behavior", () => {
  const connected = AuraRecord.addConnection(record(), "other-1", 1.5)
  assert.strictEqual(connected.connections["other-1"], 1)
  assert.isUndefined(AuraRecord.connectionType(connected, "other-1"))

  const typed = AuraRecord.addTypedConnection(connected, "other-2", 0.5, "causal")
  assert.strictEqual(typed.connections["other-2"], 0.5)
  assert.strictEqual(AuraRecord.connectionType(typed, "other-2"), "causal")
})

it("Record age helpers mirror Rust day calculations", () => {
  const rec = record({ created_at: 1_699_827_200, last_activated: 1_699_913_600 })
  assert.strictEqual(AuraRecord.ageDays(rec, 1_700_000_000), 2)
  assert.strictEqual(AuraRecord.daysSinceActivation(rec, 1_700_000_000), 1)
})

it("Record validation and confidence helpers expose Rust impl methods", () => {
  assert.isUndefined(AuraRecord.validateNamespace("project-x"))
  assert.match(AuraRecord.validateNamespace("ns/path")?.message ?? "", /ASCII alphanumeric/)
  assert.isUndefined(AuraRecord.validateSourceType("retrieved"))
  assert.match(AuraRecord.validateSourceType("unknown")?.message ?? "", /Invalid source_type/)
  assert.isUndefined(AuraRecord.validateSemanticType("decision"))
  assert.match(AuraRecord.validateSemanticType("memory")?.message ?? "", /Invalid semantic_type/)
  assert.strictEqual(AuraRecord.defaultConfidenceForSource("generated"), 0.5)
})

it("Record epistemic helpers mirror Rust support/conflict formulas", () => {
  const updated = AuraRecord.updateEpistemicSignals(record(), 5, 1)
  assert.strictEqual(updated.support_mass, 5)
  assert.strictEqual(updated.conflict_mass, 1)
  assert.ok(updated.volatility > 0)

  assert.ok(Math.abs(AuraRecord.epistemicHealth(record()) - 0.45) < 0.0001)
  assert.ok(Math.abs(AuraRecord.epistemicHealth(record({ support_mass: 10 })) - 0.9) < 0.0001)
})
