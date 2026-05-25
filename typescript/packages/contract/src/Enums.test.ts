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
