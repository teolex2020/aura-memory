import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  BeliefState,
  EpistemicTrace,
  Level,
  type BeliefEngine,
  type BeliefEngineState,
  type EpistemicTraceImpl,
  type Record as AuraRecord,
  type SdrLookup
} from "@aura/contract"
import { nowSecs } from "@aura/utils"
import { ConceptEngineImpl } from "./ConceptEngine"

const NoopTrace: EpistemicTraceImpl = {
  event: () => Effect.void,
  span: (_name, _fields, eff) => eff
}

function makeRecord(
  id: string,
  content: string,
  tags: ReadonlyArray<string>,
  semantic_type: string
): AuraRecord {
  return {
    id,
    content,
    level: Level.Working,
    strength: 1,
    activation_count: 0,
    created_at: nowSecs(),
    last_activated: 0,
    tags,
    connections: {},
    content_type: "text/plain",
    source_type: "recorded",
    namespace: "default",
    semantic_type,
    metadata: {},
    aura_id: null,
    caused_by_id: null,
    confidence: 0.9,
    support_mass: 2,
    conflict_mass: 0
  }
}

function fakeBeliefEngine(state: BeliefEngineState): BeliefEngine.Interface {
  return {
    with_coarse_key_mode: () => Effect.void,
    claim_key: () => Effect.succeed(""),
    claim_key_with_mode: () => Effect.succeed(""),
    update: () => Effect.succeed({ coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0 }),
    update_with_sdr: () => Effect.succeed({ coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0 }),
    belief_for_record: (rid) => Effect.succeed(state.record_to_belief[rid] ?? null),
    deprecate_belief: () => Effect.void,
    apply_layer_feedback: () => Effect.succeed(undefined),
    unresolved_beliefs: () =>
      Effect.succeed(Object.values(state.beliefs).filter((b) => b.state === BeliefState.Unresolved).map((b) => b.id)),
    stats: () => Effect.succeed(state)
  }
}

