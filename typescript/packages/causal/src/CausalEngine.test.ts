import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace } from "@aura/contract"
import { CausalState, CausalDiscoveryMode } from "@aura/contract"
import type {
  ConceptEngineState,
  ConceptCandidate,
  ConceptState,
  ConceptSeedMode,
  ConceptSimilarityMode,
  ConceptPartitionMode,
  ConceptUnionMode
} from "@aura/contract"
import { CausalEngineImpl } from "./CausalEngine"

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
}

function fakeConceptState(concepts: Record<string, ConceptCandidate>): ConceptEngineState {
  return {
    version: 1 as const,
    concepts,
    key_index: {},
    seed_mode: "Standard" as ConceptSeedMode,
    similarity_mode: "SdrTanimoto" as ConceptSimilarityMode,
    partition_mode: "Standard" as ConceptPartitionMode,
    union_mode: "Standard" as ConceptUnionMode
  }
}

function fakeConcept(id: string, recordIds: string[]): ConceptCandidate {
  return {
    id,
    key: `concept:${id}`,
    namespace: "test",
    semantic_type: "fact",
    belief_ids: recordIds.map(r => `belief-${r}`),
    record_ids: recordIds,
    core_terms: [],
    shell_terms: [],
    tags: [],
    support_mass: 1,
    confidence: 0.8,
    stability: 3,
    cohesion: 0.5,
    abstraction_score: 0.5,
    state: "Stable" as ConceptState,
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

describe("CausalEngine", () => {
  it("stats returns initial empty state", async () => {
    const engine = new CausalEngineImpl()
    const state = await Effect.runPromise(engine.stats())
    assert.strictEqual(state.version, 1)
    assert.deepStrictEqual(state.patterns, {})
    assert.strictEqual(state.discovery_mode, CausalDiscoveryMode.Standard)
  })

  it("discover returns empty report when fewer than 2 concepts", async () => {
    const engine = new CausalEngineImpl()
    const conceptState = fakeConceptState({
      "c1": fakeConcept("c1", ["r1"])
    })
    const records = new Map()
    const sdr = new Map()

    const report = await runWithClock(engine.discover(conceptState, records, sdr))
    assert.strictEqual(report.patterns_found, 0)
    assert.strictEqual(report.patterns_active, 0)
    assert.strictEqual(report.avg_confidence, 0)
  })

  it("discover creates patterns from co-occurring concepts", async () => {
    const engine = new CausalEngineImpl()
    const conceptState = fakeConceptState({
      "c1": fakeConcept("c1", ["r1", "r2"]),
      "c2": fakeConcept("c2", ["r1", "r3"])
    })
    const report = await runWithClock(engine.discover(conceptState, new Map(), new Map()))
    assert.ok(report.patterns_found >= 1)
    assert.ok(report.patterns_found >= report.patterns_active)
  })

  it("invalidate_pattern marks pattern as Invalidated", async () => {
    const engine = new CausalEngineImpl()
    const conceptState = fakeConceptState({
      "c1": fakeConcept("c1", ["r1"]),
      "c2": fakeConcept("c2", ["r1"])
    })
    await runWithClock(engine.discover(conceptState, new Map(), new Map()))
    const state1 = await Effect.runPromise(engine.stats())
    const patternIds = Object.keys(state1.patterns)
    assert.ok(patternIds.length > 0)

    const targetId = patternIds[0]!
    await Effect.runPromise(engine.invalidate_pattern(targetId))

    const state2 = await Effect.runPromise(engine.stats())
    assert.strictEqual(state2.patterns[targetId]!.state, CausalState.Invalidated)
  })

  it("retract_pattern removes pattern from state", async () => {
    const engine = new CausalEngineImpl()
    const conceptState = fakeConceptState({
      "c1": fakeConcept("c1", ["r1"]),
      "c2": fakeConcept("c2", ["r1"])
    })
    await runWithClock(engine.discover(conceptState, new Map(), new Map()))
    const state1 = await Effect.runPromise(engine.stats())
    const patternIds = Object.keys(state1.patterns)
    assert.ok(patternIds.length > 0)

    const targetId = patternIds[0]!
    await Effect.runPromise(engine.retract_pattern(targetId))

    const state2 = await Effect.runPromise(engine.stats())
    assert.ok(!(targetId in state2.patterns))
  })

  it("discover emits trace events", async () => {
    const events: Array<{ name: string; fields: unknown }> = []
    const spyTrace = {
      event: (name: string, fields: Record<string, string | number | boolean>): Effect.Effect<void> =>
        Effect.sync(() => { events.push({ name, fields }) }),
      span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
    }

    const engine = new CausalEngineImpl()
    const conceptState = fakeConceptState({
      "c1": fakeConcept("c1", ["r1", "r2"]),
      "c2": fakeConcept("c2", ["r1", "r3"])
    })

    await Effect.runPromise(
      engine.discover(conceptState, new Map(), new Map()).pipe(
        Effect.provideService(EpistemicTrace, spyTrace)
      )
    )

    assert.strictEqual(events.length, 2)
    assert.strictEqual(events[0]!.name, "causal.discover.start")
    assert.strictEqual(events[1]!.name, "causal.discover.end")
  })

  it("discover with overlapping concepts produces deterministic output", async () => {
    const run = () => {
      const engine = new CausalEngineImpl()
      const conceptState = fakeConceptState({
        "c1": fakeConcept("c1", ["r1", "r2"]),
        "c2": fakeConcept("c2", ["r1", "r3"]),
        "c3": fakeConcept("c3", ["r2", "r3"])
      })
      return runWithClock(engine.discover(conceptState, new Map(), new Map()))
    }

    const r1 = await run()
    const r2 = await run()
    assert.deepStrictEqual(r1, r2)
  })
})
