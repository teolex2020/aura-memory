import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace, CausalEngine, BeliefEngine, ConceptEngine } from "@aura/contract"
import { CausalState, CausalDiscoveryMode, TemporalBudgetMode, EvidenceMode } from "@aura/contract"
import type {
  CausalEngineState,
  CausalPattern,
  BeliefEngineState,
  BeliefReport,
  SdrLookup,
  ConceptEngineState,
} from "@aura/contract"
import { PolicyEngineImpl } from "./PolicyEngine"

const NoopTrace = {
  event: (): Effect.Effect<void> => Effect.void,
  span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => effect
}

// ── Default pattern factory ──
function makePattern(overrides: Partial<CausalPattern> & { id: string }): CausalPattern {
  return {
    cause_belief_id: "b-cause",
    effect_belief_id: "b-effect",
    cause_key: "test:cause:effect:hash",
    effect_key: "test:effect",
    edge_hash: "abc123",
    support: 3,
    confidence: 0.8,
    lift: 1.5,
    state: CausalState.Stable,
    last_updated: 1000,
    transition_lift: 0.8,
    temporal_consistency: 0.7,
    outcome_stability: 0.6,
    causal_strength: 0.75,
    support_count: 3,
    explicit_support_count: 1,
    temporal_support_count: 2,
    counterevidence_count: 0,
    temporal_windows: 2,
    explicit_support_total_for_cause: 1,
    explicit_effect_variants_for_cause: 1,
    effect_record_signature_variants: 1,
    positive_effect_signals: 1,
    negative_effect_signals: 0,
    namespace: "test",
    cause_record_ids: ["r-cause-1", "r-cause-2"],
    effect_record_ids: ["r-effect-1"],
    ...overrides,
  }
}

// ── Mock causal engine with configurable patterns ──
function mockCausalEngine(patterns: CausalPattern[] = [], evidenceMode: EvidenceMode = EvidenceMode.StrictRepeatedWindows): CausalEngine.Interface {
  const patternMap: Record<string, CausalPattern> = {}
  for (const p of patterns) {
    patternMap[p.id] = p
  }
  return {
    discover: (_be: BeliefEngine.Interface, _records: ReadonlyMap<string, any>, _sdr: SdrLookup) => Effect.succeed({} as any),
    invalidate_pattern: (_id: string) => Effect.void,
    retract_pattern: (_id: string) => Effect.void,
    stats: () => Effect.succeed({
      version: 1 as const,
      patterns: patternMap,
      discovery_mode: CausalDiscoveryMode.Standard,
      edges_found_total: 0,
      temporal_budget_mode: TemporalBudgetMode.ExhaustiveCapped,
      evidence_mode: evidenceMode,
      last_corpus_fingerprint: "",
    } as CausalEngineState)
  }
}

// ── Mock concept engine ──
function mockConceptEngine(): ConceptEngine.Interface {
  return {
    with_seed_mode: (_mode: any) => Effect.void,
    discover: (_be: BeliefEngine.Interface, _records: ReadonlyMap<string, any>, _sdr: SdrLookup) => Effect.succeed({} as any),
    stable_concepts: () => Effect.succeed([] as readonly string[]),
    active_candidates: () => Effect.succeed([] as readonly string[]),
    stats: () => Effect.succeed({
      version: 1 as const,
      concepts: {},
      key_index: {},
      seed_mode: "Standard",
      similarity_mode: "SdrTanimoto",
      partition_mode: "Standard",
      union_mode: "Standard",
    } as ConceptEngineState)
  }
}

// ── Mock belief engine with configurable belief states ──
function mockBeliefEngine(beliefs: Record<string, { state: string; confidence: number }> = {}): BeliefEngine.Interface {
  const beliefMap: Record<string, any> = {}
  for (const [id, b] of Object.entries(beliefs)) {
    beliefMap[id] = { id, state: b.state, confidence: b.confidence }
  }
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
    stats: () => Effect.succeed({
      version: 1 as const,
      beliefs: beliefMap,
      hypotheses: {},
      record_to_belief: {},
      key_index: {},
      record_index: {},
    } as BeliefEngineState)
  }
}

function runWithClock<R>(effect: Effect.Effect<R, never, EpistemicTrace>): Promise<R> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(EpistemicTrace, NoopTrace)
    )
  )
}

// ── Test records ──
function makeRecords(): Map<string, any> {
  const rec = (id: string, tags: string[], content: string) => ({
    id, namespace: "test", tags, semantic_type: "observation", content, strength: 0.9,
    confidence: 0.85, level: 1, activation_count: 5, created_at: 1000, last_activated: 2000,
    connections: {}, connection_types: {}, content_type: "text", source_type: "input", metadata: {}
  })
  return new Map([
    ["r-cause-1", rec("r-cause-1", ["deploy"], "deployed service")],
    ["r-cause-2", rec("r-cause-2", ["deploy"], "deployed service v2")],
    ["r-effect-1", rec("r-effect-1", ["success"], "system healthy after deployment")],
  ])
}

// ═══════════════════════════════════════════════════════════════════════════
// Task 1 RED Tests: 3-engine discover + seed selection (6 conditions) + provenance
// These tests MUST FAIL against the current stub implementation.
// ═══════════════════════════════════════════════════════════════════════════