it("ConceptEngine: unresolved beliefs should not seed concepts", async () => {
  const concept = new ConceptEngineImpl()
  const state: BeliefEngineState = {
    version: 1,
    beliefs: {
      b1: {
        id: "b1",
        key: "default:ui,theme:preference",
        hypothesis_ids: ["h1"],
        winner_id: null,
        state: BeliefState.Unresolved,
        score: 0.5,
        confidence: 0.6,
        support_mass: 2,
        conflict_mass: 2,
        stability: 0,
        volatility: 0,
        last_updated: nowSecs()
      }
    },
    hypotheses: {
      h1: {
        id: "h1",
        belief_id: "b1",
        prototype_record_ids: ["r1"],
        confidence: 0.6,
        support_mass: 2,
        conflict_mass: 2,
        recency: 1,
        consistency: 1,
        score: 0.5
      }
    },
    record_to_belief: { r1: "b1" }
  }

  const records = new Map<string, AuraRecord>([["r1", makeRecord("r1", "tabs are better than spaces for indentation in code", ["coding", "style"], "preference")]])
  const sdr: SdrLookup = new Map([["r1", [1, 2, 3]]])

  const report = await Effect.runPromise(
    concept.discover(fakeBeliefEngine(state), records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )
  assert.strictEqual(report.seeds_found, 0)
  assert.strictEqual(report.candidates_found, 0)
})

it("ConceptEngine: candidates form from resolved/singleton beliefs and provenance is complete", async () => {
  const concept = new ConceptEngineImpl()
  const state: BeliefEngineState = {
    version: 1,
    beliefs: {
      b1: {
        id: "b1",
        key: "default:ui,theme:preference",
        hypothesis_ids: ["h1"],
        winner_id: "h1",
        state: BeliefState.Resolved,
        score: 1.2,
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        stability: 2,
        volatility: 0,
        last_updated: nowSecs()
      },
      b2: {
        id: "b2",
        key: "default:ui,theme:preference",
        hypothesis_ids: ["h2"],
        winner_id: "h2",
        state: BeliefState.Singleton,
        score: 1.0,
        confidence: 0.9,
        support_mass: 8,
        conflict_mass: 0,
        stability: 2,
        volatility: 0,
        last_updated: nowSecs()
      }
    },
    hypotheses: {
      h1: {
        id: "h1",
        belief_id: "b1",
        prototype_record_ids: ["r1", "r2"],
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.2
      },
      h2: {
        id: "h2",
        belief_id: "b2",
        prototype_record_ids: ["r3"],
        confidence: 0.9,
        support_mass: 8,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.0
      }
    },
    record_to_belief: { r1: "b1", r2: "b1", r3: "b2" }
  }

  const records = new Map<string, AuraRecord>([
    ["r1", makeRecord("r1", "dark mode is great for coding at night", ["ui", "theme"], "preference")],
    ["r2", makeRecord("r2", "dark mode helps reduce eye strain while coding", ["ui", "theme"], "preference")],
    ["r3", makeRecord("r3", "dark mode is my preference for development work", ["ui", "theme"], "preference")]
  ])
  const sdr: SdrLookup = new Map([
    ["r1", [1, 2, 3, 4, 5]],
    ["r2", [2, 3, 4, 5, 6]],
    ["r3", [1, 3, 5, 7, 9]]
  ])

  const report = await Effect.runPromise(
    concept.discover(fakeBeliefEngine(state), records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )
  assert.strictEqual(report.seeds_found, 2)
  assert.ok(report.candidates_found >= 1)

  const stats = await Effect.runPromise(concept.stats())
  for (const c of Object.values(stats.concepts)) {
    assert.ok(c.belief_ids.length > 0)
    assert.ok(c.record_ids.length > 0)
    for (const bid of c.belief_ids) assert.ok(state.beliefs[bid] !== undefined)
    for (const rid of c.record_ids) assert.ok(records.has(rid))
  }
})

it("ConceptEngine: stable across replay (same inputs -> same report metrics)", async () => {
  const state: BeliefEngineState = {
    version: 1,
    beliefs: {
      b1: {
        id: "b1",
        key: "default:ui,theme:preference",
        hypothesis_ids: ["h1"],
        winner_id: "h1",
        state: BeliefState.Resolved,
        score: 1.2,
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        stability: 2,
        volatility: 0,
        last_updated: nowSecs()
      },
      b2: {
        id: "b2",
        key: "default:ui,theme:preference",
        hypothesis_ids: ["h2"],
        winner_id: "h2",
        state: BeliefState.Singleton,
        score: 1.0,
        confidence: 0.9,
        support_mass: 8,
        conflict_mass: 0,
        stability: 2,
        volatility: 0,
        last_updated: nowSecs()
      }
    },
    hypotheses: {
      h1: {
        id: "h1",
        belief_id: "b1",
        prototype_record_ids: ["r1", "r2"],
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.2
      },
      h2: {
        id: "h2",
        belief_id: "b2",
        prototype_record_ids: ["r3"],
        confidence: 0.9,
        support_mass: 8,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.0
      }
    },
    record_to_belief: { r1: "b1", r2: "b1", r3: "b2" }
  }
  const records = new Map<string, AuraRecord>([
    ["r1", makeRecord("r1", "dark mode is great for coding at night", ["ui", "theme"], "preference")],
    ["r2", makeRecord("r2", "dark mode helps reduce eye strain while coding", ["ui", "theme"], "preference")],
    ["r3", makeRecord("r3", "dark mode is my preference for development work", ["ui", "theme"], "preference")]
  ])
  const sdr: SdrLookup = new Map([
    ["r1", [1, 2, 3, 4, 5]],
    ["r2", [2, 3, 4, 5, 6]],
    ["r3", [1, 3, 5, 7, 9]]
  ])

  const c1 = new ConceptEngineImpl()
  const r1 = await Effect.runPromise(
    c1.discover(fakeBeliefEngine(state), records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )

  const c2 = new ConceptEngineImpl()
  const r2 = await Effect.runPromise(
    c2.discover(fakeBeliefEngine(state), records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )

  assert.strictEqual(r1.candidates_found, r2.candidates_found)
  assert.strictEqual(r1.stable_count, r2.stable_count)
  assert.strictEqual(r1.rejected_count, r2.rejected_count)
  assert.ok(Math.abs(r1.avg_abstraction_score - r2.avg_abstraction_score) < 1e-6)
})
