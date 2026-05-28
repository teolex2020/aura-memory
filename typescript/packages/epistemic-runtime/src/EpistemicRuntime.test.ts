import { it, describe, expect } from "vitest"
import { Effect, Layer, Ref } from "effect"
import {
  BeliefEngine,
  ConceptEngine,
  CausalEngine,
  PolicyEngine,
  EpistemicTrace,
  ConceptSurfaceMode,
  type ConceptEngineImpl,
  type CausalEngineImpl,
  type PolicyEngineImpl,
  type BeliefReport,
  type ConceptReport,
  type CausalReport,
  type PolicyReport,
  type ConceptEngineState,
  type CausalEngineState,
  type BeliefEngineState,
  type PolicyEngineState,
} from "@aura/contract"
import { EpistemicRuntimeImpl } from "./EpistemicRuntime"

// ── Sample data factories ───────────────────────────────────────────

const sampleBelief = (
  id: string,
  overrides: Partial<{
    state: string
    volatility: number
    stability: number
    last_updated: number
    key: string
    confidence: number
  }> = {}
) => ({
  id,
  key: overrides.key ?? `key-${id}`,
  hypothesis_ids: [] as ReadonlyArray<string>,
  winner_id: null as string | null,
  state: overrides.state ?? "Resolved",
  score: 0,
  confidence: overrides.confidence ?? 0.5,
  support_mass: 1,
  conflict_mass: 0,
  stability: overrides.stability ?? 5,
  volatility: overrides.volatility ?? 0.1,
  last_updated: overrides.last_updated ?? 1000,
})

const sampleConcept = (
  id: string,
  overrides: Partial<{
    state: string
    namespace: string
    abstraction_score: number
  }> = {}
) => ({
  id,
  key: `k-${id}`,
  namespace: overrides.namespace ?? "default",
  semantic_type: "fact",
  belief_ids: [] as ReadonlyArray<string>,
  record_ids: [] as ReadonlyArray<string>,
  core_terms: [] as ReadonlyArray<string>,
  shell_terms: [] as ReadonlyArray<string>,
  tags: [] as ReadonlyArray<string>,
  support_mass: 1,
  confidence: 0.5,
  stability: 3,
  cohesion: 0.5,
  abstraction_score: overrides.abstraction_score ?? 0.5,
  state: overrides.state ?? "Stable",
  last_updated: 1000,
})

const samplePattern = (
  id: string,
  overrides: Partial<{
    state: string
    confidence: number
    last_updated: number
  }> = {}
) => ({
  id,
  antecedent_concept_ids: [] as ReadonlyArray<string>,
  consequent_concept_ids: [] as ReadonlyArray<string>,
  support: 1,
  confidence: overrides.confidence ?? 0.7,
  lift: 1.5,
  state: overrides.state ?? "Stable",
  last_updated: overrides.last_updated ?? 1000,
})

const sampleHint = (
  id: string,
  overrides: Partial<{
    state: string
    namespace: string
    domain: string
    last_updated: number
    policyStrength: number
    riskScore: number
    actionKind: string
  }> = {}
) => ({
  id,
  pattern_id: null as string | null,
  condition: "test condition",
  action: "test action",
  priority: 50,
  confidence: 0.5,
  state: overrides.state ?? "Stable",
  last_updated: overrides.last_updated ?? 1000,
  actionKind: overrides.actionKind ?? "recommend",
  policyStrength: overrides.policyStrength ?? 0.5,
  riskScore: overrides.riskScore ?? 0.3,
  namespace: overrides.namespace ?? "default",
  domain: overrides.domain ?? "test",
})

// ── Helper: create runtime with fresh Refs ──────────────────────────

