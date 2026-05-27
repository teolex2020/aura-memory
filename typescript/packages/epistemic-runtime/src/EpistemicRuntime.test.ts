import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect, Layer } from "effect"
import {
  BeliefEngine,
  ConceptEngine,
  CausalEngine,
  PolicyEngine,
  EpistemicTrace,
  type BeliefReport,
  type ConceptReport,
  type CausalReport,
  type PolicyReport,
  type EpistemicReport
} from "@aura/contract"
import { EpistemicRuntimeImpl } from "./EpistemicRuntime"

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
}

const emptyBeliefReport: BeliefReport = { coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0 }
const emptyConceptReport: ConceptReport = {
  seeds_found: 0, candidates_found: 0, stable_count: 0, rejected_count: 0, avg_abstraction_score: 0,
  centroids_built: 0, partitions_with_multiple_seeds: 0, multi_seed_partition_sizes: [],
  cluster_sizes: [], clusters_with_multiple_beliefs: 0, largest_cluster_size: 0,
  pairwise_comparisons: 0, pairwise_above_threshold: 0,
  tanimoto_min: 0, tanimoto_max: 0, tanimoto_avg: 0, tanimoto_p50: 0, tanimoto_p95: 0,
  avg_centroid_size: 0, seeds_capped: 0
}
const emptyCausalReport: CausalReport = { patterns_found: 0, patterns_active: 0, patterns_invalidated: 0, avg_confidence: 0, avg_lift: 0 }
const emptyPolicyReport: PolicyReport = { hints_found: 0, hints_active: 0, hints_suppressed: 0, avg_confidence: 0 }

function mockBeliefEngine() {
  return {
    update_with_sdr: (): Effect.Effect<BeliefReport, never> => Effect.succeed(emptyBeliefReport),
    stats: () => Effect.succeed({ version: 1 as const, beliefs: {}, hypotheses: {}, record_to_belief: {} }),
    belief_for_record: () => Effect.succeed(null as string | null),
    update: () => Effect.succeed(emptyBeliefReport),
    with_coarse_key_mode: () => Effect.void,
    claim_key: () => Effect.succeed(""),
    claim_key_with_mode: () => Effect.succeed(""),
    deprecate_belief: () => Effect.void,
    apply_layer_feedback: () => Effect.succeed({}),
    unresolved_beliefs: () => Effect.succeed([] as ReadonlyArray<string>)
  }
}

function mockConceptEngine() {
  return {
    discover: (): Effect.Effect<ConceptReport, never> => Effect.succeed(emptyConceptReport),
    stats: () => Effect.succeed({
      version: 1 as const, concepts: {}, key_index: {},
      seed_mode: "Standard" as const, similarity_mode: "SdrTanimoto" as const,
      partition_mode: "Standard" as const, union_mode: "Standard" as const
    }),
    with_seed_mode: () => Effect.void,
    stable_concepts: () => Effect.succeed([] as ReadonlyArray<string>),
    active_candidates: () => Effect.succeed([] as ReadonlyArray<string>)
  }
}

function mockCausalEngine() {
  return {
    discover: (): Effect.Effect<CausalReport, never> => Effect.succeed(emptyCausalReport),
    stats: () => Effect.succeed({ version: 1 as const, patterns: {}, discovery_mode: "Standard" as const }),
    invalidate_pattern: () => Effect.void,
    retract_pattern: () => Effect.void
  }
}

function mockPolicyEngine() {
  return {
    discover: (): Effect.Effect<PolicyReport, never> => Effect.succeed(emptyPolicyReport),
    stats: () => Effect.succeed({ version: 1 as const, hints: {}, metadata: {} }),
    retract_hint: () => Effect.void
  }
}

function makeLayer() {
  return Layer.mergeAll(
    Layer.succeed(BeliefEngine, mockBeliefEngine()),
    Layer.succeed(ConceptEngine, mockConceptEngine()),
    Layer.succeed(CausalEngine, mockCausalEngine()),
    Layer.succeed(PolicyEngine, mockPolicyEngine()),
    Layer.succeed(EpistemicTrace, NoopTrace)
  )
}

describe("EpistemicRuntime", () => {
  it("maintain runs full pipeline and returns EpistemicReport", async () => {
    const runtime = new EpistemicRuntimeImpl()
    const records = new Map<string, any>()
    const sdr = new Map<string, ReadonlyArray<number>>()

    const report = await Effect.runPromise(
      runtime.maintain(records, sdr).pipe(
        Effect.provide(makeLayer())
      )
    )

    assert.ok("belief" in report)
    assert.ok("concept" in report)
    assert.ok("causal" in report)
    assert.ok("policy" in report)
    assert.strictEqual(report.belief.beliefs_built, 0)
    assert.strictEqual(report.concept.candidates_found, 0)
    assert.strictEqual(report.causal.patterns_found, 0)
    assert.strictEqual(report.policy.hints_found, 0)
  })

  it("get_beliefs returns BeliefEngineState", async () => {
    const runtime = new EpistemicRuntimeImpl()
    const state = await Effect.runPromise(
      runtime.get_beliefs().pipe(Effect.provide(makeLayer()))
    )
    assert.strictEqual(state.version, 1)
    assert.ok("beliefs" in state)
  })

  it("get_concepts returns ConceptEngineState", async () => {
    const runtime = new EpistemicRuntimeImpl()
    const state = await Effect.runPromise(
      runtime.get_concepts().pipe(Effect.provide(makeLayer()))
    )
    assert.strictEqual(state.version, 1)
    assert.ok("concepts" in state)
  })

  it("get_causal_patterns returns CausalEngineState", async () => {
    const runtime = new EpistemicRuntimeImpl()
    const state = await Effect.runPromise(
      runtime.get_causal_patterns().pipe(Effect.provide(makeLayer()))
    )
    assert.strictEqual(state.version, 1)
    assert.ok("patterns" in state)
  })

  it("get_policy_hints returns PolicyEngineState", async () => {
    const runtime = new EpistemicRuntimeImpl()
    const state = await Effect.runPromise(
      runtime.get_policy_hints().pipe(Effect.provide(makeLayer()))
    )
    assert.strictEqual(state.version, 1)
    assert.ok("hints" in state)
  })
})