describe("PolicyEngine P1 — Seed Selection", () => {
  it("discover accepts 3 engine Interface types (CausalEngine.Interface, ConceptEngine.Interface, BeliefEngine.Interface)", async () => {
    const engine = new PolicyEngineImpl()
    const cEng = mockCausalEngine()
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, new Map()))
    // Should compile and run without type errors — report structure present
    assert.strictEqual(typeof report.seeds_found, "number")
    assert.strictEqual(typeof report.hints_found, "number")
  })

  it("seed selection: Stable pattern passes all gates -> seeds_found = 1", async () => {
    const engine = new PolicyEngineImpl()
    const stablePattern = makePattern({ id: "cp-stable", state: CausalState.Stable, causal_strength: 0.80, support_count: 3 })
    const cEng = mockCausalEngine([stablePattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    // RED: stub returns 0; after implementation should return 1
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: Candidate with causal_strength >= 0.65 passes strength gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-cs", state: CausalState.Candidate, causal_strength: 0.70, support_count: 3 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: Candidate with causal_strength < 0.65 fails strength gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-cw", state: CausalState.Candidate, causal_strength: 0.60, support_count: 3 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: support_count >= 2 passes support gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-s2", state: CausalState.Stable, support_count: 2, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: support_count = 1 fails support gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-s1", state: CausalState.Stable, support_count: 1, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: counterevidence > support/2 fails counterevidence gate", async () => {
    const engine = new PolicyEngineImpl()
    // counterevidence 3 > support_count 3 / 2 = 1.5
    const pattern = makePattern({ id: "cp-ce", state: CausalState.Stable, support_count: 3, counterevidence_count: 3, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: no Resolved/Singleton cause belief fails belief gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-nb", state: CausalState.Stable, support_count: 3, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({}) // No beliefs

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: Unresolved cause belief fails belief gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-ub", state: CausalState.Stable, support_count: 3, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Unresolved", confidence: 0.50 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: Multiple patterns, mixed gates -> correct count (2 of 4 pass)", async () => {
    const engine = new PolicyEngineImpl()
    const patterns = [
      makePattern({ id: "cp-good-1", state: CausalState.Stable, causal_strength: 0.85, support_count: 4 }),
      makePattern({ id: "cp-good-2", state: CausalState.Candidate, causal_strength: 0.70, support_count: 3 }),
      makePattern({ id: "cp-weak", state: CausalState.Candidate, causal_strength: 0.55, support_count: 3 }),
      makePattern({ id: "cp-low-sup", state: CausalState.Stable, causal_strength: 0.80, support_count: 1 }),
    ]
    const cEng = mockCausalEngine(patterns)
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    // cp-good-1 (Stable) + cp-good-2 (Candidate >= 0.65) pass
    // cp-weak (Candidate < 0.65) + cp-low-sup (support < 2) fail
    assert.strictEqual(report.seeds_found, 2)
  })

  it("seed selection: ExplicitTrusted bypass with explicit_support >= 1 allows weak Candidate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-et",
      state: CausalState.Candidate,
      causal_strength: 0.50,  // Below 0.65 threshold
      support_count: 3,
      explicit_support_count: 2,
    })
    const cEng = mockCausalEngine([pattern], EvidenceMode.ExplicitTrusted)
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: Rejected pattern fails even with ExplicitTrusted", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-rej",
      state: CausalState.Rejected,
      causal_strength: 0.50,
      support_count: 3,
      explicit_support_count: 2,
    })
    const cEng = mockCausalEngine([pattern], EvidenceMode.ExplicitTrusted)
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed: Stable pattern with all gates passing -> seeds_found = 1 (provenance validation)", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-prov",
      state: CausalState.Stable,
      causal_strength: 0.85,
      support_count: 3,
      cause_record_ids: ["r-cause-1", "r-cause-2", "r-cause-3"],
      effect_record_ids: ["r-effect-1", "r-effect-2"],
    })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    // Provenance validated indirectly: seeds_found = 1 means the pattern passed all
    // gates including belief gate (which requires cause_belief_id lookup)
    assert.strictEqual(report.seeds_found, 1)
  })

  it("discover: empty causal state -> seeds_found = 0, hints_found = 0", async () => {
    const engine = new PolicyEngineImpl()
    const cEng = mockCausalEngine([])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, new Map()))
    assert.strictEqual(report.seeds_found, 0)
    assert.strictEqual(report.hints_found, 0)
  })

  it("seed selection: Singleton belief state passes belief gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-sing", state: CausalState.Stable, causal_strength: 0.80, support_count: 3 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Singleton", confidence: 0.90 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: low temporal_windows + no explicit -> fails evidence gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-lev",
      state: CausalState.Stable,
      causal_strength: 0.80,
      support_count: 3,
      explicit_support_count: 0,
      temporal_windows: 1,  // below MIN_SUPPORT=2
    })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Existing tests — should continue to pass with updated engine API
// ═══════════════════════════════════════════════════════════════════════════

describe("PolicyEngine (contract-aligned)", () => {
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
    const state = await Effect.runPromise(engine.stats())
    ;(state as any).hints["ph-test"] = {
      id: "ph-test", pattern_id: "cp-1", condition: "test", action: "test",
      priority: 5, confidence: 0.8, state: "Stable", last_updated: 1000,
      actionKind: "prefer", policyStrength: 0.8, riskScore: 0.2,
      namespace: "test", domain: "test", polarity: "Positive",
      recommendation: "Consider this pattern", utilityScore: 0.7,
      cause_key: "k1", effect_keys: ["k2"]
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
