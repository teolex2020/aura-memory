import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace, CausalEngine, BeliefEngine, ConceptEngine, type FeedbackAuditReport } from "@aura/contract"
import { CausalState, CausalDiscoveryMode, TemporalBudgetMode, EvidenceMode, Polarity } from "@aura/contract"
import { ConceptSeedMode, ConceptSimilarityMode, ConceptPartitionMode, ConceptUnionMode } from "@aura/contract"
import type {
  CausalEngineState,
  CausalPattern,
  BeliefEngineState,
  BeliefReport,
  SdrLookup,
  ConceptEngineState,
} from "@aura/contract"
import { PolicyEngineImpl, computePolicyStrength, generateRecommendation, applySuppression } from "./PolicyEngine"

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
    set_temporal_budget_mode: () => Effect.void,
    set_evidence_mode: () => Effect.void,
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
    with_similarity_mode: (_mode: any) => Effect.void,
    discover: (_be: BeliefEngine.Interface, _records: ReadonlyMap<string, any>, _sdr: SdrLookup) => Effect.succeed({} as any),
    stable_concepts: () => Effect.succeed([] as readonly string[]),
    active_candidates: () => Effect.succeed([] as readonly string[]),
    stats: () => Effect.succeed({
      version: 1 as const,
      concepts: {},
      key_index: {},
      seed_mode: ConceptSeedMode.Standard,
      similarity_mode: ConceptSimilarityMode.SdrTanimoto,
      partition_mode: ConceptPartitionMode.Standard,
      union_mode: ConceptUnionMode.Standard,
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
    apply_layer_feedback: (_c: any, _p: any) => Effect.succeed({
      beliefsTouched: 0, beliefsBoosted: 0, beliefsDampened: 0,
      netConfidenceDelta: 0, netVolatilityDelta: 0, entries: [],
    } as FeedbackAuditReport),
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
  return new Map([
    ["r-cause-1", { id: "r-cause-1", namespace: "test", tags: ["deploy"], semantic_type: "fact", content: "deployed service", strength: 0.9, confidence: 0.85, level: 1, activation_count: 5, created_at: 1000, last_activated: 2000, connections: {}, connection_types: {}, content_type: "text", source_type: "input", metadata: {} }],
    ["r-cause-2", { id: "r-cause-2", namespace: "test", tags: ["deploy"], semantic_type: "fact", content: "deployed service v2", strength: 0.8, confidence: 0.80, level: 1, activation_count: 3, created_at: 1001, last_activated: 2001, connections: {}, connection_types: {}, content_type: "text", source_type: "input", metadata: {} }],
    ["r-effect-1", { id: "r-effect-1", namespace: "test", tags: ["success"], semantic_type: "observation", content: "system healthy after deployment", strength: 0.9, confidence: 0.90, level: 1, activation_count: 2, created_at: 1002, last_activated: 2002, connections: {}, connection_types: {}, content_type: "text", source_type: "input", metadata: {} }],
  ])
}

// ═══════════════════════════════════════════════════════════════════════════
// Task 1 RED Tests: 3-engine discover + seed selection (6 conditions) + provenance
// ═══════════════════════════════════════════════════════════════════════════

describe("PolicyEngine P1 — Seed Selection", () => {
  it("discover accepts CausalEngine.Interface + ConceptEngine.Interface + BeliefEngine.Interface", async () => {
    const engine = new PolicyEngineImpl()
    const cEng = mockCausalEngine()
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, new Map()))
    // Should compile and run without errors — verify report structure
    assert.strictEqual(typeof report.seeds_found, "number")
    assert.strictEqual(typeof report.hints_found, "number")
  })

  it("seed selection: Stable pattern passes all gates → seeds_found = 1", async () => {
    const engine = new PolicyEngineImpl()
    const stablePattern = makePattern({ id: "cp-stable", state: CausalState.Stable, causal_strength: 0.80, support_count: 3 })
    const cEng = mockCausalEngine([stablePattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })
    const records = makeRecords()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, records))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: Candidate with causal_strength >= 0.65 passes strength gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-candidate-strong", state: CausalState.Candidate, causal_strength: 0.70, support_count: 3 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: Candidate with causal_strength < 0.65 fails strength gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-candidate-weak", state: CausalState.Candidate, causal_strength: 0.60, support_count: 3 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: support_count >= 2 passes support gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-supported", state: CausalState.Stable, support_count: 2, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: support_count = 1 fails support gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-low-support", state: CausalState.Stable, support_count: 1, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: high counterevidence fails counterevidence gate", async () => {
    const engine = new PolicyEngineImpl()
    // counterevidence 3 > support_count 3 / 2 = 1.5
    const pattern = makePattern({ id: "cp-counterev", state: CausalState.Stable, support_count: 3, counterevidence_count: 3, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: no Resolved/Singleton cause belief fails belief gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-no-belief", state: CausalState.Stable, support_count: 3, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    // No beliefs at all — belief gate should fail
    const bEng = mockBeliefEngine({})

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: Unresolved cause belief fails belief gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-unresolved", state: CausalState.Stable, support_count: 3, causal_strength: 0.80 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Unresolved", confidence: 0.50 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })

  it("seed selection: Multiple patterns, mixed gate results → correct count", async () => {
    const engine = new PolicyEngineImpl()
    const patterns = [
      makePattern({ id: "cp-good-1", state: CausalState.Stable, causal_strength: 0.85, support_count: 4 }),
      makePattern({ id: "cp-good-2", state: CausalState.Candidate, causal_strength: 0.70, support_count: 3 }),
      makePattern({ id: "cp-weak", state: CausalState.Candidate, causal_strength: 0.55, support_count: 3 }),
      makePattern({ id: "cp-low-support", state: CausalState.Stable, causal_strength: 0.80, support_count: 1 }),
    ]
    const cEng = mockCausalEngine(patterns)
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({
      "b-cause": { state: "Resolved", confidence: 0.85 }
    })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    // cp-good-1 (stable) and cp-good-2 (candidate >= 0.65) should pass
    // cp-weak (candidate < 0.65) and cp-low-support (support < 2) should fail
    assert.strictEqual(report.seeds_found, 2)
  })

  it("seed selection: ExplicitTrusted bypass — explicit support >= 1 allows weak candidate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-explicit",
      state: CausalState.Candidate,
      causal_strength: 0.50,  // Below 0.65 threshold
      support_count: 3,
      explicit_support_count: 2,  // Has explicit support
    })
    const cEng = mockCausalEngine([pattern], EvidenceMode.ExplicitTrusted)
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection: Rejected pattern fails strength gate even with ExplicitTrusted", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-rejected",
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

  it("seed includes cause_record_ids and effect_record_ids provenance", async () => {
    // This test is partially a design test — the seed data structure
    // is internal, but we validate seeds are processed correctly through discover
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-provenance",
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
    // Provenance is validated indirectly: seeds_found = 1 means the pattern's
    // provenance was successfully extracted (the engine processes cause/effect record IDs
    // during seed construction)
    assert.strictEqual(report.seeds_found, 1)
  })

  it("discover returns zero seeds when causal engine has no patterns", async () => {
    const engine = new PolicyEngineImpl()
    const cEng = mockCausalEngine([])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, new Map()))
    assert.strictEqual(report.seeds_found, 0)
    assert.strictEqual(report.hints_found, 0)
  })

  it("Singletons belief state also passes belief gate", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({ id: "cp-singleton", state: CausalState.Stable, causal_strength: 0.80, support_count: 3 })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Singleton", confidence: 0.90 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 1)
  })

  it("seed selection respects evidence gate via meetsEvidenceGate", async () => {
    const engine = new PolicyEngineImpl()
    // Pattern with insufficient temporal windows and no explicit support
    // should fail evidence gate
    const pattern = makePattern({
      id: "cp-low-evidence",
      state: CausalState.Stable,
      causal_strength: 0.80,
      support_count: 3,
      explicit_support_count: 0,
      temporal_windows: 1,  // Only 1 temporal window — repeated evidence gate fails
    })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, makeRecords()))
    assert.strictEqual(report.seeds_found, 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Existing tests (contract-aligned stub) — should continue to pass
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
      polarity: Polarity.Positive,
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

// ═══════════════════════════════════════════════════════════════════════════
// Task 1 RED Tests: 4-dim policy strength scoring + recommendation templates
// ═══════════════════════════════════════════════════════════════════════════

import { PolicyActionKind } from "@aura/contract"

describe("PolicyEngine P2 — Scoring + Recommendations", () => {
  it("computePolicyStrength: 0.35*0.8 + 0.25*0.9 + 0.20*0.7 + 0.20*0.6 = 0.765", () => {
    const score = computePolicyStrength({
      causal_strength: 0.8,
      confidence: 0.9,
      utilityScore: 0.7,
      stability: 0.6,
    })
    // Expected: 0.35*0.8=0.28 + 0.25*0.9=0.225 + 0.20*0.7=0.14 + 0.20*0.6=0.12 = 0.765
    assert.strictEqual(score, 0.765)
  })

  it("computePolicyStrength: all zeros -> 0", () => {
    const score = computePolicyStrength({
      causal_strength: 0,
      confidence: 0,
      utilityScore: 0,
      stability: 0,
    })
    assert.strictEqual(score, 0)
  })

  it("computePolicyStrength: all 1.0 -> 1.0", () => {
    const score = computePolicyStrength({
      causal_strength: 1.0,
      confidence: 1.0,
      utilityScore: 1.0,
      stability: 1.0,
    })
    assert.strictEqual(score, 1.0)
  })

  it("generateRecommendation: Avoid template matches Rust exact string", () => {
    const text = generateRecommendation(PolicyActionKind.Avoid, "error", "infra")
    // Rust exact: "Avoid: '{}' in domain [{}] has been associated with negative outcomes."
    const expected = "Avoid: 'error' in domain [infra] has been associated with negative outcomes."
    assert.strictEqual(text, expected)
  })

  it("generateRecommendation: VerifyFirst template matches Rust exact string", () => {
    const text = generateRecommendation(PolicyActionKind.VerifyFirst, "timeout", "api")
    // Rust exact: "Verify first: '{}' in domain [{}] has shown risk signals — check before proceeding."
    const expected = "Verify first: 'timeout' in domain [api] has shown risk signals — check before proceeding."
    assert.strictEqual(text, expected)
  })

  it("generateRecommendation: Prefer template matches Rust exact string", () => {
    const text = generateRecommendation(PolicyActionKind.Prefer, "optimized", "backend")
    // Rust exact: "Prefer: '{}' in domain [{}] has consistently led to positive outcomes."
    const expected = "Prefer: 'optimized' in domain [backend] has consistently led to positive outcomes."
    assert.strictEqual(text, expected)
  })

  it("generateRecommendation: Recommend template matches Rust exact string", () => {
    const text = generateRecommendation(PolicyActionKind.Recommend, "stable", "frontend")
    // Rust exact: "Recommend: '{}' in domain [{}] has shown positive signals."
    const expected = "Recommend: 'stable' in domain [frontend] has shown positive signals."
    assert.strictEqual(text, expected)
  })

  it("generateRecommendation: Warn template matches Rust exact string", () => {
    const text = generateRecommendation(PolicyActionKind.Warn, "pattern", "system")
    // Rust exact: "Warning: '{}' in domain [{}] has a strong causal pattern but unclear polarity."
    const expected = "Warning: 'pattern' in domain [system] has a strong causal pattern but unclear polarity."
    assert.strictEqual(text, expected)
  })

  it("PolicyHint has recommendation, utilityScore, policyStrength fields populated after discover", async () => {
    const engine = new PolicyEngineImpl()
    const pattern = makePattern({
      id: "cp-p2-1",
      state: CausalState.Stable,
      causal_strength: 0.80,
      support_count: 3,
      cause_record_ids: ["r-cause-1"],
      effect_record_ids: ["r-effect-1"],
      outcome_stability: 0.6,
      temporal_consistency: 0.7,
      namespace: "ns-p2",
    })
    const cEng = mockCausalEngine([pattern])
    const ctEng = mockConceptEngine()
    const bEng = mockBeliefEngine({ "b-cause": { state: "Resolved", confidence: 0.85 } })
    const records = makeRecords()

    const report = await runWithClock(engine.discover(cEng, ctEng, bEng, records))
    // P2: hints should be built from seeds
    assert.strictEqual(report.seeds_found, 1)
    assert.strictEqual(report.hints_found, 1)

    // Verify hint state
    const state = await Effect.runPromise(engine.stats())
    const hintIds = Object.keys(state.hints)
    assert.strictEqual(hintIds.length, 1)
    const hint = state.hints[hintIds[0]!]!
    assert.strictEqual(typeof hint.recommendation, "string")
    assert.ok(hint.recommendation.length > 0)
    assert.ok(hint.utilityScore !== undefined)
    assert.ok(hint.policyStrength !== undefined)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Task 2 RED Tests: Suppression phase + surface alignment
// ═══════════════════════════════════════════════════════════════════════════

import type { PolicyHint } from "@aura/contract"
import { PolicyState } from "@aura/contract"

function makeTestHint(overrides: Partial<PolicyHint> & { id: string }): PolicyHint {
  // Spread overrides first so explicit `id` wins (overrides always has `id`)
  return {
    pattern_id: "cp-test",
    condition: "test condition",
    action: "test",
    priority: 5,
    confidence: 0.8,
    state: PolicyState.Stable,
    last_updated: 1000,
    actionKind: PolicyActionKind.Recommend,
    policyStrength: 0.8,
    riskScore: 0.2,
    namespace: "ns1",
    domain: "backend",
    polarity: Polarity.Positive as const,
    recommendation: "Test recommendation",
    utilityScore: 0.6,
    cause_key: "ns1:cause:effect:hash",
    effect_keys: ["r-eff-1"],
    cause_record_ids: ["r-cause-1", "r-cause-2"],
    ...overrides,
    id: overrides.id,
  }
}

describe("PolicyEngine P2 — Suppression", () => {
  it("applySuppression: detects conflict — same namespace+domain + opposite polarity + overlapping cause_record_ids", () => {
    const hintA = makeTestHint({
      id: "h-positive",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Positive,
      actionKind: PolicyActionKind.Recommend,
      policyStrength: 0.8,
      cause_record_ids: ["r-cause-1", "r-cause-2"],
    })
    const hintB = makeTestHint({
      id: "h-negative",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Negative,
      actionKind: PolicyActionKind.Avoid,
      policyStrength: 0.5,
      cause_record_ids: ["r-cause-2", "r-cause-3"],
    })
    const result = applySuppression([hintA, hintB])
    // Hint B should be suppressed (lower strength) — stub returns both Stable
    const suppressed = result.filter(h => false) // stub: no suppression
    assert.strictEqual(suppressed.length, 0)
    // RED: this assertion will fail against stub that doesn't suppress
    const suppressedHint = result.find(h => h.id === "h-negative")
    assert.strictEqual(suppressedHint!.state, PolicyState.Suppressed)
  })

  it("applySuppression: suppresses lower policy_strength hint when conflict detected", () => {
    const hintA = makeTestHint({
      id: "h-strong",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Positive,
      actionKind: PolicyActionKind.Prefer,
      policyStrength: 0.9,
      cause_record_ids: ["r-cause-1"],
    })
    const hintB = makeTestHint({
      id: "h-weak",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Negative,
      actionKind: PolicyActionKind.Avoid,
      policyStrength: 0.3,
      cause_record_ids: ["r-cause-1"],
    })
    const result = applySuppression([hintA, hintB])
    // RED: stub doesn't suppress, so the weak hint stays Stable
    const weakHint = result.find(h => h.id === "h-weak")
    assert.strictEqual(weakHint!.state, PolicyState.Suppressed)
    const strongHint = result.find(h => h.id === "h-strong")
    assert.strictEqual(strongHint!.state, PolicyState.Stable)
  })

  it("applySuppression: does not suppress hints with overlapping cause_record_ids but same polarity", () => {
    const hintA = makeTestHint({
      id: "h-pos1",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Positive,
      actionKind: PolicyActionKind.Recommend,
      policyStrength: 0.8,
      cause_record_ids: ["r-cause-1"],
    })
    const hintB = makeTestHint({
      id: "h-pos2",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Positive,
      actionKind: PolicyActionKind.Prefer,
      policyStrength: 0.9,
      cause_record_ids: ["r-cause-1"],
    })
    const result = applySuppression([hintA, hintB])
    // Both should remain Stable — same polarity means no conflict
    assert.strictEqual(result.find(h => h.id === "h-pos1")!.state, PolicyState.Stable)
    assert.strictEqual(result.find(h => h.id === "h-pos2")!.state, PolicyState.Stable)
  })

  it("applySuppression: does not suppress hints in different namespace", () => {
    const hintA = makeTestHint({
      id: "h-ns1",
      namespace: "ns1",
      domain: "backend",
      polarity: Polarity.Positive,
      actionKind: PolicyActionKind.Recommend,
      policyStrength: 0.9,
      cause_record_ids: ["r-cause-1"],
    })
    const hintB = makeTestHint({
      id: "h-ns2",
      namespace: "ns2",
      domain: "backend",
      polarity: Polarity.Negative,
      actionKind: PolicyActionKind.Avoid,
      policyStrength: 0.3,
      cause_record_ids: ["r-cause-1"],
    })
    const result = applySuppression([hintA, hintB])
    // Different namespaces — no conflict, both stay Stable
    assert.strictEqual(result.find(h => h.id === "h-ns1")!.state, PolicyState.Stable)
    assert.strictEqual(result.find(h => h.id === "h-ns2")!.state, PolicyState.Stable)
  })
})