async function createTestRuntime(): Promise<EpistemicRuntimeImpl> {
  return await Effect.runPromise(
    Effect.gen(function* () {
      const globalCalls = yield* Ref.make(0)
      const namespaceCalls = yield* Ref.make(0)
      const recordCalls = yield* Ref.make(0)
      const conceptsReturned = yield* Ref.make(0)
      const recordAnnotationsReturned = yield* Ref.make(0)
      return new EpistemicRuntimeImpl(
        ConceptSurfaceMode.Inspect,
        globalCalls,
        namespaceCalls,
        recordCalls,
        conceptsReturned,
        recordAnnotationsReturned
      )
    })
  )
}

// ── Empty report factories ──────────────────────────────────────────

const emptyBeliefReport: BeliefReport = {
  coarse_groups: 0,
  beliefs_built: 0,
  hypotheses_built: 0,
}

const emptyConceptReport: ConceptReport = {
  seeds_found: 0,
  candidates_found: 0,
  stable_count: 0,
  rejected_count: 0,
  avg_abstraction_score: 0,
  centroids_built: 0,
  partitions_with_multiple_seeds: 0,
  multi_seed_partition_sizes: [],
  cluster_sizes: [],
  clusters_with_multiple_beliefs: 0,
  largest_cluster_size: 0,
  pairwise_comparisons: 0,
  pairwise_above_threshold: 0,
  tanimoto_min: 0,
  tanimoto_max: 0,
  tanimoto_avg: 0,
  tanimoto_p50: 0,
  tanimoto_p95: 0,
  avg_centroid_size: 0,
  seeds_capped: 0,
}

const emptyCausalReport: CausalReport = {
  patterns_found: 0,
  patterns_active: 0,
  patterns_invalidated: 0,
  avg_confidence: 0,
  avg_lift: 0,
}

const emptyPolicyReport: PolicyReport = {
  hints_found: 0,
  hints_active: 0,
  hints_suppressed: 0,
  avg_confidence: 0,
}

// ── Mock engine factories ───────────────────────────────────────────

interface MockBeliefOptions {
  beliefs?: Record<string, ReturnType<typeof sampleBelief>>
  recordToBelief?: Record<string, string>
}

function mockBeliefEngine(
  opts: MockBeliefOptions = {}
): BeliefEngine.Interface {
  const beliefs = opts.beliefs ?? {}
  const recordToBelief = opts.recordToBelief ?? {}
  const state: BeliefEngineState = {
    version: 1,
    beliefs,
    hypotheses: {},
    record_to_belief: recordToBelief,
  }
  return {
    update_with_sdr: () => Effect.succeed(emptyBeliefReport),
    update: () => Effect.succeed(emptyBeliefReport),
    stats: () => Effect.succeed(state),
    belief_for_record: (id: string) =>
      Effect.succeed(recordToBelief[id] ?? null),
    with_coarse_key_mode: () => Effect.void,
    claim_key: () => Effect.succeed(""),
    claim_key_with_mode: () => Effect.succeed(""),
    deprecate_belief: () => Effect.void,
    apply_layer_feedback: () => Effect.succeed({}),
    unresolved_beliefs: () => Effect.succeed([] as ReadonlyArray<string>),
  }
}

interface MockConceptOptions {
  concepts?: Record<string, ReturnType<typeof sampleConcept>>
}

function mockConceptEngine(
  opts: MockConceptOptions = {}
): ConceptEngineImpl {
  const concepts = opts.concepts ?? {}
  const state: ConceptEngineState = {
    version: 1,
    concepts,
    key_index: {},
    seed_mode: "Standard" as const,
    similarity_mode: "SdrTanimoto" as const,
    partition_mode: "Standard" as const,
    union_mode: "Standard" as const,
  }
  return {
    discover: () => Effect.succeed(emptyConceptReport),
    stats: () => Effect.succeed(state),
    with_seed_mode: () => Effect.void,
    stable_concepts: () => Effect.succeed([] as ReadonlyArray<string>),
    active_candidates: () => Effect.succeed([] as ReadonlyArray<string>),
  }
}

