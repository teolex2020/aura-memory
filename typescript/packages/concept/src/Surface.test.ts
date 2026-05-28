/**
 * Unit tests for concept surface functions.
 *
 * Plan 02: surfaceConcepts and surfaceConceptsFiltered.
 * Tests cover filtering, sorting, limiting, namespace scoping,
 * and edge cases (empty state, non-existent namespace, rejected exclusion).
 */
import { describe, it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  ConceptState,
  ConceptSeedMode,
  ConceptSimilarityMode,
  ConceptPartitionMode,
  ConceptUnionMode,
  type ConceptCandidate,
  type ConceptEngineImpl,
  type ConceptEngineState,
} from "@aura/contract"
import type { SurfacedConcept } from "@aura/contract"
import { surfaceConcepts, surfaceConceptsFiltered } from "./Surface"

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a mock ConceptEngineImpl that only needs stats(). */
function mockEngine(state: ConceptEngineState): ConceptEngineImpl {
  return { stats: () => Effect.succeed(state) } as unknown as ConceptEngineImpl
}

/** Minimal ConceptCandidate factory. */
function c(overrides: Partial<ConceptCandidate> & { id: string }): ConceptCandidate {
  return {
    key: overrides.key ?? `key-${overrides.id}`,
    namespace: overrides.namespace ?? "default",
    semantic_type: overrides.semantic_type ?? "concept",
    state: overrides.state ?? ConceptState.Stable,
    abstraction_score: overrides.abstraction_score ?? 0.5,
    belief_ids: overrides.belief_ids ?? [],
    record_ids: overrides.record_ids ?? [],
    core_terms: overrides.core_terms ?? [],
    shell_terms: overrides.shell_terms ?? [],
    tags: overrides.tags ?? [],
    support_mass: overrides.support_mass ?? 1,
    confidence: overrides.confidence ?? 0.8,
    stability: overrides.stability ?? 2.0,
    cohesion: overrides.cohesion ?? 0.7,
    last_updated: overrides.last_updated ?? 0,
    ...overrides,
  }
}

/** Build a valid ConceptEngineState from a concepts map. */
function makeState(concepts: Record<string, ConceptCandidate>): ConceptEngineState {
  return {
    version: 1 as const,
    concepts,
    key_index: {},
    seed_mode: ConceptSeedMode.Standard,
    similarity_mode: ConceptSimilarityMode.SdrTanimoto,
    partition_mode: ConceptPartitionMode.Standard,
    union_mode: ConceptUnionMode.Standard,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("surfaceConcepts", () => {
  it("returns all eligible concepts sorted by abstractionScore desc", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", abstraction_score: 0.5, key: "a", state: ConceptState.Stable }),
        c2: c({ id: "c2", abstraction_score: 0.9, key: "b", state: ConceptState.Candidate }),
        c3: c({ id: "c3", abstraction_score: 0.3, key: "c", state: ConceptState.Stable }),
      })
    )

    const result = await Effect.runPromise(surfaceConcepts(engine))

    assert.strictEqual(result.length, 3)
    // Sorted by abstraction_score desc
    assert.strictEqual(result[0]!.id, "c2")
    assert.strictEqual(result[0]!.abstractionScore, 0.9)
    assert.strictEqual(result[1]!.id, "c1")
    assert.strictEqual(result[1]!.abstractionScore, 0.5)
    assert.strictEqual(result[2]!.id, "c3")
    assert.strictEqual(result[2]!.abstractionScore, 0.3)
  })

  it("respects limit parameter", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", abstraction_score: 0.9 }),
        c2: c({ id: "c2", abstraction_score: 0.8 }),
        c3: c({ id: "c3", abstraction_score: 0.7 }),
        c4: c({ id: "c4", abstraction_score: 0.6 }),
        c5: c({ id: "c5", abstraction_score: 0.5 }),
      })
    )

    const result = await Effect.runPromise(surfaceConcepts(engine, 3))

    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0]!.id, "c1")
    assert.strictEqual(result[2]!.id, "c3")
  })

  it("default limit is 20 when no limit arg", async () => {
    // Create 25 concepts — only first 20 should be returned
    const entries: Record<string, ConceptCandidate> = {}
    for (let i = 1; i <= 25; i++) {
      const id = `c${i}`
      entries[id] = c({ id, abstraction_score: 1.0 - i * 0.01, key: `key-${i}` })
    }

    const engine = mockEngine(makeState(entries))
    const result = await Effect.runPromise(surfaceConcepts(engine))

    assert.strictEqual(result.length, 20)
  })

  it("excludes Rejected state concepts", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", state: ConceptState.Stable, abstraction_score: 0.8 }),
        c2: c({ id: "c2", state: ConceptState.Rejected, abstraction_score: 0.9 }),
        c3: c({ id: "c3", state: ConceptState.Candidate, abstraction_score: 0.5 }),
      })
    )

    const result = await Effect.runPromise(surfaceConcepts(engine))

    assert.strictEqual(result.length, 2)
    const ids = result.map((r) => r.id)
    assert.ok(ids.includes("c1"))
    assert.ok(ids.includes("c3"))
    assert.ok(!ids.includes("c2"))
  })

  it("multiple concepts with same score maintain deterministic order (secondary sort by key)", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", key: "zebra", abstraction_score: 0.7 }),
        c2: c({ id: "c2", key: "alpha", abstraction_score: 0.7 }),
        c3: c({ id: "c3", key: "beta", abstraction_score: 0.7 }),
      })
    )

    const result = await Effect.runPromise(surfaceConcepts(engine))

    assert.strictEqual(result.length, 3)
    // Same score → sort by key ascending
    assert.strictEqual(result[0]!.key, "alpha")
    assert.strictEqual(result[1]!.key, "beta")
    assert.strictEqual(result[2]!.key, "zebra")
  })

  it("empty engine returns empty array", async () => {
    const engine = mockEngine(makeState({}))
    const result = await Effect.runPromise(surfaceConcepts(engine))
    assert.strictEqual(result.length, 0)
  })
})

