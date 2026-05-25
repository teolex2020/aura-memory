import * as fs from "node:fs"
import * as path from "node:path"
import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  BeliefState,
  EpistemicTrace,
  Level,
  type BeliefReport,
  type EpistemicTraceImpl,
  type Record as AuraRecord
} from "@aura/contract"
import { BeliefEngineImpl } from "./BeliefEngine"

const NoopTrace: EpistemicTraceImpl = {
  event: () => Effect.void,
  span: (_name, _fields, eff) => eff
}

it("BeliefEngine.update builds belief report for epistemic_belief_v1 fixture", async () => {
  const fixtureDir = path.join(process.cwd(), "test/fixtures/epistemic_belief_v1")
  const recordsJson = fs.readFileSync(path.join(fixtureDir, "records.json"), "utf8")
  const expectedJson = fs.readFileSync(path.join(fixtureDir, "expected.json"), "utf8")

  const recordsObj = JSON.parse(recordsJson) as Record<string, AuraRecord>
  const expected = JSON.parse(expectedJson) as BeliefReport

  const records = new Map(Object.entries(recordsObj))
  const engine = new BeliefEngineImpl()

  const report = await Effect.runPromise(engine.update(records).pipe(Effect.provideService(EpistemicTrace, NoopTrace)))
  assert.deepStrictEqual(report, expected)
})

it("BeliefEngine.update_with_sdr resolves singleton", async () => {
  const engine = new BeliefEngineImpl()
  const records = new Map<string, AuraRecord>([
    [
      "r1",
      {
        id: "r1",
        content: "user uses vim keybindings always",
        level: Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: Date.now() / 1000,
        last_activated: 0,
        tags: ["editor", "preferences"],
        connections: {},
        content_type: "text/plain",
        source_type: "recorded",
        namespace: "default",
        semantic_type: "preference",
        metadata: {},
        aura_id: null,
        caused_by_id: null,
        confidence: 0.9,
        support_mass: 1,
        conflict_mass: 0
      }
    ]
  ])

  await Effect.runPromise(
    engine.update_with_sdr(records, new Map()).pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )
  const state = await Effect.runPromise(engine.stats())
  const beliefs = Object.values(state.beliefs)
  assert.strictEqual(beliefs.length, 1)
  assert.strictEqual(beliefs[0]!.state, BeliefState.Singleton)
  assert.ok(beliefs[0]!.winner_id !== null)
})

it("BeliefEngine.update_with_sdr resolves competing hypotheses", async () => {
  const engine = new BeliefEngineImpl()
  const records = new Map<string, AuraRecord>([
    [
      "r1",
      {
        id: "r1",
        content: "user prefers dark mode absolutely",
        level: Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: Date.now() / 1000,
        last_activated: 0,
        tags: ["ui", "theme"],
        connections: {},
        content_type: "text/plain",
        source_type: "recorded",
        namespace: "default",
        semantic_type: "preference",
        metadata: {},
        aura_id: null,
        caused_by_id: null,
        confidence: 0.95,
        support_mass: 10,
        conflict_mass: 0
      }
    ],
    [
      "r2",
      {
        id: "r2",
        content: "user sometimes uses light mode",
        level: Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: Date.now() / 1000,
        last_activated: 0,
        tags: ["ui", "theme"],
        connections: {},
        content_type: "text/plain",
        source_type: "recorded",
        namespace: "default",
        semantic_type: "preference",
        metadata: {},
        aura_id: null,
        caused_by_id: null,
        confidence: 0.5,
        support_mass: 1,
        conflict_mass: 0
      }
    ]
  ])

  const sdr = new Map<string, ReadonlyArray<number>>([
    ["r1", [1, 2, 3]],
    ["r2", [100, 200, 300]]
  ])

  await Effect.runPromise(engine.update_with_sdr(records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace)))
  const state = await Effect.runPromise(engine.stats())
  const beliefs = Object.values(state.beliefs)
  assert.strictEqual(beliefs.length, 1)
  assert.strictEqual(beliefs[0]!.state, BeliefState.Resolved)
  assert.ok(beliefs[0]!.winner_id !== null)
  const winner = state.hypotheses[beliefs[0]!.winner_id!]
  assert.ok(winner !== undefined)
  assert.ok(winner!.support_mass >= 10)
})
