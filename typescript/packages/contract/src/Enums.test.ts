import { it } from "vitest"
import { assert } from "@effect/vitest"
import {
  BeliefState,
  ConceptPartitionMode,
  ConceptSeedMode,
  ConceptSimilarityMode,
  ConceptState,
  ConceptUnionMode,
  Level
} from "./index"

it("enums are runtime values", () => {
  assert.strictEqual(Level.Working, "Working")
  assert.strictEqual(Level.Decisions, "Decisions")
  assert.strictEqual(Level.Domain, "Domain")
  assert.strictEqual(Level.Identity, "Identity")

  assert.strictEqual(BeliefState.Resolved, "Resolved")
  assert.strictEqual(BeliefState.Unresolved, "Unresolved")
  assert.strictEqual(BeliefState.Singleton, "Singleton")
  assert.strictEqual(BeliefState.Empty, "Empty")

  assert.strictEqual(ConceptState.Stable, "Stable")
  assert.strictEqual(ConceptState.Candidate, "Candidate")
  assert.strictEqual(ConceptState.Rejected, "Rejected")

  assert.strictEqual(ConceptSeedMode.Standard, "Standard")
  assert.strictEqual(ConceptSeedMode.Warmup, "Warmup")
  assert.strictEqual(ConceptSeedMode.Relaxed, "Relaxed")

  assert.strictEqual(ConceptSimilarityMode.SdrTanimoto, "SdrTanimoto")
  assert.strictEqual(ConceptSimilarityMode.CanonicalFeature, "CanonicalFeature")

  assert.strictEqual(ConceptPartitionMode.Standard, "Standard")
  assert.strictEqual(ConceptPartitionMode.NamespaceOnly, "NamespaceOnly")

  assert.strictEqual(ConceptUnionMode.Standard, "Standard")
  assert.strictEqual(ConceptUnionMode.SingleTagFactDecisionBridge, "SingleTagFactDecisionBridge")
})

it("Level namespace mirrors Rust level impl helpers", () => {
  assert.strictEqual(Level.decayRate(Level.Working), 0.80)
  assert.strictEqual(Level.decayRate(Level.Identity), 0.99)
  assert.strictEqual(Level.toDna(Level.Working), "general")
  assert.strictEqual(Level.toDna(Level.Domain), "user_core")
  assert.isFalse(Level.isIdentitySdr(Level.Decisions))
  assert.isTrue(Level.isIdentitySdr(Level.Identity))
  assert.strictEqual(Level.promote(Level.Working), Level.Decisions)
  assert.strictEqual(Level.promote(Level.Identity), null)
  assert.strictEqual(Level.value(Level.Domain), 3)
  assert.strictEqual(Level.fromValue(4), Level.Identity)
  assert.strictEqual(Level.fromValue(0), null)
  assert.strictEqual(Level.displayName(Level.Decisions), "DECISIONS")
  assert.strictEqual(Level.tier(Level.Working), "cognitive")
  assert.strictEqual(Level.tier(Level.Identity), "core")
  assert.isTrue(Level.isCognitive(Level.Decisions))
  assert.isTrue(Level.isCore(Level.Domain))
})

it("Level namespace methods mirror Rust level impl helpers", () => {
  assert.strictEqual(Level.decayRate(Level.Working), 0.80)
  assert.strictEqual(Level.decayRate(Level.Identity), 0.99)
  assert.strictEqual(Level.toDna(Level.Decisions), "general")
  assert.strictEqual(Level.toDna(Level.Domain), "user_core")
  assert.isFalse(Level.isIdentitySdr(Level.Decisions))
  assert.isTrue(Level.isIdentitySdr(Level.Domain))
  assert.strictEqual(Level.promote(Level.Working), Level.Decisions)
  assert.strictEqual(Level.promote(Level.Identity), null)
  assert.strictEqual(Level.value(Level.Domain), 3)
  assert.strictEqual(Level.fromValue(4), Level.Identity)
  assert.strictEqual(Level.fromValue(5), null)
  assert.strictEqual(Level.displayName(Level.Identity), "IDENTITY")
  assert.strictEqual(Level.tier(Level.Working), "cognitive")
  assert.strictEqual(Level.tier(Level.Identity), "core")
  assert.isTrue(Level.isCognitive(Level.Decisions))
  assert.isFalse(Level.isCognitive(Level.Domain))
  assert.isTrue(Level.isCore(Level.Domain))
  assert.isFalse(Level.isCore(Level.Working))
})

it("Level namespace methods mirror Rust Level impl helpers", () => {
  assert.strictEqual(Level.decayRate(Level.Working), 0.80)
  assert.strictEqual(Level.decayRate(Level.Identity), 0.99)
  assert.strictEqual(Level.toDna(Level.Decisions), "general")
  assert.strictEqual(Level.toDna(Level.Domain), "user_core")
  assert.isFalse(Level.isIdentitySdr(Level.Working))
  assert.isTrue(Level.isIdentitySdr(Level.Identity))
  assert.strictEqual(Level.promote(Level.Working), Level.Decisions)
  assert.strictEqual(Level.promote(Level.Identity), null)
  assert.strictEqual(Level.value(Level.Domain), 3)
  assert.strictEqual(Level.fromValue(4), Level.Identity)
  assert.strictEqual(Level.fromValue(0), null)
  assert.strictEqual(Level.displayName(Level.Decisions), "DECISIONS")
  assert.strictEqual(Level.tier(Level.Working), "cognitive")
  assert.strictEqual(Level.tier(Level.Identity), "core")
  assert.isTrue(Level.isCognitive(Level.Decisions))
  assert.isFalse(Level.isCognitive(Level.Domain))
  assert.isTrue(Level.isCore(Level.Domain))
  assert.isFalse(Level.isCore(Level.Working))
})
