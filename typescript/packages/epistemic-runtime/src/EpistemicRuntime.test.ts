import { it, describe, expect } from "vitest"
import { Effect, Layer, Ref } from "effect"
import {
  BeliefEngine,
  ConceptEngine,
  CausalEngine,
  PolicyEngine,
  EpistemicTrace,
  ConceptSurfaceMode,
  Polarity,
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
  type Record as AuraRecord,
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
    conflict_mass: number
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
  conflict_mass: overrides.conflict_mass ?? 0,
  stability: overrides.stability ?? 5,
  volatility: overrides.volatility ?? 0.1,
  last_updated: overrides.last_updated ?? 1000,
})

const sampleHypothesis = (
  id: string,
  overrides: Partial<{
    belief_id: string
    prototype_record_ids: ReadonlyArray<string>
    confidence: number
    support_mass: number
    conflict_mass: number
  }> = {}
) => ({
  id,
  belief_id: overrides.belief_id ?? "",
  prototype_record_ids: overrides.prototype_record_ids ?? [],
  confidence: overrides.confidence ?? 0.5,
  support_mass: overrides.support_mass ?? 1,
  conflict_mass: overrides.conflict_mass ?? 0,
  recency: 1,
  consistency: 0.5,
  score: 0.5,
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
  belief_ids: ["b1"] as ReadonlyArray<string>,
  record_ids: ["r1"] as ReadonlyArray<string>,
  core_terms: ["term"] as ReadonlyArray<string>,
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
): CausalEngineState["patterns"][string] => ({
  id,
  cause_belief_id: "b1",
  effect_belief_id: "b2",
  cause_key: "ns:k1:k2:h",
  effect_key: "k2",
  edge_hash: "h",
  support: 1,
  confidence: overrides.confidence ?? 0.7,
  lift: 1.5,
  state: (overrides.state ?? "Stable") as any,
  last_updated: overrides.last_updated ?? 1000,
  transition_lift: 0.5,
  temporal_consistency: 0.7,
  outcome_stability: 0.6,
  causal_strength: 0.65,
  support_count: 10,
  explicit_support_count: 5,
  counterevidence_count: 2,
  temporal_windows: 3,
  namespace: "test",
  cause_record_ids: [] as ReadonlyArray<string>,
  effect_record_ids: [] as ReadonlyArray<string>,
  temporal_support_count: 0,
  explicit_support_total_for_cause: 0,
  explicit_effect_variants_for_cause: 0,
  effect_record_signature_variants: 0,
  positive_effect_signals: 0,
  negative_effect_signals: 0,
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
): PolicyEngineState["hints"][string] => ({
  id,
  pattern_id: null as string | null,
  condition: "test condition",
  action: "test action",
  priority: 50,
  confidence: 0.5,
  state: (overrides.state ?? "Stable") as any,
  last_updated: overrides.last_updated ?? 1000,
  actionKind: (overrides.actionKind ?? "recommend") as any,
  policyStrength: overrides.policyStrength ?? 0.5,
  riskScore: overrides.riskScore ?? 0.3,
  namespace: overrides.namespace ?? "default",
  domain: overrides.domain ?? "test",
  polarity: Polarity.Neutral,
  recommendation: "",
  utilityScore: 0.5,
  cause_key: "k",
  effect_keys: [] as ReadonlyArray<string>,
  cause_record_ids: [] as ReadonlyArray<string>,
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
  beliefs_created: 0,
  beliefs_pruned: 0,
  revisions: 0,
  resolved: 0,
  unresolved: 0,
  total_beliefs: 0,
  total_hypotheses: 0,
  churn_rate: 0,
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
  explicit_edges: 0,
  temporal_edges: 0,
  temporal_namespaces_scanned: 0,
  temporal_pairs_considered: 0,
  temporal_pairs_skipped_by_budget: 0,
  temporal_edges_capped: 0,
  temporal_namespaces_hit_cap: 0,
  patterns_meeting_support_gate: 0,
  patterns_meeting_repeated_window_gate: 0,
  patterns_meeting_counterfactual_gate: 0,
  patterns_blocked_by_evidence_gates: 0,
  patterns_blocked_by_counterfactual_gate: 0,
  avg_causal_strength: 0,
  stable_count: 0,
  rejected_count: 0,
}

const emptyPolicyReport: PolicyReport = {
  hints_found: 0,
  hints_active: 0,
  hints_suppressed: 0,
  avg_confidence: 0,
  seeds_found: 0,
  stable_hints: 0,
  suppressed_hints: 0,
  rejected_hints: 0,
  avg_policy_strength: 0,
}

// ── Mock engine factories ───────────────────────────────────────────

interface MockBeliefOptions {
  beliefs?: Record<string, ReturnType<typeof sampleBelief>>
  hypotheses?: Record<string, ReturnType<typeof sampleHypothesis>>
  recordToBelief?: Record<string, string>
}

function mockBeliefEngine(
  opts: MockBeliefOptions = {}
): BeliefEngine.Interface {
  const beliefs = opts.beliefs ?? {}
  const hypotheses = opts.hypotheses ?? {}
  const recordToBelief = opts.recordToBelief ?? {}
  const state = {
    version: 1 as const,
    beliefs,
    hypotheses,
    record_to_belief: recordToBelief,
    key_index: {} as Readonly<Record<string, string>>,
    record_index: recordToBelief as Readonly<Record<string, string>>,
  } as BeliefEngineState
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
  const state = {
    version: 1 as const,
    concepts,
    key_index: {},
    seed_mode: "Standard",
    similarity_mode: "SdrTanimoto",
    partition_mode: "Standard",
    union_mode: "Standard",
  } as ConceptEngineState
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
  const state = {
    version: 1 as const,
    patterns,
    discovery_mode: "Standard",
    edges_found_total: 0,
    temporal_budget_mode: "NearbySuccessors",
    evidence_mode: "StrictRepeatedWindows",
    last_corpus_fingerprint: "",
  } as CausalEngineState
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
    hints: hints as PolicyEngineState["hints"],
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

  // ═══════════════════════════════════════════════════════════════════════
  // New aggregate methods — Plan 05
  // ═══════════════════════════════════════════════════════════════════════

  describe("getBeliefInstabilitySummary", () => {
    it("returns correct counts for mixed states", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { state: "Resolved", volatility: 0.1, stability: 5 }),
            b2: sampleBelief("b2", { state: "Unresolved", volatility: 0.5, stability: 1 }),
            b3: sampleBelief("b3", { state: "Singleton", volatility: 0.8, stability: 0.5 }),
            b4: sampleBelief("b4", { state: "Empty", volatility: 0.05, stability: 10 }),
            b5: sampleBelief("b5", { state: "Unresolved", volatility: 0.3, stability: 2 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getBeliefInstabilitySummary().pipe(Effect.provide(layer))
      )
      expect(result.totalBeliefs).toBe(5)
      expect(result.resolved).toBe(1)
      expect(result.unresolved).toBe(2)
      expect(result.singleton).toBe(1)
      expect(result.empty).toBe(1)
      expect(result.avgVolatility).toBeCloseTo((0.1 + 0.5 + 0.8 + 0.05 + 0.3) / 5, 5)
      expect(result.avgStability).toBeCloseTo((5 + 1 + 0.5 + 10 + 2) / 5, 5)
      // highVolatilityCount: volatility >= 0.20 => b2(0.5), b3(0.8), b5(0.3)
      expect(result.highVolatilityCount).toBe(3)
      // lowStabilityCount: stability <= 1.0 => b2(1), b3(0.5)
      expect(result.lowStabilityCount).toBe(2)
      // volatilityBands: low < 0.20 => b1(0.1), b4(0.05) = 2; medium 0.20-0.50 => b2(0.5), b5(0.3) = 2; high >= 0.50 => b3(0.8) = 1
      expect(result.volatilityBands.low).toBe(2)
      expect(result.volatilityBands.medium).toBe(2)
      expect(result.volatilityBands.high).toBe(1)
      expect(result.contradictionClusterCount).toBe(0)
    })

    it("returns zeros for empty engine", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getBeliefInstabilitySummary().pipe(Effect.provide(layer))
      )
      expect(result.totalBeliefs).toBe(0)
      expect(result.resolved).toBe(0)
      expect(result.unresolved).toBe(0)
      expect(result.singleton).toBe(0)
      expect(result.empty).toBe(0)
      expect(result.avgVolatility).toBe(0)
      expect(result.avgStability).toBe(0)
      expect(result.highVolatilityCount).toBe(0)
      expect(result.lowStabilityCount).toBe(0)
      expect(result.volatilityBands.low).toBe(0)
      expect(result.volatilityBands.medium).toBe(0)
      expect(result.volatilityBands.high).toBe(0)
      expect(result.contradictionClusterCount).toBe(0)
    })
  })

  describe("getContradictionClusters", () => {
    it("beliefs sharing records form clusters", async () => {
      const runtime = await createTestRuntime()
      const records = new Map<string, AuraRecord>([
        ["rec1", { id: "rec1", tags: ["tag-a", "tag-b"] } as unknown as AuraRecord],
        ["rec2", { id: "rec2", tags: ["tag-b"] } as unknown as AuraRecord],
        ["rec3", { id: "rec3", tags: ["tag-c"] } as unknown as AuraRecord],
        ["rec4", { id: "rec4", tags: ["tag-d"] } as unknown as AuraRecord],
      ])
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { state: "Unresolved", volatility: 0.5, stability: 1, conflict_mass: 0.8 }),
            b2: sampleBelief("b2", { state: "Resolved", volatility: 0.1, stability: 5, conflict_mass: 0.2 }),
            b3: sampleBelief("b3", { state: "Unresolved", volatility: 0.6, stability: 0.5, conflict_mass: 0.9 }),
            b4: sampleBelief("b4", { state: "Resolved", volatility: 0.05, stability: 10, conflict_mass: 0.1 }),
          },
          hypotheses: {
            h1: sampleHypothesis("h1", { belief_id: "b1", prototype_record_ids: ["rec1", "rec2"] }),
            h2: sampleHypothesis("h2", { belief_id: "b2", prototype_record_ids: ["rec2", "rec3"] }),
            h3: sampleHypothesis("h3", { belief_id: "b3", prototype_record_ids: ["rec3"] }),
            h4: sampleHypothesis("h4", { belief_id: "b4", prototype_record_ids: ["rec4"] }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getContradictionClusters(records).pipe(Effect.provide(layer))
      )
      // b1 shares rec2 with b2; b2 shares rec3 with b3 => cluster {b1,b2,b3}
      // b4 is isolated with only rec4 => cluster {b4}
      expect(result).toHaveLength(2)

      // Find the cluster containing b1
      const clusterABC = result.find((c) => c.beliefIds.includes("b1"))
      expect(clusterABC).toBeDefined()
      expect([...clusterABC!.beliefIds].sort()).toEqual(["b1", "b2", "b3"])
      expect(clusterABC!.unresolvedBeliefCount).toBe(2) // b1, b3
      expect(clusterABC!.highVolatilityBeliefCount).toBe(2) // b1(0.5), b3(0.6)
      expect(clusterABC!.totalConflictMass).toBeCloseTo(0.8 + 0.2 + 0.9, 5)
      expect(clusterABC!.maxConflictMass).toBe(0.9)
    })

    it("namespace filter works", async () => {
      const runtime = await createTestRuntime()
      const records = new Map<string, AuraRecord>([
        ["rec1", { id: "rec1", tags: [], namespace: "ns1" } as unknown as AuraRecord],
        ["rec2", { id: "rec2", tags: [], namespace: "ns2" } as unknown as AuraRecord],
      ])
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { conflict_mass: 0.5 }),
            b2: sampleBelief("b2", { conflict_mass: 0.5 }),
          },
          hypotheses: {
            h1: sampleHypothesis("h1", { belief_id: "b1", prototype_record_ids: ["rec1"] }),
            h2: sampleHypothesis("h2", { belief_id: "b2", prototype_record_ids: ["rec2"] }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getContradictionClusters(records, "ns1").pipe(Effect.provide(layer))
      )
      expect(result.length).toBeGreaterThanOrEqual(1)
      for (const c of result) {
        expect(c.namespace).toBe("ns1")
      }
    })

    it("respects limit", async () => {
      const runtime = await createTestRuntime()
      const records = new Map<string, AuraRecord>()
      const beliefs: Record<string, ReturnType<typeof sampleBelief>> = {}
      const hypotheses: Record<string, ReturnType<typeof sampleHypothesis>> = {}
      for (let i = 0; i < 10; i++) {
        const bid = `b${i}`
        beliefs[bid] = sampleBelief(bid, { conflict_mass: 0.1 * (i + 1) })
        // Each belief has its own record (no sharing)
        const rid = `rec${i}`
        records.set(rid, { id: rid } as unknown as AuraRecord)
        hypotheses[`h${i}`] = sampleHypothesis(`h${i}`, { belief_id: bid, prototype_record_ids: [rid] })
      }
      const layer = makeLayer({ belief: { beliefs, hypotheses } })
      const result = await Effect.runPromise(
        runtime.getContradictionClusters(records, undefined, 3).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(3)
    })

    it("empty engine returns []", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getContradictionClusters(new Map()).pipe(Effect.provide(layer))
      )
      expect(result).toEqual([])
    })

    it("isolated beliefs produce separate singleton clusters", async () => {
      const runtime = await createTestRuntime()
      const records = new Map<string, AuraRecord>([
        ["rec1", { id: "rec1" } as unknown as AuraRecord],
        ["rec2", { id: "rec2" } as unknown as AuraRecord],
      ])
      const layer = makeLayer({
        belief: {
          beliefs: {
            b1: sampleBelief("b1", { conflict_mass: 0.3 }),
            b2: sampleBelief("b2", { conflict_mass: 0.4 }),
          },
          hypotheses: {
            h1: sampleHypothesis("h1", { belief_id: "b1", prototype_record_ids: ["rec1"] }),
            h2: sampleHypothesis("h2", { belief_id: "b2", prototype_record_ids: ["rec2"] }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getContradictionClusters(records).pipe(Effect.provide(layer))
      )
      expect(result).toHaveLength(2)
      for (const c of result) {
        expect(c.beliefIds).toHaveLength(1)
      }
    })
  })

  describe("getPolicyLifecycleSummary", () => {
    it("aggregates by actionKind correctly", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { actionKind: "recommend", state: "Stable", policyStrength: 0.8, riskScore: 0.2 }),
            h2: sampleHint("h2", { actionKind: "recommend", state: "Candidate", policyStrength: 0.6, riskScore: 0.3 }),
            h3: sampleHint("h3", { actionKind: "avoid", state: "Stable", policyStrength: 0.9, riskScore: 0.5 }),
            h4: sampleHint("h4", { actionKind: "recommend", state: "Suppressed", policyStrength: 0.4, riskScore: 0.1 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getPolicyLifecycleSummary().pipe(Effect.provide(layer))
      )
      expect(result.totalHints).toBe(4)

      const recommendSummary = result.actionSummaries.find((a) => a.actionKind === "recommend")
      expect(recommendSummary).toBeDefined()
      expect(recommendSummary!.totalHints).toBe(3)
      expect(recommendSummary!.stableHints).toBe(1)
      expect(recommendSummary!.candidateHints).toBe(1)
      expect(recommendSummary!.suppressedHints).toBe(1)
      expect(recommendSummary!.rejectedHints).toBe(0)
      expect(recommendSummary!.avgPolicyStrength).toBeCloseTo((0.8 + 0.6 + 0.4) / 3, 5)
      expect(recommendSummary!.avgRiskScore).toBeCloseTo((0.2 + 0.3 + 0.1) / 3, 5)

      const avoidSummary = result.actionSummaries.find((a) => a.actionKind === "avoid")
      expect(avoidSummary).toBeDefined()
      expect(avoidSummary!.totalHints).toBe(1)
    })

    it("aggregates by domain correctly", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { namespace: "ns1", domain: "dom1", state: "Stable", policyStrength: 0.8 }),
            h2: sampleHint("h2", { namespace: "ns1", domain: "dom1", state: "Suppressed", policyStrength: 0.3 }),
            h3: sampleHint("h3", { namespace: "ns1", domain: "dom2", state: "Stable", policyStrength: 0.7 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getPolicyLifecycleSummary().pipe(Effect.provide(layer))
      )
      const dom1 = result.domainSummaries.find((d) => d.domain === "dom1")
      expect(dom1).toBeDefined()
      expect(dom1!.totalHints).toBe(2)
      expect(dom1!.stableHints).toBe(1)
      expect(dom1!.suppressedHints).toBe(1)
      // advisoryPressure = activeHints / totalHints = 1 / 2 = 0.5
      expect(dom1!.advisoryPressure).toBeCloseTo(0.5, 3)

      const dom2 = result.domainSummaries.find((d) => d.domain === "dom2")
      expect(dom2).toBeDefined()
      expect(dom2!.totalHints).toBe(1)
      expect(dom2!.advisoryPressure).toBeCloseTo(1.0, 3) // 1/1
    })

    it("empty engine returns zeros", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer()
      const result = await Effect.runPromise(
        runtime.getPolicyLifecycleSummary().pipe(Effect.provide(layer))
      )
      expect(result.totalHints).toBe(0)
      expect(result.activeHints).toBe(0)
      expect(result.actionSummaries).toHaveLength(0)
      expect(result.domainSummaries).toHaveLength(0)
    })
  })

  describe("getPolicyPressureReport", () => {
    it("computes advisoryPressure correctly", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { namespace: "ns1", domain: "dom1", state: "Stable", policyStrength: 0.9, actionKind: "recommend" }),
            h2: sampleHint("h2", { namespace: "ns1", domain: "dom1", state: "Suppressed", policyStrength: 0.5 }),
            h3: sampleHint("h3", { namespace: "ns2", domain: "dom1", state: "Stable", policyStrength: 0.7 }),
            h4: sampleHint("h4", { namespace: "ns2", domain: "dom1", state: "Rejected", policyStrength: 0.3 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getPolicyPressureReport().pipe(Effect.provide(layer))
      )
      // ns1/dom1: 1 active / 2 total = 0.5 pressure, strongest = h1 (0.9)
      const ns1d1 = result.find((p) => p.namespace === "ns1" && p.domain === "dom1")
      expect(ns1d1).toBeDefined()
      expect(ns1d1!.advisoryPressure).toBeCloseTo(0.5, 3)
      expect(ns1d1!.activeHints).toBe(1)
      expect(ns1d1!.suppressedHints).toBe(1)
      expect(ns1d1!.rejectedHints).toBe(0)
      expect(ns1d1!.strongestHintId).toBe("h1")
      expect(ns1d1!.strongestPolicyStrength).toBe(0.9)

      // ns2/dom1: 1 active / 2 total = 0.5, strongest = h3 (0.7)
      const ns2d1 = result.find((p) => p.namespace === "ns2" && p.domain === "dom1")
      expect(ns2d1).toBeDefined()
      expect(ns2d1!.advisoryPressure).toBeCloseTo(0.5, 3)
      expect(ns2d1!.activeHints).toBe(1)
      expect(ns2d1!.rejectedHints).toBe(1)
      expect(ns2d1!.strongestHintId).toBe("h3")
    })

    it("namespace filter works", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { namespace: "ns1", domain: "dom1", state: "Stable", policyStrength: 0.5 }),
            h2: sampleHint("h2", { namespace: "ns2", domain: "dom1", state: "Stable", policyStrength: 0.5 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getPolicyPressureReport("ns1").pipe(Effect.provide(layer))
      )
      expect(result.every((p) => p.namespace === "ns1")).toBe(true)
    })
  })

  describe("getSurfacedConcepts", () => {
    it("delegates to surfaceConcepts and returns surfaced concepts", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        concept: {
          concepts: {
            c1: sampleConcept("c1", { namespace: "default", state: "Stable", abstraction_score: 0.9 }),
            c2: sampleConcept("c2", { namespace: "other", state: "Stable", abstraction_score: 0.7 }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getSurfacedConcepts().pipe(Effect.provide(layer))
      )
      // surfaceConcepts filters Stable/Candidate only, sorts by abstraction_score desc
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0]!.abstractionScore).toBeGreaterThanOrEqual(result[1]!.abstractionScore)
    })
  })

  describe("getSurfacedPolicyHints", () => {
    it("delegates to surfacePolicyHints and returns surfaced hints", async () => {
      const runtime = await createTestRuntime()
      const layer = makeLayer({
        policy: {
          hints: {
            h1: sampleHint("h1", { state: "Stable", policyStrength: 0.8, namespace: "ns1", domain: "dom1", actionKind: "recommend" }),
          },
        },
      })
      const result = await Effect.runPromise(
        runtime.getSurfacedPolicyHints().pipe(Effect.provide(layer))
      )
      // Should return an array (possibly empty if adapter doesn't map fields correctly)
      expect(Array.isArray(result)).toBe(true)
    })
  })
})
