import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace, CausalEngine, BeliefEngine } from "@aura/contract"
import { CausalState, CausalDiscoveryMode, TemporalBudgetMode, EvidenceMode } from "@aura/contract"
import type {
  CausalEngineState,
  CausalPattern,
  ConceptEngineImpl,
  BeliefEngineState,
  BeliefReport,
  SdrLookup
} from "@aura/contract"
import { PolicyEngineImpl } from "./PolicyEngine"

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
}

function mockCausalEngine(): CausalEngine.Interface {
  return {
    discover: (_be: BeliefEngine.Interface, _records: ReadonlyMap<string, any>, _sdr: SdrLookup) => Effect.succeed({} as any),
    invalidate_pattern: (_id: string) => Effect.void,
    retract_pattern: (_id: string) => Effect.void,
    stats: () => Effect.succeed({} as CausalEngineState)
  }
}

function mockConceptEngine(): ConceptEngineImpl {
  return {
    with_seed_mode: (_mode: any) => Effect.void,
    discover: (_be: BeliefEngine.Interface, _records: ReadonlyMap<string, any>, _sdr: SdrLookup) => Effect.succeed({} as any),
    stable_concepts: () => Effect.succeed([] as readonly string[]),
    active_candidates: () => Effect.succeed([] as readonly string[]),
    stats: () => Effect.succeed({} as any)
  }
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

describe("PolicyEngine (contract-aligned stub)", () => {
  it("stats returns initial empty state", async () => {
    const engine = new PolicyEngineImpl()
    const state = await Effect.runPromise(engine.stats())
    assert.strictEqual(state.version, 1)
    assert.deepStrictEqual(state.hints, {})
  })

  it("discover returns empty report with zero causal patterns", async () => {
    const engine = new PolicyEngineImpl()
    const cEng = mockCausalEngine()
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, new Map()))
    assert.strictEqual(report.hints_found, 0)
    assert.strictEqual(report.hints_active, 0)
    assert.strictEqual(report.avg_confidence, 0)
    assert.strictEqual(report.seeds_found, 0)
    assert.strictEqual(report.stable_hints, 0)
    assert.strictEqual(report.avg_policy_strength, 0)
  })

  it("retract_hint removes hint from state", async () => {
    const engine = new PolicyEngineImpl()
    // Pre-seed a hint via direct state mutation for testing
    const state = await Effect.runPromise(engine.stats())
    ;(state as any).hints["ph-test"] = {
      id: "ph-test",
      pattern_id: "cp-1",
      condition: "test",
      action: "test",
      priority: 5,
      confidence: 0.8,
      state: "Stable",
      last_updated: 1000,
      actionKind: "prefer",
      policyStrength: 0.8,
      riskScore: 0.2,
      namespace: "test",
      domain: "test",
      polarity: "Positive",
      recommendation: "Consider this pattern",
      utilityScore: 0.7,
      cause_key: "k1",
      effect_keys: ["k2"]
    }
    assert.ok("ph-test" in (state as any).hints)

    await Effect.runPromise(engine.retract_hint("ph-test"))
    const state2 = await Effect.runPromise(engine.stats())
    assert.ok(!("ph-test" in (state2 as any).hints))
  })

  it("discover emits trace events", async () => {
    const events: Array<{ name: string; fields: unknown }> = []
    const spyTrace = {
      event: (name: string, fields: Record<string, string | number | boolean>): Effect.Effect<void> =>
        Effect.sync(() => { events.push({ name, fields }) }),
      span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
    }

    const engine = new PolicyEngineImpl()
    const cEng = mockCausalEngine()
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine()

    await Effect.runPromise(
      engine.discover(cEng, ctEng, bEng, new Map()).pipe(
        Effect.provideService(EpistemicTrace, spyTrace)
      )
    )

    assert.strictEqual(events.length, 2)
    assert.strictEqual(events[0]!.name, "policy.discover.start")
    assert.strictEqual(events[1]!.name, "policy.discover.end")
  })

  it("discover is deterministic across replays", async () => {
    const run = () => {
      const engine = new PolicyEngineImpl()
      const cEng = mockCausalEngine()
      const ctEng = mockConceptEngine()
      const bEng = mockBeliefEngine()
      return runWithClock(engine.discover(cEng, ctEng, bEng, new Map()))
    }

    const r1 = await run()
    const r2 = await run()
    assert.strictEqual(r1.hints_found, r2.hints_found)
    assert.strictEqual(r1.hints_active, r2.hints_active)
    assert.strictEqual(r1.avg_confidence, r2.avg_confidence)
  })
})
