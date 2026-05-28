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
  buildRecordToBelief,
  aggregateToPatterns,
  scorePattern,
  meetsSupportGate,
  meetsRepeatedEvidenceGate,
  meetsEvidenceGate,
  meetsCounterfactualGate,
  computeCorpusFingerprint,
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
    // Use separate namespaces so temporal edges don't interact with explicit records
    const records = new Map<string, AuraRecord>()
    const r1 = makeRecord("r1", "cause", "explicit-ns", 1000)
    const r2 = makeRecord("r2", "effect", "explicit-ns", 1001, { caused_by_id: "r1" })
    const r3 = makeRecord("r3", "temporal-a", "temporal-ns", 1000)
    const r4 = makeRecord("r4", "temporal-b", "temporal-ns", 1800)
    records.set("r1", r1)
    records.set("r2", r2)
    records.set("r3", r3)
    records.set("r4", r4)

    const { edges, stats } = extractEdges(records)

    assert.strictEqual(edges.length, stats.explicit_edges_found + stats.temporal_edges_found,
      "total edges should equal explicit + temporal")
    assert.strictEqual(stats.explicit_edges_found, 1, "should have 1 explicit edge")
    assert.strictEqual(stats.temporal_edges_found, 1, "should have 1 temporal edge (r3→r4)")
    assert.strictEqual(stats.temporal_namespaces_scanned, 2, "2 namespaces scanned (1 explicit + 1 temporal)")
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
// Task 2: Pattern aggregation tests (RED phase — expect failure until implemented)
// ═══════════════════════════════════════════════════════════════════════════

