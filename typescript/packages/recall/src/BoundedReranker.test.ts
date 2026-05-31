import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  BeliefRerankMode,
  BeliefState,
  CausalRerankMode,
  CausalState,
  ConceptState,
  ConceptSurfaceMode,
  PolicyActionKind,
  PolicyRerankMode,
  PolicyState,
  type BeliefEngineState,
  type CausalEngineState,
  type ConceptEngineState,
  type PolicyEngineState
} from "@aura/contract"
import {
  BoundedRerankerImpl,
  OFF_RERANK_MODES,
  RUST_RUNTIME_RERANK_MODES,
  rerankWithSnapshots
} from "./BoundedReranker"

describe("BoundedReranker", () => {
  it("returns same list for single element", async () => {
    const reranker = new BoundedRerankerImpl()
    const scored: Array<readonly [number, string]> = [[0.8, "r1"]]
    const result = await Effect.runPromise(reranker.rerank(scored, "test"))
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0]![1], "r1")
  })

  it("does not apply the old non-parity position boost", async () => {
    const reranker = new BoundedRerankerImpl()
    const scored: Array<readonly [number, string]> = [
      [0.5, "r1"],
      [0.4, "r2"],
      [0.9, "r3"]
    ]
    const result = await Effect.runPromise(reranker.rerank(scored, "test"))
    assert.deepStrictEqual(result, scored)
  })

  it("empty input returns empty", async () => {
    const reranker = new BoundedRerankerImpl()
    const result = await Effect.runPromise(reranker.rerank([], "query"))
    assert.strictEqual(result.length, 0)
    assert.deepStrictEqual(result, [])
  })

  it("preserves all record IDs", async () => {
    const reranker = new BoundedRerankerImpl()
    const ids = ["r1", "r2", "r3", "r4", "r5"]
    const scored: Array<readonly [number, string]> = ids.map((id, i) => [0.1 * (5 - i), id] as const)
    const result = await Effect.runPromise(reranker.rerank(scored, "test"))
    const resultIds = result.map(r => r[1]).sort()
    assert.deepStrictEqual(resultIds, [...ids].sort())
  })

  it("applies Rust belief Limited multipliers with positional shift cap", () => {
    const scored: Array<readonly [number, string]> = [
      [0.800, "r0"],
      [0.799, "r1"],
      [0.798, "r2"],
      [0.797, "r3"]
    ]
    const result = rerankWithSnapshots(
      scored,
      10,
      { belief: beliefState({ r3: BeliefState.Resolved }) },
      { ...OFF_RERANK_MODES, beliefMode: BeliefRerankMode.Limited }
    )

    assert.deepStrictEqual(result.map(([, id]) => id), ["r0", "r3", "r1", "r2"])
    assert.ok(Math.abs(result[1]![0] - (0.797 * 1.05)) < 0.000001)
  })

  it("skips Limited rerank when topK exceeds Rust guard", () => {
    const scored: Array<readonly [number, string]> = [
      [0.800, "r0"],
      [0.799, "r1"],
      [0.798, "r2"],
      [0.797, "r3"]
    ]
    const result = rerankWithSnapshots(
      scored,
      21,
      { belief: beliefState({ r3: BeliefState.Resolved }) },
      { ...OFF_RERANK_MODES, beliefMode: BeliefRerankMode.Limited }
    )

    assert.deepStrictEqual(result, scored)
  })

  it("keeps concept rerank disabled in Rust runtime Inspect mode", () => {
    const scored: Array<readonly [number, string]> = [
      [0.800, "r0"],
      [0.799, "r1"],
      [0.798, "r2"],
      [0.797, "r3"]
    ]
    const concept = conceptState("r3", ConceptState.Stable, 0.9)
    const inspectResult = rerankWithSnapshots(scored, 10, { concept }, RUST_RUNTIME_RERANK_MODES)
    const limitedResult = rerankWithSnapshots(
      scored,
      10,
      { concept },
      { ...OFF_RERANK_MODES, conceptMode: ConceptSurfaceMode.Limited }
    )

    assert.deepStrictEqual(inspectResult, scored)
    assert.deepStrictEqual(limitedResult.map(([, id]) => id), ["r0", "r3", "r1", "r2"])
  })

  it("applies Rust runtime causal and policy Limited modes", () => {
    const scored: Array<readonly [number, string]> = [
      [0.800, "r0"],
      [0.799, "r1"],
      [0.798, "r2"],
      [0.797, "r3"]
    ]
    const causalResult = rerankWithSnapshots(
      scored,
      10,
      { causal: causalState({ effect: ["r3"], cause: [] }) },
      RUST_RUNTIME_RERANK_MODES
    )
    const policyResult = rerankWithSnapshots(
      scored,
      10,
      { policy: policyState("r3", PolicyActionKind.Prefer, PolicyState.Stable, 0.9) },
      RUST_RUNTIME_RERANK_MODES
    )

    assert.deepStrictEqual(causalResult.map(([, id]) => id), ["r0", "r3", "r1", "r2"])
    assert.deepStrictEqual(policyResult.map(([, id]) => id), ["r0", "r3", "r1", "r2"])
  })
})

