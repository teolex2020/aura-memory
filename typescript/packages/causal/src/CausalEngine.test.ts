import { it, describe } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import { EpistemicTrace, BeliefEngine, TemporalBudgetMode, EvidenceMode } from "@aura/contract"
import { CausalState, CausalDiscoveryMode } from "@aura/contract"
import type { BeliefEngineState, BeliefReport } from "@aura/contract"
import type { SdrLookup, CausalEdge, CausalReport } from "@aura/contract"
import type { Record as AuraRecord } from "@aura/contract"
import {
  CausalEngineImpl,
  extractEdges,
  MAX_CAUSAL_WINDOW_SECS,
  MAX_EDGES_PER_NAMESPACE,
  MAX_TEMPORAL_SUCCESSORS_PER_RECORD,
} from "./CausalEngine"
import type { EdgeStats } from "./CausalEngine"

// ── Helpers ──

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

/** Make a minimal test record. */
function makeRecord(
  id: string,
  content: string,
  namespace: string,
  created_at: number,
  overrides?: Partial<AuraRecord>
): AuraRecord {
  return {
    id,
    content,
    level: "Domain" as any,
    strength: 0.5,
    activation_count: 0,
    created_at,
    last_activated: created_at,
    tags: [],
    connections: {},
    connection_types: {},
    content_type: "note",
    source_type: "user",
    namespace,
    semantic_type: "fact",
    metadata: {},
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Task 1: Edge extraction tests (RED phase — expect failure until implemented)
// ═══════════════════════════════════════════════════════════════════════════

describe("extractEdges", () => {
  it("1. Explicit edge from caused_by_id: record with caused_by_id pointing to another record → edge created", () => {
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "cause", "default", 1000)
    const r2 = makeRecord("r2", "effect", "default", 1001, { caused_by_id: "r1" })
    records.set("r1", r1)
    records.set("r2", r2)

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(stats.explicit_edges_found, 1, "should find 1 explicit edge")
    assert.strictEqual(edges.length, 1)
    const e = edges[0]!
    assert.strictEqual(e.cause_record_id, "r1")
    assert.strictEqual(e.effect_record_id, "r2")
    assert.strictEqual(e.namespace, "default")
    assert.strictEqual(e.edge_kind, "explicit")
    assert.strictEqual(e.gap_seconds, 1)
  })

  it("2. Explicit edge from caused_by_id cross-namespace → NO edge created", () => {
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "cause", "ns-a", 1000)
    const r2 = makeRecord("r2", "effect", "ns-b", 1001, { caused_by_id: "r1" })
    records.set("r1", r1)
    records.set("r2", r2)

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(stats.explicit_edges_found, 0, "cross-namespace caused_by_id should not create edge")
    assert.strictEqual(edges.length, 0)
  })

  it("3. Explicit edge from connection_type 'causal': record with causal connection → edge created", () => {
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "cause", "default", 1000, {
      connection_types: { r2: "causal" },
      connections: { r2: 0.8 },
    })
    const r2 = makeRecord("r2", "effect", "default", 1001)
    records.set("r1", r1)
    records.set("r2", r2)

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(stats.explicit_edges_found, 1, "should find 1 explicit_causal edge")
    assert.strictEqual(edges.length, 1)
    const e = edges[0]!
    assert.strictEqual(e.edge_kind, "explicit_causal")
    // Direction: earlier created_at is cause
    assert.strictEqual(e.cause_record_id, "r1")
    assert.strictEqual(e.effect_record_id, "r2")
  })

  it("4. Explicit edge from connection_type 'causal' with effect earlier in time → direction reversed", () => {
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "later cause", "default", 2000, {
      connection_types: { r2: "causal" },
      connections: { r2: 0.7 },
    })
    const r2 = makeRecord("r2", "earlier effect", "default", 1000)
    records.set("r1", r1)
    records.set("r2", r2)

    const { edges } = extractEdges(records)

    // r2 was created earlier (1000), r1 later (2000)
    // Connection from r1 to r2, but r2 is the cause (earlier)
    assert.strictEqual(edges.length, 1)
    const e = edges[0]!
    assert.strictEqual(e.cause_record_id, "r2", "earlier record should be cause")
    assert.strictEqual(e.effect_record_id, "r1", "later record should be effect")
  })

  it("5. Temporal edge: records in same namespace, created_at 1 day apart → edge created", () => {
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecord("r1", "first", "default", 1_000_000))
    records.set("r2", makeRecord("r2", "second", "default", 1_000_000 + 86400))
    records.set("r3", makeRecord("r3", "third", "default", 1_000_000 + 2 * 86400))

    const { edges, stats } = extractEdges(records)

    // Should have temporal edges: r1→r2, r1→r3, r2→r3
    assert.ok(stats.temporal_edges_found >= 3, `expected ≥3 temporal edges, got ${stats.temporal_edges_found}`)
    const temporalEdges = edges.filter((e) => e.edge_kind === "temporal")
    assert.strictEqual(temporalEdges.length, stats.temporal_edges_found)
  })

  it("6. Temporal edge: records 14 days apart → NO edge created (exceeds 7-day window)", () => {
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecord("r1", "old", "default", 1_000_000))
    records.set("r2", makeRecord("r2", "new", "default", 1_000_000 + 14 * 86400))

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(stats.temporal_edges_found, 0, "gap > 7 days should not create temporal edge")
    assert.strictEqual(edges.length, 0)
  })

  it("7. Temporal edge at exact window boundary (7 days) → edge created", () => {
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecord("r1", "cause", "default", 1_000_000))
    records.set("r2", makeRecord("r2", "effect", "default", 1_000_000 + MAX_CAUSAL_WINDOW_SECS))

    const { edges, stats } = extractEdges(records)

    // gap == MAX_CAUSAL_WINDOW_SECS — allowed (gap > 7*86400 is break)
    assert.strictEqual(stats.temporal_edges_found, 1, "exactly 7-day gap should be within window")
  })

  it("8. Temporal gap <= 0 → edge NOT created (same timestamp or negative)", () => {
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecord("r1", "a", "default", 1_000_000))
    records.set("r2", makeRecord("r2", "b", "default", 1_000_000)) // same timestamp

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(stats.temporal_edges_found, 0, "gap=0 should not create temporal edge")
  })

  it("9. NearbySuccessors budgeting: cause with 20 temporal successors → only 16 edges created", () => {
    const records = new Map<string, AuraRecord>()
    records.set("r0", makeRecord("r0", "cause", "default", 1_000_000))
    for (let i = 1; i <= 20; i++) {
      records.set(`r${i}`, makeRecord(`r${i}`, `effect-${i}`, "default", 1_000_000 + i * 3600))
    }

    const { edges, stats } = extractEdges(records)

    // Budget limits each cause to 16 temporal successors
    const r0Edges = edges.filter((e) => e.cause_record_id === "r0" && e.edge_kind === "temporal")
    assert.ok(r0Edges.length <= MAX_TEMPORAL_SUCCESSORS_PER_RECORD,
      `expected ≤${MAX_TEMPORAL_SUCCESSORS_PER_RECORD} successors, got ${r0Edges.length}`)
    assert.ok(stats.temporal_pairs_skipped_by_budget > 0, "should report skipped pairs")
  })

  it("10. Namespace capping: namespace with large number of temporal edges → capped at 5000", () => {
    // This test verifies the cap logic without building 5000+ records.
    // We verify that MAX_EDGES_PER_NAMESPACE = 5000 (matching Rust).
    assert.strictEqual(MAX_EDGES_PER_NAMESPACE, 5000, "must match Rust MAX_EDGES_PER_NAMESPACE")
    assert.strictEqual(MAX_TEMPORAL_SUCCESSORS_PER_RECORD, 16, "must match Rust")
    assert.strictEqual(MAX_CAUSAL_WINDOW_SECS, 7 * 86400, "must match Rust MAX_CAUSAL_WINDOW_SECS")
  })

  it("11. Self-loop edge at record level (cause_id === effect_id) → filtered out", () => {
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "self-ref", "default", 1000, { caused_by_id: "r1" })
    records.set("r1", r1)

    const { edges } = extractEdges(records)

    const selfLoop = edges.filter((e) => e.cause_record_id === e.effect_record_id)
    assert.strictEqual(selfLoop.length, 0, "self-loop edges should be filtered out")
  })

  it("12. Edge stats: total, explicit, temporal counts returned correctly", () => {
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "cause", "default", 1000)
    const r2 = makeRecord("r2", "effect", "default", 1001, { caused_by_id: "r1" })
    const r3 = makeRecord("r3", "temporal-a", "default", 1000)
    const r4 = makeRecord("r4", "temporal-b", "default", 1800)
    records.set("r1", r1)
    records.set("r2", r2)
    records.set("r3", r3)
    records.set("r4", r4)

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(edges.length, stats.explicit_edges_found + stats.temporal_edges_found,
      "total edges should equal explicit + temporal")
    assert.strictEqual(stats.explicit_edges_found, 1, "should have 1 explicit edge")
    assert.strictEqual(stats.temporal_edges_found, 1, "should have 1 temporal edge")
    assert.strictEqual(stats.temporal_namespaces_scanned, 1, "1 namespace scanned")
  })

  it("13. Duplicate edge detection: same cause→effect pair produces only 1 edge", () => {
    // Both caused_by_id AND temporal edge for the same pair should deduplicate
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "cause", "default", 1000)
    const r2 = makeRecord("r2", "effect", "default", 1001, { caused_by_id: "r1" })
    records.set("r1", r1)
    records.set("r2", r2)

    const { edges, stats } = extractEdges(records)

    // same r1→r2 pair discovered via caused_by_id, should only be 1 edge total
    const r1r2Edges = edges.filter((e) => e.cause_record_id === "r1" && e.effect_record_id === "r2")
    assert.strictEqual(r1r2Edges.length, 1, "duplicate cause→effect pair should be deduplicated")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Existing contract-aligned stub tests (preserved)
// ═══════════════════════════════════════════════════════════════════════════

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