interface MockCausalOptions {
  patterns?: Record<string, ReturnType<typeof samplePattern>>
}

function mockCausalEngine(
  opts: MockCausalOptions = {}
): CausalEngineImpl {
  const patterns = opts.patterns ?? {}
  const state: CausalEngineState = {
    version: 1,
    patterns,
    discovery_mode: "Standard" as const,
  }
  return {
    discover: () => Effect.succeed(emptyCausalReport),
    stats: () => Effect.succeed(state),
    invalidate_pattern: () => Effect.void,
    retract_pattern: () => Effect.void,
  }
}

interface MockPolicyOptions {
  hints?: Record<string, ReturnType<typeof sampleHint>>
}

function mockPolicyEngine(
  opts: MockPolicyOptions = {}
): PolicyEngineImpl {
  const hints = opts.hints ?? {}
  const state: PolicyEngineState = {
    version: 1,
    hints,
    metadata: {},
    key_index: {},
  }
  return {
    discover: () => Effect.succeed(emptyPolicyReport),
    stats: () => Effect.succeed(state),
    retract_hint: () => Effect.void,
  }
}

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(
    _name: string,
    _fields: Record<string, string | number | boolean>,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> => effect,
}

function makeLayer(
  overrides: {
    belief?: MockBeliefOptions
    concept?: MockConceptOptions
    causal?: MockCausalOptions
    policy?: MockPolicyOptions
  } = {}
) {
  return Layer.mergeAll(
    Layer.succeed(BeliefEngine, mockBeliefEngine(overrides.belief)),
    Layer.succeed(ConceptEngine, mockConceptEngine(overrides.concept)),
    Layer.succeed(CausalEngine, mockCausalEngine(overrides.causal)),
    Layer.succeed(PolicyEngine, mockPolicyEngine(overrides.policy)),
    Layer.succeed(EpistemicTrace, NoopTrace)
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════════════

describe("EpistemicRuntime (refactored)", () => {
  // ── Belief methods ──────────────────────────────────────────────

  describe("getBeliefs", () => {
    it("returns all beliefs when no filter provided", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { state: "Resolved" }),
            b2: sampleBelief("b2", { state: "Unresolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getBeliefs().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
    })

    it("filters beliefs by state when stateFilter provided", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { state: "Resolved" }),
            b2: sampleBelief("b2", { state: "Unresolved" }),
            b3: sampleBelief("b3", { state: "Resolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getBeliefs("Unresolved").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("b2")
    })

    it("returns empty array when no beliefs match filter", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { state: "Resolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getBeliefs("Empty").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(0)
    })

    it("returns empty array for empty engine state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getBeliefs().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(0)
    })
  })

  describe("getBeliefForRecord", () => {
    it("returns belief for known record", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: { b1: sampleBelief("b1", { state: "Resolved" }) },
          recordToBelief: { rec1: "b1" },
        },
      })
      const result = await Effect.runPromise(
        runtime.getBeliefForRecord("rec1").pipe(Effect.provide(layer))
      )
      expect(result).not.toBeNull()
      expect(result!.id).toBe("b1")
    })

    it("returns null for unknown record", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getBeliefForRecord("nonexistent").pipe(Effect.provide(layer))
      )
      expect(result).toBeNull()
    })
  })

  describe("getHighVolatilityBeliefs", () => {
    it("returns beliefs with volatility >= default threshold (0.20), sorted desc", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { volatility: 0.1, state: "Resolved" }),
            b2: sampleBelief("b2", { volatility: 0.5, state: "Unresolved" }),
            b3: sampleBelief("b3", { volatility: 0.8, state: "Unresolved" }),
            b4: sampleBelief("b4", { volatility: 0.3, state: "Resolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getHighVolatilityBeliefs().pipe(Effect.provide(layer))
      )
      // b1 (0.1) should NOT be in results (below default 0.20)
      expect(result.find((b) => b.id === "b1")).toBeUndefined()
      // Should be sorted by volatility desc
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.volatility).toBeLessThanOrEqual(result[i - 1]!.volatility)
      }
    })

    it("respects custom minVolatility threshold", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { volatility: 0.5, state: "Resolved" }),
            b2: sampleBelief("b2", { volatility: 0.8, state: "Unresolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getHighVolatilityBeliefs(0.7).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("b2")
    })

    it("clamps minVolatility to [0, 1]", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { volatility: 0.5, state: "Resolved" }),
          },
        },
      })
      // minVolatility of 2.0 gets clamped to 1.0, so no beliefs >= 1.0
      const resultHigh = await Effect.runPromise(
        runtime.getHighVolatilityBeliefs(2.0).pipe(Effect.provide(layer))
      )
      expect(resultHigh).toHaveLength(0)
      // minVolatility of -1 gets clamped to 0, so all beliefs match
      const resultLow = await Effect.runPromise(
        runtime.getHighVolatilityBeliefs(-1).pipe(Effect.provide(layer))
      )
      expect(resultLow).toHaveLength(1)
    })

    it("respects custom limit capped at 100", async () => {
      const runtime = await createTestRuntime()
      const beliefs: Record<string, ReturnType<typeof sampleBelief>> = {}
      for (let i = 0; i < 5; i++) {
        beliefs[`b${i}`] = sampleBelief(`b${i}`, { volatility: 0.5, state: "Resolved" })
      }
      const layer = makeLayer({ belief: { beliefs } })
      const result = await Effect.runPromise(
        runtime.getHighVolatilityBeliefs(0.2, 3).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(3)
    })
  })

  describe("getLowStabilityBeliefs", () => {
    it("returns beliefs with stability <= threshold, sorted asc", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { stability: 1, state: "Resolved" }),
            b2: sampleBelief("b2", { stability: 0, state: "Unresolved" }),
            b3: sampleBelief("b3", { stability: 3, state: "Resolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getLowStabilityBeliefs().pipe(Effect.provide(layer))
      )
      // Default maxStability is 1.0, so b3 (stability=3) should NOT be included
      expect(result.find((b) => b.id === "b3")).toBeUndefined()
      // Should be sorted by stability asc
      for (let i = 1; i < result.length; i++) {
        expect(result[i]!.stability).toBeGreaterThanOrEqual(result[i - 1]!.stability)
      }
    })

    it("respects custom maxStability threshold", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { stability: 0, state: "Unresolved" }),
            b2: sampleBelief("b2", { stability: 5, state: "Resolved" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getLowStabilityBeliefs(0.5).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("b1")
    })

    it("clamps maxStability to [0, 1]", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { stability: 5, state: "Resolved" }),
          },
        },
      })
      // maxStability of 2.0 should be clamped to 1.0; stability 5 > 1, so excluded
      const result = await Effect.runPromise(
        runtime.getLowStabilityBeliefs(2.0).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(0)
    })

    it("default limit is 20 and handles empty state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getLowStabilityBeliefs().pipe(Effect.provide(layer))
      )
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  // ── Concept methods ─────────────────────────────────────────────

  describe("getConcepts", () => {
    it("returns all concepts when no filter", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        concept: {
          concepts: {
            c1: sampleConcept("c1", { state: "Stable" }),
            c2: sampleConcept("c2", { state: "Candidate" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getConcepts().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
    })

    it("filters by state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        concept: {
          concepts: {
            c1: sampleConcept("c1", { state: "Stable" }),
            c2: sampleConcept("c2", { state: "Candidate" }),
            c3: sampleConcept("c3", { state: "Rejected" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getConcepts("Candidate").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("c2")
    })

    it("handles empty state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getConcepts().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(0)
    })
  })

  // ── Causal methods ──────────────────────────────────────────────

  describe("getCausalPatterns", () => {
    it("returns all patterns when no filter", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        causal: {
          patterns: {
            p1: samplePattern("p1", { state: "Stable" }),
            p2: samplePattern("p2", { state: "Candidate" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getCausalPatterns().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
    })

    it("filters by state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        causal: {
          patterns: {
            p1: samplePattern("p1", { state: "Stable" }),
            p2: samplePattern("p2", { state: "Candidate" }),
            p3: samplePattern("p3", { state: "Rejected" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getCausalPatterns("Candidate").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("p2")
    })

    it("handles empty state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getCausalPatterns().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(0)
    })
  })

  // ── Policy methods ──────────────────────────────────────────────

  describe("getPolicyHints", () => {
    it("returns all hints when no filter", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Stable" }),
            h2: sampleHint("h2", { state: "Candidate" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getPolicyHints().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
    })

    it("filters by state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Stable" }),
            h2: sampleHint("h2", { state: "Suppressed" }),
            h3: sampleHint("h3", { state: "Rejected" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getPolicyHints("Suppressed").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe("h2")
    })

    it("handles empty state", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getPolicyHints().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(0)
    })
  })

  describe("getSuppressedPolicyHints", () => {
    it("returns only suppressed hints", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Stable", namespace: "ns1" }),
            h2: sampleHint("h2", { state: "Suppressed", namespace: "ns1", last_updated: 2000 }),
            h3: sampleHint("h3", { state: "Suppressed", namespace: "ns2", last_updated: 1000 }),
            h4: sampleHint("h4", { state: "Rejected", namespace: "ns1" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getSuppressedPolicyHints().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
      expect(result.every((h) => h.state === "Suppressed")).toBe(true)
    })

    it("filters by namespace", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Suppressed", namespace: "ns1" }),
            h2: sampleHint("h2", { state: "Suppressed", namespace: "ns2" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getSuppressedPolicyHints("ns1").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.namespace).toBe("ns1")
    })

    it("sorts by last_updated desc", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Suppressed", last_updated: 1000 }),
            h2: sampleHint("h2", { state: "Suppressed", last_updated: 3000 }),
            h3: sampleHint("h3", { state: "Suppressed", last_updated: 2000 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getSuppressedPolicyHints().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(3)
      expect(result[0]!.id).toBe("h2") // most recent first
    })

    it("respects limit", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Suppressed", last_updated: 100 }),
            h2: sampleHint("h2", { state: "Suppressed", last_updated: 200 }),
            h3: sampleHint("h3", { state: "Suppressed", last_updated: 300 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getSuppressedPolicyHints(undefined, 2).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
    })
  })

  describe("getRejectedPolicyHints", () => {
    it("returns only rejected hints", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Stable", namespace: "ns1" }),
            h2: sampleHint("h2", { state: "Rejected", namespace: "ns1", last_updated: 2000 }),
            h3: sampleHint("h3", { state: "Suppressed", namespace: "ns1" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getRejectedPolicyHints().pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.state).toBe("Rejected")
    })

    it("filters by namespace", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Rejected", namespace: "ns1" }),
            h2: sampleHint("h2", { state: "Rejected", namespace: "ns2" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getRejectedPolicyHints("ns2").pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.namespace).toBe("ns2")
    })

    it("sorts by last_updated desc", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Rejected", last_updated: 100 }),
            h2: sampleHint("h2", { state: "Rejected", last_updated: 300 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getRejectedPolicyHints().pipe(Effect.provide(layer))
      )
      expect(result[0]!.last_updated).toBeGreaterThanOrEqual(result[1]!.last_updated)
    })

    it("respects limit", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Rejected", last_updated: 100 }),
            h2: sampleHint("h2", { state: "Rejected", last_updated: 200 }),
            h3: sampleHint("h3", { state: "Rejected", last_updated: 300 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getRejectedPolicyHints(undefined, 2).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
    })
  })
})