function beliefState(recordStates: Record<string, BeliefState>): BeliefEngineState {
  const beliefs: Record<string, BeliefEngineState["beliefs"][string]> = {}
  const record_to_belief: Record<string, string> = {}
  for (const [recordId, state] of Object.entries(recordStates)) {
    const beliefId = `b-${recordId}`
    beliefs[beliefId] = {
      id: beliefId,
      key: beliefId,
      hypothesis_ids: [],
      winner_id: null,
      state,
      score: 1,
      confidence: 1,
      support_mass: 1,
      conflict_mass: 0,
      stability: 1,
      volatility: 0,
      last_updated: 0
    }
    record_to_belief[recordId] = beliefId
  }
  return { version: 1, beliefs, hypotheses: {}, record_to_belief, key_index: {}, record_index: record_to_belief }
}

function conceptState(
  recordId: string,
  state: ConceptState,
  abstraction_score: number
): ConceptEngineState {
  return {
    version: 1,
    concepts: {
      c1: {
        id: "c1",
        key: "c1",
        namespace: "default",
        semantic_type: "fact",
        belief_ids: [],
        record_ids: [recordId],
        core_terms: [],
        shell_terms: [],
        tags: [],
        support_mass: 1,
        confidence: 1,
        stability: 1,
        cohesion: 1,
        abstraction_score,
        state,
        last_updated: 0
      }
    },
    key_index: {},
    seed_mode: "Standard" as ConceptEngineState["seed_mode"],
    similarity_mode: "SdrTanimoto" as ConceptEngineState["similarity_mode"],
    partition_mode: "Standard" as ConceptEngineState["partition_mode"],
    union_mode: "Standard" as ConceptEngineState["union_mode"]
  }
}

function causalState(records: {
  readonly effect: ReadonlyArray<string>
  readonly cause: ReadonlyArray<string>
}): CausalEngineState {
  return {
    version: 1,
    patterns: {
      p1: {
        id: "p1",
        cause_belief_id: "b-cause",
        effect_belief_id: "b-effect",
        cause_key: "cause",
        effect_key: "effect",
        edge_hash: "edge",
        support: 1,
        confidence: 1,
        lift: 1,
        state: CausalState.Stable,
        last_updated: 0,
        transition_lift: 1,
        temporal_consistency: 1,
        outcome_stability: 1,
        causal_strength: 1,
        support_count: 1,
        explicit_support_count: 1,
        temporal_support_count: 0,
        counterevidence_count: 0,
        temporal_windows: 1,
        explicit_support_total_for_cause: 1,
        explicit_effect_variants_for_cause: 1,
        effect_record_signature_variants: 1,
        positive_effect_signals: 1,
        negative_effect_signals: 0,
        namespace: "default",
        cause_record_ids: records.cause,
        effect_record_ids: records.effect
      }
    },
    discovery_mode: "Standard" as CausalEngineState["discovery_mode"],
    edges_found_total: 0,
    temporal_budget_mode: "NearbySuccessors" as CausalEngineState["temporal_budget_mode"],
    evidence_mode: "StrictRepeatedWindows" as CausalEngineState["evidence_mode"],
    last_corpus_fingerprint: ""
  }
}

function policyState(
  recordId: string,
  actionKind: PolicyActionKind,
  state: PolicyState,
  policyStrength: number
): PolicyEngineState {
  return {
    version: 1,
    hints: {
      h1: {
        id: "h1",
        pattern_id: "p1",
        condition: "when cause",
        action: actionKind,
        priority: 1,
        confidence: 1,
        state,
        last_updated: 0,
        actionKind,
        policyStrength,
        riskScore: 0,
        namespace: "default",
        domain: "default",
        polarity: "Positive" as PolicyEngineState["hints"][string]["polarity"],
        recommendation: "",
        utilityScore: 1,
        cause_key: "cause",
        effect_keys: [recordId],
        cause_record_ids: []
      }
    },
    metadata: {},
    key_index: {}
  }
}
