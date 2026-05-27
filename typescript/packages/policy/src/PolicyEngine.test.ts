import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace } from "@aura/contract"
import { CausalState, PolicyState } from "@aura/contract"
import type { CausalEngineState, CausalDiscoveryMode } from "@aura/contract"
import { PolicyEngineImpl } from "./PolicyEngine"

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
}

function fakeCausalState(patterns: CausalEngineState["patterns"]): CausalEngineState {
  return { version: 1 as const, patterns, discovery_mode: "Standard" as CausalDiscoveryMode }
}

function fakePattern(id: string, overrides: Partial<{
  confidence: number
  state: CausalEngineState["patterns"][string]["state"]
}> = {}): CausalEngineState["patterns"][string] {
  return {
    id,
    antecedent_concept_ids: ["c1"],
    consequent_concept_ids: ["c2"],
    support: 10,
    confidence: overrides.confidence ?? 0.8,
    lift: 2.0,
    state: overrides.state ?? CausalState.Stable,
    last_updated: 900
  }
}

function runWithClock<R>(effect: Effect.Effect<R, never, EpistemicTrace>): Promise<R> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(EpistemicTrace, NoopTrace)
    )
  )
}

describe("PolicyEngine", () => {
  it("stats returns initial empty state", async () => {
    const engine = new PolicyEngineImpl()
    const state = await Effect.runPromise(engine.stats())
    assert.strictEqual(state.version, 1)
    assert.deepStrictEqual(state.hints, {})
  })

  it("discover returns empty report when no causal patterns", async () => {
    const engine = new PolicyEngineImpl()
    const causalState = fakeCausalState({})
    const report = await runWithClock(engine.discover(causalState, new Map()))
    assert.strictEqual(report.hints_found, 0)
    assert.strictEqual(report.hints_active, 0)
    assert.strictEqual(report.avg_confidence, 0)
  })

  it("discover creates hints from stable causal patterns", async () => {
    const engine = new PolicyEngineImpl()
    const causalState = fakeCausalState({
      "cp-001": fakePattern("cp-001", { confidence: 0.85 })
    })
    const report = await runWithClock(engine.discover(causalState, new Map()))
    assert.ok(report.hints_found >= 1)
    assert.ok(report.hints_active >= 1)
    assert.ok(report.avg_confidence > 0)
  })

  it("creates suppressed hints for invalidated patterns", async () => {
    const engine = new PolicyEngineImpl()
    const causalState = fakeCausalState({
      "cp-002": fakePattern("cp-002", { confidence: 0.9, state: CausalState.Invalidated })
    })
    const report = await runWithClock(engine.discover(causalState, new Map()))
    assert.ok(report.hints_suppressed >= 1)
  })

  it("retract_hint removes hint from state", async () => {
    const engine = new PolicyEngineImpl()
    const causalState = fakeCausalState({ "cp-003": fakePattern("cp-003") })
    await runWithClock(engine.discover(causalState, new Map()))
    const state1 = await Effect.runPromise(engine.stats())
    const hintIds = Object.keys(state1.hints)
    assert.ok(hintIds.length > 0)

    const targetId = hintIds[0]!
    await Effect.runPromise(engine.retract_hint(targetId))

    const state2 = await Effect.runPromise(engine.stats())
    assert.ok(!(targetId in state2.hints))
  })

  it("discover is deterministic across replays", async () => {
    const run = () => {
      const engine = new PolicyEngineImpl()
      const causalState = fakeCausalState({
        "cp-a": fakePattern("cp-a", { confidence: 0.8 }),
        "cp-b": fakePattern("cp-b", { confidence: 0.6 })
      })
      return runWithClock(engine.discover(causalState, new Map()))
    }

    const r1 = await run()
    const r2 = await run()
    assert.strictEqual(r1.hints_found, r2.hints_found)
    assert.strictEqual(r1.hints_active, r2.hints_active)
    assert.strictEqual(r1.avg_confidence, r2.avg_confidence)
  })
})