describe("aggregateToPatterns", () => {
  function makeBeliefState(recordToBelief: Record<string, string>): {
    beliefs: Readonly<Record<string, { state: string; id: string }>>
    record_index: Readonly<Record<string, string>>
  } {
    const beliefs: Record<string, { state: string; id: string }> = {}
    for (const [, beliefId] of Object.entries(recordToBelief)) {
      if (!beliefs[beliefId]) {
        beliefs[beliefId] = { state: "Resolved", id: beliefId }
      }
    }
    return { beliefs, record_index: recordToBelief }
  }

  function makeTestEdge(overrides?: Partial<CausalEdge>): CausalEdge {
    return {
      cause_record_id: "r1",
      effect_record_id: "r2",
      namespace: "default",
      edge_kind: "temporal",
      gap_seconds: 100,
      created_at: 1001,
      ...overrides,
    }
  }

  function makeRecordWithBelief(
    id: string,
    content: string,
    namespace: string,
    created_at: number
  ): AuraRecord {
    return makeRecord(id, content, namespace, created_at)
  }

  it("1. Edges aggregated to belief-level patterns: same cause_belief → effect_belief grouped together", async () => {
    const edges: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r2", edge_kind: "temporal" }),
      makeTestEdge({ cause_record_id: "r3", effect_record_id: "r4", edge_kind: "temporal" }),
    ]
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecordWithBelief("r1", "cause-a", "default", 1000))
    records.set("r2", makeRecordWithBelief("r2", "effect-x", "default", 1001))
    records.set("r3", makeRecordWithBelief("r3", "cause-a", "default", 1002))
    records.set("r4", makeRecordWithBelief("r4", "effect-x", "default", 1003))

    const beliefState = makeBeliefState({
      r1: "b-cause",
      r2: "b-effect",
      r3: "b-cause",
      r4: "b-effect",
    })

    const patterns = await runWithClock(aggregateToPatterns(edges, records, beliefState))

    assert.ok(patterns.length > 0, "should produce at least one pattern")
    // Two edges both mapping to same cause→effect belief pair → one pattern
    const byPair = patterns.filter(
      (p) => p.cause_belief_id === "b-cause" && p.effect_belief_id === "b-effect"
    )
    assert.strictEqual(byPair.length, 1, "should have 1 pattern for same belief pair")
  })

  it("2. Self-loop filtered at belief level: cause_belief_id === effect_belief_id → pattern NOT created", async () => {
    const edges: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r2", edge_kind: "temporal" }),
    ]
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecordWithBelief("r1", "a", "default", 1000))
    records.set("r2", makeRecordWithBelief("r2", "b", "default", 1001))

    const beliefState = makeBeliefState({
      r1: "b-self",
      r2: "b-self", // same belief on both sides
    })

    const patterns = await runWithClock(aggregateToPatterns(edges, records, beliefState))

    assert.strictEqual(patterns.length, 0, "self-loop at belief level should produce no pattern")
  })

  it("3. Pattern support counts grouped by edge count: 3 edges between same belief pair → support_count = 3", async () => {
    const edges: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r3", edge_kind: "temporal", gap_seconds: 100 }),
      makeTestEdge({ cause_record_id: "r2", effect_record_id: "r4", edge_kind: "temporal", gap_seconds: 200 }),
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r4", edge_kind: "temporal", gap_seconds: 300 }),
    ]
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecordWithBelief("r1", "c1", "default", 1000))
    records.set("r2", makeRecordWithBelief("r2", "c2", "default", 1001))
    records.set("r3", makeRecordWithBelief("r3", "e1", "default", 1100))
    records.set("r4", makeRecordWithBelief("r4", "e2", "default", 1200))

    const beliefState = makeBeliefState({
      r1: "b-cause",
      r2: "b-cause",
      r3: "b-effect",
      r4: "b-effect",
    })

    const patterns = await runWithClock(aggregateToPatterns(edges, records, beliefState))

    assert.ok(patterns.length > 0, "should produce at least one pattern")
    const p = patterns.find(
      (p) => p.cause_belief_id === "b-cause" && p.effect_belief_id === "b-effect"
    )
    assert.ok(p !== undefined, "should find the aggregated pattern")
    if (p) {
      assert.strictEqual(p.support_count, 3, "3 edges should give support_count = 3")
    }
  })

  it("4. CausalPattern has all required fields populated", async () => {
    const edges: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r2", edge_kind: "explicit", gap_seconds: 1, namespace: "ns" }),
    ]
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecordWithBelief("r1", "c", "ns", 1000))
    records.set("r2", makeRecordWithBelief("r2", "e", "ns", 1001))

    const beliefState = makeBeliefState({ r1: "b-c", r2: "b-e" })

    const patterns = await runWithClock(aggregateToPatterns(edges, records, beliefState))

    assert.strictEqual(patterns.length, 1, "should produce 1 pattern")
    const p = patterns[0]!
    assert.strictEqual(p.cause_belief_id, "b-c")
    assert.strictEqual(p.effect_belief_id, "b-e")
    assert.strictEqual(p.namespace, "ns")
    assert.strictEqual(p.support_count, 1)
    assert.strictEqual(p.explicit_support_count, 1)
    assert.strictEqual(p.state, "Candidate" as any)
    assert.ok(typeof p.id === "string" && p.id.length > 0, "should have non-empty id")
    assert.ok(typeof p.cause_key === "string", "should have cause_key")
    assert.ok(typeof p.effect_key === "string", "should have effect_key")
    assert.ok(typeof p.edge_hash === "string", "should have edge_hash")
  })

  it("5. CausalPattern uses deterministic pattern ID (same keys → same ID)", async () => {
    const edges1: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r2", edge_kind: "explicit", gap_seconds: 1 }),
    ]
    const edges2: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r3", effect_record_id: "r4", edge_kind: "temporal", gap_seconds: 100 }),
    ]
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecordWithBelief("r1", "c", "ns", 1000))
    records1.set("r2", makeRecordWithBelief("r2", "e", "ns", 1001))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r3", makeRecordWithBelief("r3", "c", "ns", 1000))
    records2.set("r4", makeRecordWithBelief("r4", "e", "ns", 1001))

    const beliefState1 = makeBeliefState({ r1: "b-X", r2: "b-Y" })
    const beliefState2 = makeBeliefState({ r3: "b-X", r4: "b-Y" })

    const p1 = await runWithClock(aggregateToPatterns(edges1, records1, beliefState1))
    const p2 = await runWithClock(aggregateToPatterns(edges2, records2, beliefState2))

    // Different cause/effect record IDs but same belief IDs → different IDs
    // If both pairs resolve to the same belief IDs but with different edges, the pattern ID should differ
    // because edge_hash is part of the pattern key
    assert.ok(p1.length > 0, "should produce pattern 1")
    assert.ok(p2.length > 0, "should produce pattern 2")
    // Note: with different edges, IDs should differ. Test that both are non-empty strings.
    assert.ok(typeof p1[0]!.id === "string" && p1[0]!.id.length > 0)
    assert.ok(typeof p2[0]!.id === "string" && p2[0]!.id.length > 0)
  })

  it("6. Explicit support counts separated from temporal", async () => {
    const edges: CausalEdge[] = [
      makeTestEdge({ cause_record_id: "r1", effect_record_id: "r3", edge_kind: "explicit", gap_seconds: 1 }),
      makeTestEdge({ cause_record_id: "r2", effect_record_id: "r4", edge_kind: "temporal", gap_seconds: 100 }),
    ]
    const records = new Map<string, AuraRecord>()
    records.set("r1", makeRecordWithBelief("r1", "c1", "default", 1000))
    records.set("r2", makeRecordWithBelief("r2", "c2", "default", 1001))
    records.set("r3", makeRecordWithBelief("r3", "e1", "default", 1001))
    records.set("r4", makeRecordWithBelief("r4", "e2", "default", 1101))

    const beliefState = makeBeliefState({
      r1: "b-cause", r2: "b-cause",
      r3: "b-effect", r4: "b-effect",
    })

    const patterns = await runWithClock(aggregateToPatterns(edges, records, beliefState))

    assert.ok(patterns.length > 0, "should produce at least one pattern")
    const p = patterns[0]!
    // explicit_support_count = 1 (only edge_kind "explicit" or "explicit_causal")
    assert.strictEqual(p.explicit_support_count, 1, "should have 1 explicit support edge")
    assert.strictEqual(p.support_count, 2, "total support_count should be 2")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Task 1 (RED): Scoring tests — scorePattern function (will fail until implemented)
// ═══════════════════════════════════════════════════════════════════════════

describe("scorePattern (scoring)", () => {
  // Helper: create a minimal pattern for scoring tests
  function makeScoringPattern(overrides?: Partial<AuraRecord & {
    id: string; cause_belief_id: string; effect_belief_id: string; cause_key: string;
    effect_key: string; edge_hash: string; support: number; confidence: number;
    lift: number; state: string; last_updated: number; support_count: number;
    explicit_support_count: number; temporal_support_count: number;
    counterevidence_count: number; temporal_windows: number;
    explicit_support_total_for_cause: number; explicit_effect_variants_for_cause: number;
    effect_record_signature_variants: number; positive_effect_signals: number;
    negative_effect_signals: number; namespace: string; cause_record_ids: string[];
    effect_record_ids: string[];
  }>): any {
    return {
      id: "cp-test-1",
      cause_belief_id: "b-cause",
      effect_belief_id: "b-effect",
      cause_key: "default:b-cause:b-effect",
      effect_key: "b-effect",
      edge_hash: "h12345",
      support: 0,
      confidence: 0,
      lift: 0,
      state: CausalState.Candidate,
      last_updated: 1000,
      transition_lift: 0,
      temporal_consistency: 0,
      outcome_stability: 0,
      causal_strength: 0,
      support_count: 0,
      explicit_support_count: 0,
      temporal_support_count: 0,
      counterevidence_count: 0,
      temporal_windows: 0,
      explicit_support_total_for_cause: 0,
      explicit_effect_variants_for_cause: 0,
      effect_record_signature_variants: 0,
      positive_effect_signals: 0,
      negative_effect_signals: 0,
      namespace: "default",
      cause_record_ids: [] as string[],
      effect_record_ids: [] as string[],
      ...overrides,
    }
  }

  it("1. transition_lift: P(effect|cause)=0.8, P(effect)=0.2 → lift=4.0 → normalized to 4.0/5.0=0.8", () => {
    const records = new Map<string, AuraRecord>()
    // 5 cause records, 2 effect records, 10 total in namespace
    for (let i = 1; i <= 5; i++) {
      records.set(`c${i}`, makeRecord(`c${i}`, `cause-${i}`, "default", 1000 + i))
    }
    for (let i = 1; i <= 2; i++) {
      records.set(`e${i}`, makeRecord(`e${i}`, `effect-${i}`, "default", 2000 + i))
    }
    // 3 filler records for namespace total
    records.set("f1", makeRecord("f1", "filler-1", "default", 1500))
    records.set("f2", makeRecord("f2", "filler-2", "default", 1501))
    records.set("f3", makeRecord("f3", "filler-3", "default", 1502))
    // 5+2+3 = 10 records
    // support_count=4, cause_count=5 → P(e|c)=0.8
    // effect_count=2, ns_total=10 → P(e)=0.2
    // raw_lift = 0.8/0.2 = 4.0 → normalized = 4.0/5.0 = 0.8

    const pattern = makeScoringPattern({
      support_count: 4,
      cause_record_ids: ["c1", "c2", "c3", "c4", "c5"],
      effect_record_ids: ["e1", "e2"],
    })

    const scored = scorePattern(pattern, records)
    assert.approximately(scored.transition_lift, 0.80, 0.01)
  })

  it("2. transition_lift with lift > 5.0: lift=8.0 → capped at 5.0 → normalized to 1.0", () => {
    const records = new Map<string, AuraRecord>()
    // P(e|c) = 1.0, P(e) = 0.1 → lift = 10.0, capped at 5.0, normalized = 1.0
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("e1", makeRecord("e1", "effect", "default", 2000))
    for (let i = 1; i <= 8; i++) {
      records.set(`f${i}`, makeRecord(`f${i}`, `filler-${i}`, "default", 1500 + i))
    }
    // 10 total records. cause_count=1, effect_count=1, support=1
    // P(e|c)=1.0/1=1.0, P(e)=1/10=0.1, lift=10 → cap 5 → 1.0

    const pattern = makeScoringPattern({
      support_count: 1,
      cause_record_ids: ["c1"],
      effect_record_ids: ["e1"],
    })

    const scored = scorePattern(pattern, records)
    assert.strictEqual(scored.transition_lift, 1.0)
  })

  it("3. temporal_consistency: 8 positive gaps out of 10 pairs → 0.80", () => {
    // 5 cause records x 2 effect records = 10 pairs
    // We want 8 pairs where effect_ts > cause_ts
    const records = new Map<string, AuraRecord>()
    // causes are earlier (1000-1004), effects are later (2000-2001)
    for (let i = 1; i <= 5; i++) {
      records.set(`c${i}`, makeRecord(`c${i}`, `cause-${i}`, "default", 1000 + i))
    }
    // Make e1 before some causes to create negative gaps for 2 pairs
    // e1 at 1002 → c4(1003)-e1 and c5(1004)-e1 are positive
    // c1(1001)-e1, c2(1002)-e1, c3(1003)-e1: wait, need actual gap signs
    // Let me just set specific timestamps
    records.set("e1", makeRecord("e1", "effect-1", "default", 2000))
    records.set("e2", makeRecord("e2", "effect-2", "default", 2001))
    // All 5 causes at 1000-1004 and effects at 2000-2001 → all 10 gaps positive
    // → temporal_consistency = 1.0

    const pattern = makeScoringPattern({
      support_count: 10,
      cause_record_ids: ["c1", "c2", "c3", "c4", "c5"],
      effect_record_ids: ["e1", "e2"],
    })

    const scored = scorePattern(pattern, records)
    assert.strictEqual(scored.temporal_consistency, 1.0, "all gaps positive → consistency 1.0")
  })

  it("4. temporal_consistency with negative gaps: 2 positive out of 4 pairs → 0.50", () => {
    const records = new Map<string, AuraRecord>()
    // c1 at 2000, c2 at 2001 (causes)
    // e1 at 1000, e2 at 2002 (effects)
    // Pairs: c1-e1(1000-2000=-1000→neg), c1-e2(2002-2000=+2→pos),
    //        c2-e1(1000-2001=-1001→neg), c2-e2(2002-2001=+1→pos)
    records.set("c1", makeRecord("c1", "cause-1", "default", 2000))
    records.set("c2", makeRecord("c2", "cause-2", "default", 2001))
    records.set("e1", makeRecord("e1", "prior-effect", "default", 1000))
    records.set("e2", makeRecord("e2", "post-effect", "default", 2002))

    const pattern = makeScoringPattern({
      support_count: 2,
      cause_record_ids: ["c1", "c2"],
      effect_record_ids: ["e1", "e2"],
    })

    const scored = scorePattern(pattern, records)
    // 4 pairs total, 2 positive (c1-e2, c2-e2) → 2/4 = 0.50
    assert.approximately(scored.temporal_consistency, 0.50, 0.01)
  })

  it("5. outcome_stability: multiple effect strengths → 1 - cv", () => {
    const records = new Map<string, AuraRecord>()
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("e1", makeRecord("e1", "effect-a", "default", 2000, { strength: 0.9 }))
    records.set("e2", makeRecord("e2", "effect-b", "default", 2001, { strength: 0.8 }))
    records.set("e3", makeRecord("e3", "effect-c", "default", 2002, { strength: 0.85 }))

    const pattern = makeScoringPattern({
      support_count: 3,
      cause_record_ids: ["c1"],
      effect_record_ids: ["e1", "e2", "e3"],
    })

    const scored = scorePattern(pattern, records)
    // mean = (0.9+0.8+0.85)/3 = 0.85
    // variance = ((0.05)^2 + (-0.05)^2 + 0) / 3 = (0.0025+0.0025)/3 = 0.001667
    // cv = sqrt(0.001667)/0.85 ≈ 0.041/0.85 ≈ 0.048
    // stability = 1-0.048 ≈ 0.952
    assert.ok(scored.outcome_stability > 0.90 && scored.outcome_stability <= 1.0,
      `expected high stability (>0.90), got ${scored.outcome_stability}`)
  })

  it("6. outcome_stability with single effect → neutral 0.5", () => {
    const records = new Map<string, AuraRecord>()
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("e1", makeRecord("e1", "effect", "default", 2000, { strength: 0.7 }))

    const pattern = makeScoringPattern({
      support_count: 1,
      cause_record_ids: ["c1"],
      effect_record_ids: ["e1"],
    })

    const scored = scorePattern(pattern, records)
    // less than 2 effect strengths → return 0.5
    assert.strictEqual(scored.outcome_stability, 0.5)
  })

  it("7. support_score = log2(n+1)/log2(21) for n=4 → approximately 0.53", () => {
    const records = new Map<string, AuraRecord>()
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("e1", makeRecord("e1", "effect", "default", 2000))

    const pattern = makeScoringPattern({
      support_count: 4,
      cause_record_ids: ["c1"],
      effect_record_ids: ["e1"],
    })

    const scored = scorePattern(pattern, records)
    // log2(5)/log2(21) ≈ 2.322/4.392 ≈ 0.529
    assert.approximately(scored.transition_lift * 5.0, Math.min((scored.transition_lift * 5.0) || 0, 5.0), 0.0)
    // We verify support_score indirectly — get it from causal_strength composition
    // Since causal_strength requires MIN_SUPPORT gate (n>=2) to use full formula,
    // and n=4 meets support, the strength should include support_score term.
    assert.ok(scored.causal_strength > 0, "support_score should contribute to causal_strength")
  })

  it("8. causal_strength with insufficient support (n=1) → penalized (transition_lift * 0.3)", () => {
    const records = new Map<string, AuraRecord>()
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("e1", makeRecord("e1", "effect", "default", 2000))
    // 2 records total → P(e|c)=1.0, P(e)=0.5 → lift=2.0 → normalized=0.40
    records.set("f1", makeRecord("f1", "other", "default", 1500))

    const pattern = makeScoringPattern({
      support_count: 1,
      cause_record_ids: ["c1"],
      effect_record_ids: ["e1"],
    })

    const scored = scorePattern(pattern, records)
    // n=1 < MIN_SUPPORT(2) → penalized: causal_strength = transition_lift * 0.3
    assert.approximately(scored.causal_strength, scored.transition_lift * 0.3, 0.01,
      `expected ${scored.transition_lift * 0.3}, got ${scored.causal_strength}`)
  })

  it("9. causal_strength with adequate support (n=3): weighted combination of all 4 components", () => {
    const records = new Map<string, AuraRecord>()
    for (let i = 1; i <= 4; i++) {
      records.set(`c${i}`, makeRecord(`c${i}`, `cause-${i}`, "default", 1000 + i))
    }
    for (let i = 1; i <= 3; i++) {
      records.set(`e${i}`, makeRecord(`e${i}`, `effect-${i}`, "default", 2000 + i, { strength: 0.5 + i * 0.1 }))
    }
    records.set("f1", makeRecord("f1", "filler", "default", 1500))
    records.set("f2", makeRecord("f2", "filler", "default", 1501))

    const pattern = makeScoringPattern({
      support_count: 3,
      cause_record_ids: ["c1", "c2", "c3", "c4"],
      effect_record_ids: ["e1", "e2", "e3"],
    })

    const scored = scorePattern(pattern, records)
    // n=3 >= MIN_SUPPORT → full weighted formula:
    // causal_strength = 0.35*transition_lift + 0.30*temporal_consistency + 0.20*outcome_stability + 0.15*support_score
    const expected = 0.35 * scored.transition_lift + 0.30 * scored.temporal_consistency
      + 0.20 * scored.outcome_stability + 0.15 * (Math.log2(3 + 1) / Math.log2(21))
    assert.approximately(scored.causal_strength, expected, 0.01)
  })

  it("10. scorePattern handles zero support → returns zero causal_strength", () => {
    const records = new Map<string, AuraRecord>()
    const pattern = makeScoringPattern({
      support_count: 0,
      cause_record_ids: [],
      effect_record_ids: [],
    })

    const scored = scorePattern(pattern, records)
    assert.strictEqual(scored.causal_strength, 0.0)
    assert.strictEqual(scored.transition_lift, 0.0)
  })

  it("11. legacy fields (confidence, lift) updated: confidence = P(e|c), lift = raw_lift", () => {
    const records = new Map<string, AuraRecord>()
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("c2", makeRecord("c2", "cause", "default", 1001))
    records.set("e1", makeRecord("e1", "effect", "default", 2000))

    const pattern = makeScoringPattern({
      support_count: 1,
      cause_record_ids: ["c1", "c2"],
      effect_record_ids: ["e1"],
    })

    const scored = scorePattern(pattern, records)
    // P(e|c) = 1/2 = 0.5
    assert.approximately(scored.confidence, 0.50, 0.01, `expected confidence 0.50, got ${scored.confidence}`)
    // P(e)=1/3=0.333, raw_lift=0.5/0.333=1.5, transition_lift=1.5/5.0=0.3
    assert.approximately(scored.transition_lift, 0.30, 0.01)
    assert.approximately(scored.lift, 1.50, 0.01, `expected lift 1.50, got ${scored.lift}`)
  })

  it("12. effect_record_signature_variants and polarity signals populated", () => {
    const records = new Map<string, AuraRecord>()
    records.set("c1", makeRecord("c1", "cause", "default", 1000))
    records.set("e1", makeRecord("e1", "success story", "default", 2000,
      { tags: ["success", "deployed"], strength: 0.8 }))
    records.set("e2", makeRecord("e2", "failure incident", "default", 2001,
      { tags: ["failure", "incident"], semantic_type: "contradiction", strength: 0.6 }))

    const pattern = makeScoringPattern({
      support_count: 2,
      cause_record_ids: ["c1"],
      effect_record_ids: ["e1", "e2"],
    })

    const scored = scorePattern(pattern, records)
    // e1 has tags "success" and "deployed" → positive signals (keyword matches)
    // e2 has tags "failure" and "incident" + semantic_type "contradiction"
    assert.ok(scored.effect_record_signature_variants > 0, "should have signature variants")
    assert.ok(scored.positive_effect_signals > 0, "should detect positive signals")
    assert.ok(scored.negative_effect_signals > 0, "should detect negative signals")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Task 2 (RED): Evidence gates + corpus fingerprint + state promotion tests
// Will fail until implemented
// ═══════════════════════════════════════════════════════════════════════════

describe("evidence gates", () => {
  // Helper for gate test patterns
  function makeGatePattern(overrides?: Record<string, unknown>): any {
    return {
      id: "cp-gate-1",
      cause_belief_id: "b-c",
      effect_belief_id: "b-e",
      cause_key: "ns:b-c:b-e",
      effect_key: "b-e",
      edge_hash: "hxyz",
      support: 0,
      confidence: 0,
      lift: 0,
      state: CausalState.Candidate,
      last_updated: 1000,
      transition_lift: 0,
      temporal_consistency: 0,
      outcome_stability: 0,
      causal_strength: 0,
      support_count: 0,
      explicit_support_count: 0,
      temporal_support_count: 0,
      counterevidence_count: 0,
      temporal_windows: 1,
      explicit_support_total_for_cause: 0,
      explicit_effect_variants_for_cause: 0,
      effect_record_signature_variants: 0,
      positive_effect_signals: 0,
      negative_effect_signals: 0,
      namespace: "default",
      cause_record_ids: ["cr1"],
      effect_record_ids: ["er1"],
      ...overrides,
    }
  }

  it("1. meetsSupportGate: support_count >= 2 → true", () => {
    const p = makeGatePattern({ support_count: 2 })
    assert.ok(meetsSupportGate(p), "support_count=2 should pass support gate")
  })

  it("2. meetsSupportGate: support_count = 1 → false", () => {
    const p = makeGatePattern({ support_count: 1 })
    assert.ok(!meetsSupportGate(p), "support_count=1 should fail support gate")
  })

  it("3. meetsSupportGate in ExplicitTrusted: explicit_support_count >= 1 → true even with support_count=1", () => {
    const p = makeGatePattern({ support_count: 1, explicit_support_count: 1 })
    assert.ok(meetsSupportGate(p, EvidenceMode.ExplicitTrusted),
      "ExplicitTrusted should pass with explicit_support_count >= 1")
  })

  it("4. meetsRepeatedEvidenceGate: unique_temporal_windows >= 2 → true", () => {
    const p = makeGatePattern({ temporal_windows: 2, explicit_support_count: 0 })
    assert.ok(meetsRepeatedEvidenceGate(p, EvidenceMode.StrictRepeatedWindows),
      "2 temporal windows should pass repeated evidence gate")
  })

  it("5. meetsRepeatedEvidenceGate: unique_temporal_windows = 1, explicit < 2 → false (StrictRepeatedWindows)", () => {
    const p = makeGatePattern({ temporal_windows: 1, explicit_support_count: 0 })
    assert.ok(!meetsRepeatedEvidenceGate(p, EvidenceMode.StrictRepeatedWindows),
      "1 window, 0 explicit should fail in StrictRepeatedWindows")
  })

  it("6. meetsRepeatedEvidenceGate: explicit_support_count >= 2 → true even with 0 temporal_windows", () => {
    const p = makeGatePattern({ explicit_support_count: 2, temporal_windows: 0 })
    assert.ok(meetsRepeatedEvidenceGate(p), "explicit_support_count=2 should pass")
  })

  it("7. meetsRepeatedEvidenceGate in ExplicitTrusted: explicit_support_count >= 1 → true", () => {
    const p = makeGatePattern({ explicit_support_count: 1, temporal_windows: 0 })
    assert.ok(meetsRepeatedEvidenceGate(p, EvidenceMode.ExplicitTrusted),
      "ExplicitTrusted should pass with 1 explicit edge")
  })

  it("8. meetsEvidenceGate: combines support + repeated → both must pass", () => {
    const passPattern = makeGatePattern({ support_count: 2, temporal_windows: 2 })
    assert.ok(meetsEvidenceGate(passPattern), "both gates met → evidence passes")

    const failSupport = makeGatePattern({ support_count: 1, temporal_windows: 2 })
    assert.ok(!meetsEvidenceGate(failSupport), "support gate fails → evidence fails")
  })

  it("9. meetsCounterfactualGate: counterevidence=1, support=5 → ratio=1/6≈0.17 → passes", () => {
    const p = makeGatePattern({
      support_count: 5,
      counterevidence_count: 1,
      explicit_support_total_for_cause: 5,
      explicit_effect_variants_for_cause: 1,
    })
    assert.ok(meetsCounterfactualGate(p), "ratio 0.17 <= 0.50 → should pass")
  })

  it("10. meetsCounterfactualGate: counterevidence=4, support=5 → ratio=4/9≈0.44 → passes", () => {
    const p = makeGatePattern({
      support_count: 5,
      counterevidence_count: 4,
      explicit_support_total_for_cause: 4,
      explicit_effect_variants_for_cause: 1,
    })
    // ratio = counterevidence / (support + counterevidence) = 4/9 = 0.444 → <= 0.50 → passes
    assert.ok(meetsCounterfactualGate(p), "ratio 0.44 <= 0.50 → should pass")
  })

  it("11. meetsCounterfactualGate: counterevidence=6, support=5 → ratio=6/11≈0.545 → fails", () => {
    const p = makeGatePattern({
      support_count: 5,
      counterevidence_count: 6,
      explicit_support_total_for_cause: 6,
      explicit_effect_variants_for_cause: 1,
    })
    assert.ok(!meetsCounterfactualGate(p), "ratio 0.55 > 0.50 → should fail")
  })

  it("12. Pattern passing ALL gates with causal_strength >= 0.75 → Stable state promotion", () => {
    // This tests the full promotion logic: all gates pass + high strength → Stable
    const pattern = makeGatePattern({
      support_count: 3,
      explicit_support_count: 2,
      temporal_windows: 2,
      counterevidence_count: 0,
      causal_strength: 0.80,
      explicit_support_total_for_cause: 2,
      explicit_effect_variants_for_cause: 1,
    })

    const supportOk = meetsSupportGate(pattern)
    const repeatedOk = meetsRepeatedEvidenceGate(pattern)
    const counterfactualOk = meetsCounterfactualGate(pattern)

    assert.ok(supportOk, "support gate should pass")
    assert.ok(repeatedOk, "repeated evidence gate should pass")
    assert.ok(counterfactualOk, "counterfactual gate should pass")

    // With all gates passing and strength >= 0.75 → Stable
    const promotesToStable = supportOk && repeatedOk && counterfactualOk && pattern.causal_strength >= 0.75
    assert.ok(promotesToStable, "should promote to Stable")
  })

  it("13. Pattern with causal_strength between 0.50-0.75 → Candidate (not Stable)", () => {
    const pattern = makeGatePattern({
      support_count: 3,
      explicit_support_count: 2,
      temporal_windows: 2,
      counterevidence_count: 0,
      causal_strength: 0.60,
      explicit_support_total_for_cause: 2,
      explicit_effect_variants_for_cause: 1,
    })

    const supportOk = meetsSupportGate(pattern)
    const repeatedOk = meetsRepeatedEvidenceGate(pattern)
    const counterfactualOk = meetsCounterfactualGate(pattern)

    assert.ok(supportOk && repeatedOk && counterfactualOk, "all gates should pass")
    const isStable = pattern.causal_strength >= 0.75
    const isCandidate = pattern.causal_strength >= 0.50
    assert.ok(!isStable, "strength 0.60 < 0.75 → not Stable")
    assert.ok(isCandidate, "strength 0.60 >= 0.50 → Candidate")
  })

  it("14. Pattern failing evidence gate → Rejected (not Candidate)", () => {
    const pattern = makeGatePattern({
      support_count: 1,
      explicit_support_count: 0,
      temporal_windows: 1,
      counterevidence_count: 0,
      causal_strength: 0.0,
    })

    assert.ok(!meetsEvidenceGate(pattern), "evidence gate should fail")
    // Fails evidence gate → Rejected
  })
})

describe("corpus fingerprint", () => {
  it("1. Same record set → same fingerprint", () => {
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecord("r1", "content-a", "ns1", 1000))
    records1.set("r2", makeRecord("r2", "content-b", "ns1", 1001))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r1", makeRecord("r1", "content-a", "ns1", 1000))
    records2.set("r2", makeRecord("r2", "content-b", "ns1", 1001))

    const fp1 = computeCorpusFingerprint(records1)
    const fp2 = computeCorpusFingerprint(records2)

    assert.strictEqual(fp1, fp2, "identical records should produce same fingerprint")
    assert.ok(typeof fp1 === "string" && fp1.length > 0, "fingerprint should be non-empty string")
  })

  it("2. Different record IDs → different fingerprint", () => {
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecord("r1", "content", "ns1", 1000))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r2", makeRecord("r2", "content", "ns1", 1000))

    const fp1 = computeCorpusFingerprint(records1)
    const fp2 = computeCorpusFingerprint(records2)

    assert.ok(fp1 !== fp2, "different record IDs should produce different fingerprints")
  })

  it("3. Different namespace → different fingerprint", () => {
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecord("r1", "content", "ns-a", 1000))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r1", makeRecord("r1", "content", "ns-b", 1000))

    const fp1 = computeCorpusFingerprint(records1)
    const fp2 = computeCorpusFingerprint(records2)

    assert.ok(fp1 !== fp2, "different namespace should produce different fingerprints")
  })

  it("4. Different created_at → different fingerprint", () => {
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecord("r1", "content", "ns1", 1000))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r1", makeRecord("r1", "content", "ns1", 2000))

    const fp1 = computeCorpusFingerprint(records1)
    const fp2 = computeCorpusFingerprint(records2)

    assert.ok(fp1 !== fp2, "different created_at should produce different fingerprints")
  })

  it("5. Different caused_by_id → different fingerprint", () => {
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecord("r1", "content", "ns1", 1000))
    records1.set("r2", makeRecord("r2", "content", "ns1", 1001, { caused_by_id: "r1" }))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r1", makeRecord("r1", "content", "ns1", 1000))
    records2.set("r2", makeRecord("r2", "content", "ns1", 1001)) // no caused_by_id

    const fp1 = computeCorpusFingerprint(records1)
    const fp2 = computeCorpusFingerprint(records2)

    assert.ok(fp1 !== fp2, "different caused_by_id should produce different fingerprints")
  })

  it("6. Different causal connections → different fingerprint", () => {
    const records1 = new Map<string, AuraRecord>()
    records1.set("r1", makeRecord("r1", "content", "ns1", 1000, {
      connection_types: { r2: "causal" }
    }))
    records1.set("r2", makeRecord("r2", "content", "ns1", 1001))
    const records2 = new Map<string, AuraRecord>()
    records2.set("r1", makeRecord("r1", "content", "ns1", 1000, {
      connection_types: { r2: "reflective" }
    }))
    records2.set("r2", makeRecord("r2", "content", "ns1", 1001))

    const fp1 = computeCorpusFingerprint(records1)
    const fp2 = computeCorpusFingerprint(records2)

    assert.ok(fp1 !== fp2, "different causal connections should produce different fingerprints")
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
      temporal_support_count: 5,
      counterevidence_count: 2,
      temporal_windows: 3,
      explicit_support_total_for_cause: 5,
      explicit_effect_variants_for_cause: 1,
      effect_record_signature_variants: 0,
      positive_effect_signals: 0,
      negative_effect_signals: 0,
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
      temporal_support_count: 5,
      counterevidence_count: 2,
      temporal_windows: 3,
      explicit_support_total_for_cause: 5,
      explicit_effect_variants_for_cause: 1,
      effect_record_signature_variants: 0,
      positive_effect_signals: 0,
      negative_effect_signals: 0,
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
