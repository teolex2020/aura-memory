import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace, BeliefEngine, TemporalBudgetMode, EvidenceMode } from "@aura/contract"
import { CausalState, CausalDiscoveryMode } from "@aura/contract"
import type { BeliefEngineState, BeliefReport } from "@aura/contract"
import type { SdrLookup } from "@aura/contract"
import { CausalEngineImpl } from "./CausalEngine"

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
}

function mockBeliefEngine(): BeliefEngine.Interface {
  return {
    with_coarse_key_mode: (_mode: unknown) => Effect.void,
    claim_key: (_ns: string, _tags: readonly string[], _st: string) => Effect.succeed("key"),
    claim_key_with_mode: (_ns: string, _tags: readonly string[], _st: string, _mode: unknown) => Effect.succeed("key"),
    update: (_records: ReadonlyMap<string, any>) => Effect.succeed({} as BeliefReport),
    update_with_sdr: (_records: ReadonlyMap<string, any>, _sdr: SdrLookup) => Effect.succeed({} as BeliefReport),
    belief_for_record: (_rid: string) => Effect.succeed(null as string | null),
    deprecate_belief: (_bid: string) => Effect.void,
    apply_layer_feedback: (..._args: unknown[]) => Effect.succeed({} as unknown),
    unresolved_beliefs: () => Effect.succeed([] as readonly string[]),
    stats: () => Effect.succeed({ version: 1 as const, beliefs: {}, hypotheses: {}, record_to_belief: {}, key_index: {}, record_index: {} } as BeliefEngineState)
  }
}

function runWithClock<R>(effect: Effect.Effect<R, never, EpistemicTrace>): Promise<R> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(EpistemicTrace, NoopTrace)
    )
  )
}

describe("CausalEngine (contract-aligned stub)", () => {
  it("stats returns initial empty state with new contract fields", async () => {
    const engine = new CausalEngineImpl()
    const state = await Effect.runPromise(engine.stats())
    assert.strictEqual(state.version, 1)
    assert.deepStrictEqual(state.patterns, {})
    assert.strictEqual(state.discovery_mode, CausalDiscoveryMode.Standard)
    assert.strictEqual(state.edges_found_total, 0)
    assert.strictEqual(state.temporal_budget_mode, TemporalBudgetMode.NearbySuccessors)
    assert.strictEqual(state.evidence_mode, EvidenceMode.StrictRepeatedWindows)
    assert.strictEqual(state.last_corpus_fingerprint, "")
  })

  it("discover accepts BeliefEngine.Interface and returns full report", async () => {
    const engine = new CausalEngineImpl()
    const beliefEng = mockBeliefEngine()
    const records = new Map()
    const sdr = new Map()

    const report = await runWithClock(engine.discover(beliefEng, records, sdr))
    assert.strictEqual(report.patterns_found, 0)
    assert.strictEqual(report.patterns_active, 0)
    assert.strictEqual(report.avg_confidence, 0)
    assert.strictEqual(report.avg_lift, 0)
    assert.strictEqual(report.explicit_edges, 0)
    assert.strictEqual(report.temporal_edges, 0)
    assert.strictEqual(report.avg_causal_strength, 0)
    assert.strictEqual(report.stable_count, 0)
    assert.strictEqual(report.rejected_count, 0)
  })

  it("invalidate_pattern marks pattern as Invalidated", async () => {
    const engine = new CausalEngineImpl()
    // Pre-seed a pattern via direct state mutation for testing
    const state = await Effect.runPromise(engine.stats())
    ;(state as any).patterns["cp-test"] = {
      id: "cp-test",
      cause_belief_id: "b1",
      effect_belief_id: "b2",
      cause_key: "ns:k1:k2:h",
      effect_key: "k2",
      edge_hash: "h",
      support: 10,
      confidence: 0.8,
      lift: 2.0,
      state: CausalState.Stable,
      last_updated: 900,
      transition_lift: 0.5,
      temporal_consistency: 0.7,
      outcome_stability: 0.6,
      causal_strength: 0.65,
      support_count: 10,
      explicit_support_count: 5,
      counterevidence_count: 2,
      temporal_windows: 3,
      namespace: "test",
      cause_record_ids: ["r1"],
      effect_record_ids: ["r2"]
    }

    // TypeScript doesn't track the mutation through Effect.succeed, but the
    // engine's internal state was mutated. Cast to proceed.
    const patState = (state as any).patterns["cp-test"] as any
    assert.strictEqual(patState.state, CausalState.Stable)

    await Effect.runPromise(engine.invalidate_pattern("cp-test"))
    const state2 = await Effect.runPromise(engine.stats())
    const p2 = (state2 as any).patterns["cp-test"] as any
    assert.ok(p2 !== undefined)
    assert.strictEqual(p2.state, CausalState.Invalidated)
  })

  it("retract_pattern removes pattern from state", async () => {
    const engine = new CausalEngineImpl()
    const state = await Effect.runPromise(engine.stats())
    ;(state as any).patterns["cp-rm"] = {
      id: "cp-rm",
      cause_belief_id: "b1",
      effect_belief_id: "b2",
      cause_key: "ns:k1:k2:h",
      effect_key: "k2",
      edge_hash: "h",
      support: 10,
      confidence: 0.8,
      lift: 2.0,
      state: CausalState.Candidate,
      last_updated: 900,
      transition_lift: 0.5,
      temporal_consistency: 0.7,
      outcome_stability: 0.6,
      causal_strength: 0.65,
      support_count: 10,
      explicit_support_count: 5,
      counterevidence_count: 2,
      temporal_windows: 3,
      namespace: "test",
      cause_record_ids: ["r1"],
      effect_record_ids: ["r2"]
    }
    assert.ok("cp-rm" in (state as any).patterns)

    await Effect.runPromise(engine.retract_pattern("cp-rm"))
    const state2 = await Effect.runPromise(engine.stats())
    assert.ok(!("cp-rm" in (state2 as any).patterns))
  })

  it("discover emits trace events", async () => {
    const events: Array<{ name: string; fields: unknown }> = []
    const spyTrace = {
      event: (name: string, fields: Record<string, string | number | boolean>): Effect.Effect<void> =>
        Effect.sync(() => { events.push({ name, fields }) }),
      span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
    }

    const engine = new CausalEngineImpl()
    const beliefEng = mockBeliefEngine()

    await Effect.runPromise(
      engine.discover(beliefEng, new Map(), new Map()).pipe(
        Effect.provideService(EpistemicTrace, spyTrace)
      )
    )

    assert.strictEqual(events.length, 2)
    assert.strictEqual(events[0]!.name, "causal.discover.start")
    assert.strictEqual(events[1]!.name, "causal.discover.end")
  })

  it("discover with stub returns deterministic output", async () => {
    const run = () => {
      const engine = new CausalEngineImpl()
      const beliefEng = mockBeliefEngine()
      return runWithClock(engine.discover(beliefEng, new Map(), new Map()))
    }

    const r1 = await run()
    const r2 = await run()
    assert.deepStrictEqual(r1, r2)
  })
})
