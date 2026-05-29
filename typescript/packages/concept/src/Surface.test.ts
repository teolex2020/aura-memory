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
  type ConceptEngine,
  type ConceptEngineState,
} from "@aura/contract"
import type { SurfacedConcept } from "@aura/contract"
import { surfaceConcepts, surfaceConceptsFiltered, computeSurfaceConcepts, MAX_SURFACED_PER_NAMESPACE, SURFACE_CANDIDATE_THRESHOLD } from "./Surface"

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a mock ConceptEngine.Interface that only needs stats(). */
function mockEngine(state: ConceptEngineState): ConceptEngine.Interface {
  return {
    with_seed_mode: () => Effect.void,
    with_similarity_mode: () => Effect.void,
    discover: () => Effect.succeed({} as any),
    stable_concepts: () => Effect.succeed([] as readonly string[]),
    active_candidates: () => Effect.succeed([] as readonly string[]),
    stats: () => Effect.succeed(state),
  }
}

/** Minimal ConceptCandidate factory. */
function c(overrides: Partial<ConceptCandidate> & { id: string }): ConceptCandidate {
  return {
    key: overrides.key ?? `key-${overrides.id}`,
    namespace: overrides.namespace ?? "default",
    semantic_type: overrides.semantic_type ?? "concept",
    state: overrides.state ?? ConceptState.Stable,
    abstraction_score: overrides.abstraction_score ?? 0.5,
    belief_ids: overrides.belief_ids ?? ["b-default"],
    record_ids: overrides.record_ids ?? ["r-default"],
    core_terms: overrides.core_terms ?? ["term-default"],
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
    // Create 25 concepts spread across 25 namespaces (per-ns cap = 5, so all pass)
    const entries: Record<string, ConceptCandidate> = {}
    for (let i = 1; i <= 25; i++) {
      const id = `c${i}`
      entries[id] = c({ id, abstraction_score: 1.0 - i * 0.01, key: `key-${i}`, namespace: `ns-${i}` })
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
        c3: c({ id: "c3", state: ConceptState.Candidate, abstraction_score: 0.75 }),
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

// ═══════════════════════════════════════════════════════════════════
// computeSurfaceConcepts tests — RED phase (stub returns empty)
// Rust-aligned surface function with per-ns cap, dedup, 5-dim tiebreak
// ═══════════════════════════════════════════════════════════════════

describe("computeSurfaceConcepts", () => {
  it("caps at MAX_SURFACED_PER_NAMESPACE = 5 per namespace", () => {
    // 10 concepts in namespace "ns1" → only top 5 returned
    const concepts: ConceptCandidate[] = []
    for (let i = 1; i <= 10; i++) {
      concepts.push(c({
        id: `c${i}`,
        key: `ns1:key-${i}`,
        namespace: "ns1",
        abstraction_score: 0.95 - i * 0.01,
        confidence: 0.9,
        belief_ids: [`b${i}`],
        record_ids: [`r${i}`],
        state: ConceptState.Stable,
      }))
    }

    const result = computeSurfaceConcepts(concepts)
    assert.strictEqual(result.length, 5)
  })

  it("deduplicates by concept key — same key only appears once", () => {
    const concepts = [
      c({ id: "c1", key: "ns:dup-key", namespace: "ns", abstraction_score: 0.90, state: ConceptState.Stable }),
      c({ id: "c2", key: "ns:dup-key", namespace: "ns", abstraction_score: 0.85, state: ConceptState.Stable }),
      c({ id: "c3", key: "ns:unique-key", namespace: "ns", abstraction_score: 0.80, state: ConceptState.Stable }),
    ]

    const result = computeSurfaceConcepts(concepts)
    // Only first occurrence of dup-key wins
    const keys = result.map((r) => r.key)
    assert.strictEqual(result.length, 2)
    assert.ok(keys.includes("ns:dup-key"))
    assert.ok(keys.includes("ns:unique-key"))
    assert.strictEqual(result[0]!.id, "c1") // higher scoring dup-key wins
  })

  it("sorts by abstraction_score DESC, then confidence DESC, cluster_size DESC, stable before candidate, key ASC (5-dim tiebreak)", () => {
    const concepts = [
      // Same score (0.85), diff confidence → higher confidence first
      c({ id: "c2", key: "n:a", namespace: "n", abstraction_score: 0.85, confidence: 0.7, belief_ids: ["b1"], state: ConceptState.Stable }),
      c({ id: "c1", key: "n:b", namespace: "n", abstraction_score: 0.85, confidence: 0.9, belief_ids: ["b1"], state: ConceptState.Stable }),
      // Higher score → always first
      c({ id: "c3", key: "n:c", namespace: "n", abstraction_score: 0.95, confidence: 0.5, belief_ids: ["b1"], state: ConceptState.Stable }),
    ]

    const result = computeSurfaceConcepts(concepts)
    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0]!.id, "c3")  // score 0.95
    assert.strictEqual(result[1]!.id, "c1")  // score 0.85, conf 0.9
    assert.strictEqual(result[2]!.id, "c2")  // score 0.85, conf 0.7
  })

  it("stable concepts sort above candidate concepts at same abstraction_score", () => {
    const concepts = [
      c({ id: "c1", key: "n:a", namespace: "n", abstraction_score: 0.85, state: ConceptState.Candidate, confidence: 0.9 }),
      c({ id: "c2", key: "n:b", namespace: "n", abstraction_score: 0.85, state: ConceptState.Stable, confidence: 0.9 }),
    ]

    const result = computeSurfaceConcepts(concepts)
    assert.strictEqual(result.length, 2)
    // Stable sorts before Candidate at same score
    assert.strictEqual(result[0]!.id, "c2")  // Stable
    assert.strictEqual(result[1]!.id, "c1")  // Candidate
  })

  it("filters concepts with abstraction_score < SURFACE_CANDIDATE_THRESHOLD (0.70) for Candidate state", () => {
    const concepts = [
      c({ id: "c1", key: "n:a", namespace: "n", abstraction_score: 0.90, state: ConceptState.Stable }),
      c({ id: "c2", key: "n:b", namespace: "n", abstraction_score: 0.85, state: ConceptState.Candidate }),
      c({ id: "c3", key: "n:c", namespace: "n", abstraction_score: 0.65, state: ConceptState.Candidate }),
      c({ id: "c4", key: "n:d", namespace: "n", abstraction_score: 0.50, state: ConceptState.Candidate }),
    ]

    const result = computeSurfaceConcepts(concepts)
    const ids = result.map((r) => r.id)
    assert.ok(ids.includes("c1"))   // Stable always passes
    assert.ok(ids.includes("c2"))   // Candidate >= 0.70
    assert.ok(!ids.includes("c3"))  // Candidate < 0.70
    assert.ok(!ids.includes("c4"))  // Candidate < 0.70
  })

  it("concepts from different namespaces each get separate caps (not global 5)", () => {
    const concepts: ConceptCandidate[] = []
    // 8 concepts in ns-a, 8 in ns-b
    for (let i = 1; i <= 8; i++) {
      concepts.push(c({ id: `a${i}`, key: `ns-a:key-${i}`, namespace: "ns-a", abstraction_score: 0.90, state: ConceptState.Stable }))
      concepts.push(c({ id: `b${i}`, key: `ns-b:key-${i}`, namespace: "ns-b", abstraction_score: 0.90, state: ConceptState.Stable }))
    }

    const result = computeSurfaceConcepts(concepts)
    // 5 per namespace = 10 total (not 5 global)
    assert.strictEqual(result.length, 10)
    const nsA = result.filter((r) => r.namespace === "ns-a")
    const nsB = result.filter((r) => r.namespace === "ns-b")
    assert.strictEqual(nsA.length, 5)
    assert.strictEqual(nsB.length, 5)
  })

  it("rejected concepts are never surfaced", () => {
    const concepts = [
      c({ id: "c1", key: "n:a", namespace: "n", abstraction_score: 0.95, state: ConceptState.Rejected }),
      c({ id: "c2", key: "n:b", namespace: "n", abstraction_score: 0.50, state: ConceptState.Stable }),
    ]

    const result = computeSurfaceConcepts(concepts)
    const ids = result.map((r) => r.id)
    assert.ok(!ids.includes("c1"))  // Rejected excluded even with high score
    assert.ok(ids.includes("c2"))   // Stable always included
  })

  it("filters namespaces when namespaces parameter provided", () => {
    const concepts = [
      c({ id: "c1", key: "ns-a:k1", namespace: "ns-a", abstraction_score: 0.90, state: ConceptState.Stable }),
      c({ id: "c2", key: "ns-b:k2", namespace: "ns-b", abstraction_score: 0.85, state: ConceptState.Stable }),
      c({ id: "c3", key: "ns-a:k3", namespace: "ns-a", abstraction_score: 0.80, state: ConceptState.Stable }),
    ]

    const result = computeSurfaceConcepts(concepts, ["ns-a"])
    assert.strictEqual(result.length, 2)
    const ids = result.map((r) => r.id)
    assert.ok(ids.includes("c1"))
    assert.ok(ids.includes("c3"))
    assert.ok(!ids.includes("c2"))
  })

  it("dedup-by-key with per-ns cap: Rust ordering (dedup then cap)", () => {
    // Create 7 concepts in "ns1": 6 with unique keys, #7 is duplicate of #3
    // With dedup-then-cap: concept #7 (duplicate) doesn't consume cap slot,
    // so concept #6 can fill the 5th slot
    const concepts: ConceptCandidate[] = []
    for (let i = 1; i <= 6; i++) {
      concepts.push(c({
        id: `c${i}`,
        key: `ns1:unique-${i}`,
        namespace: "ns1",
        abstraction_score: 0.90 - i * 0.01,
        state: ConceptState.Stable,
      }))
    }
    // Add duplicate of c3 (same key, lower score)
    concepts.push(c({
      id: "c7",
      key: "ns1:unique-3",  // same as c3
      namespace: "ns1",
      abstraction_score: 0.75,
      state: ConceptState.Stable,
    }))

    const result = computeSurfaceConcepts(concepts)
    // Expected: c1, c2, c3, c4, c5 make the cut (top 5 unique keys)
    // c6 is #6 unique key, beyond 5-per-ns cap
    // c7 is duplicate of c3, skipped (doesn't consume slot)
    assert.strictEqual(result.length, 5)
    // c6 should NOT be included (per-ns cap reached after 5 unique keys)
    const ids = result.map((r) => r.id)
    assert.ok(!ids.includes("c6"))
    assert.ok(!ids.includes("c7"))  // duplicate skipped
  })

  it("empty input returns empty array", () => {
    assert.strictEqual(computeSurfaceConcepts([]).length, 0)
  })

  it("cluster_size sort dimension: larger clusters sort before smaller at same score/conf", () => {
    const concepts = [
      c({ id: "c1", key: "n:a", namespace: "n", abstraction_score: 0.85, confidence: 0.9, belief_ids: ["b1"], state: ConceptState.Stable }),
      c({ id: "c2", key: "n:b", namespace: "n", abstraction_score: 0.85, confidence: 0.9, belief_ids: ["b1", "b2", "b3"], state: ConceptState.Stable }),
    ]

    const result = computeSurfaceConcepts(concepts)
    assert.strictEqual(result.length, 2)
    // c2 has larger cluster (3 beliefs vs 1)
    assert.strictEqual(result[0]!.id, "c2")
    assert.strictEqual(result[1]!.id, "c1")
  })
})