describe("surfaceConceptsFiltered", () => {
  it("filters by namespace", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", namespace: "ns-a", abstraction_score: 0.9 }),
        c2: c({ id: "c2", namespace: "ns-b", abstraction_score: 0.8 }),
        c3: c({ id: "c3", namespace: "ns-a", abstraction_score: 0.5 }),
      })
    )

    const result = await Effect.runPromise(surfaceConceptsFiltered(engine, undefined, "ns-a"))

    assert.strictEqual(result.length, 2)
    const ids = result.map((r) => r.id)
    assert.ok(ids.includes("c1"))
    assert.ok(ids.includes("c3"))
    assert.ok(!ids.includes("c2"))
  })

  it("respects limit with namespace filter", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", namespace: "ns-a", abstraction_score: 0.9 }),
        c2: c({ id: "c2", namespace: "ns-a", abstraction_score: 0.8 }),
        c3: c({ id: "c3", namespace: "ns-a", abstraction_score: 0.7 }),
      })
    )

    const result = await Effect.runPromise(surfaceConceptsFiltered(engine, 2, "ns-a"))
    assert.strictEqual(result.length, 2)
  })

  it("non-existent namespace returns empty array", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", namespace: "ns-a", abstraction_score: 0.9 }),
      })
    )

    const result = await Effect.runPromise(surfaceConceptsFiltered(engine, undefined, "nonexistent"))
    assert.strictEqual(result.length, 0)
  })

  it("when namespace not provided behaves like surfaceConcepts", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({ id: "c1", namespace: "ns-a", abstraction_score: 0.9 }),
        c2: c({ id: "c2", namespace: "ns-b", abstraction_score: 0.5 }),
      })
    )

    const result = await Effect.runPromise(surfaceConceptsFiltered(engine))
    assert.strictEqual(result.length, 2)
  })

  it("maps fields correctly to SurfacedConcept shape", async () => {
    const engine = mockEngine(
      makeState({
        c1: c({
          id: "c1",
          key: "test:concept:alpha",
          namespace: "ns-a",
          state: ConceptState.Stable,
          abstraction_score: 0.85,
          belief_ids: ["b1", "b2", "b3"],
          record_ids: ["r1", "r2"],
          core_terms: ["term1", "term2"],
        }),
      })
    )

    const result = await Effect.runPromise(surfaceConceptsFiltered(engine))

    assert.strictEqual(result.length, 1)
    const sc: SurfacedConcept = result[0]!
    assert.strictEqual(sc.id, "c1")
    assert.strictEqual(sc.key, "test:concept:alpha")
    assert.strictEqual(sc.state, "Stable")
    assert.strictEqual(sc.namespace, "ns-a")
    assert.strictEqual(sc.abstractionScore, 0.85)
    assert.strictEqual(sc.beliefCount, 3)
    assert.strictEqual(sc.recordCount, 2)
    assert.deepStrictEqual(sc.coreTerms, ["term1", "term2"])
    assert.deepStrictEqual(sc.recordIds, ["r1", "r2"])
  })
})
