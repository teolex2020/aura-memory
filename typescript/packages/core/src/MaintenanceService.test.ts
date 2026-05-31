import { describe, it, expect, vi } from "vitest"
import { Effect, Layer, Ref } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// Helper: create a Ref from a value (replaces Ref.unsafeMake which doesn't exist)
function mockRef<T>(value: T): Ref.Ref<T> {
  return Effect.runSync(Ref.make(value))
}
import {
  buildTrendSnapshot,
  summarizeTrends,
  pushTrendSnapshot,
  summarizeReflections,
  pushReflectionSummary,
  computeLayerStability,
  MAINTENANCE_TREND_LIMIT,
  REFLECTION_SUMMARY_LIMIT,
  buildSdrLookup,
  buildReflectionSummary,
  createDefaultTagTaxonomy,
  createNGramIndex,
  DisabledBackgroundBrain,
} from "./MaintenanceService"
import type {
  EpistemicPhaseReport,
  BeliefPhaseReport,
  CausalPhaseReport,
  PolicyPhaseReport,
  FeedbackAuditReport,
  PhaseTimings,
  MaintenanceHotspots,
  MaintenanceTrendSnapshot,
  MaintenanceTrendSummary,
  LayerStability,
  LayerChurn,
  ContradictionCluster,
  ReflectionSummary,
  ReflectionFinding,
  ReflectionJobReport,
  Record as AuraRecord,
} from "@aura/contract"
import { EpistemicTrace, Level } from "@aura/contract"
import { SDRInterpreter } from "@aura/recall"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import {
  BrainAuraFile,
  CognitiveStoreFile,
  currentPersistenceManifest,
  MaintenanceTrendsFile,
  ReflectionSummariesFile,
  savePersistenceManifest,
} from "@aura/storage"
import { Aura, DefaultLayer } from "./index"

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function emptyTimings(): PhaseTimings {
  return {
    levelFixMs: 0, decayMs: 0, reflectMs: 0, epistemicMs: 0,
    insightsMs: 0, sdrBuildMs: 0, beliefMs: 0, conceptMs: 0,
    causalMs: 0, policyMs: 0, consolidationMs: 0,
    crossConnectionsMs: 0, tasksArchivalMs: 0, totalMs: 0,
  }
}

function emptyHotspots(): MaintenanceHotspots {
  return {
    recordsBeforeCycle: 0, recordsAfterCycle: 0, beliefSnapshotRecords: 0,
    sdrSourceBytes: 0, sdrVectorsBuilt: 0, sdrVectorsComputed: 0, sdrVectorsReused: 0,
    beliefTotalBeliefs: 0, beliefTotalHypotheses: 0,
    conceptPairwiseComparisons: 0, conceptPartitionsWithMultipleSeeds: 0,
    causalEdgesFound: 0, causalExplicitEdgesFound: 0, causalTemporalEdgesFound: 0,
    causalTemporalNamespacesScanned: 0, causalTemporalPairsConsidered: 0,
    causalTemporalPairsSkippedByBudget: 0, causalTemporalEdgesCapped: 0,
    causalTemporalNamespacesHitCap: 0,
    policySeedsFound: 0,
    crossConnectionsFound: 0, taskRemindersFound: 0,
    dominantPhase: "", dominantPhaseMs: 0, dominantPhaseShare: 0,
  }
}

function emptyEpistemic(): EpistemicPhaseReport {
  return { updatedRecords: 0, totalSupportLinks: 0, totalConflictLinks: 0, volatileRecords: 0 }
}

function emptyBelief(): BeliefPhaseReport {
  return { beliefsCreated: 0, beliefsPruned: 0, revisions: 0, resolved: 0, unresolved: 0, totalBeliefs: 0, totalHypotheses: 0, churnRate: 0 }
}

function emptyCausal(): CausalPhaseReport {
  return {
    skipped: false, edgesFound: 0, explicitEdgesFound: 0, temporalEdgesFound: 0,
    temporalNamespacesScanned: 0, temporalPairsConsidered: 0,
    temporalPairsSkippedByBudget: 0, temporalEdgesCapped: 0, temporalNamespacesHitCap: 0,
    candidatesFound: 0, patternsMeetingSupportGate: 0, patternsMeetingRepeatedWindowGate: 0,
    patternsMeetingCounterfactualGate: 0, patternsBlockedByEvidenceGates: 0,
    patternsBlockedByCounterfactualGate: 0, stableCount: 0, rejectedCount: 0, avgCausalStrength: 0,
  }
}

function emptyPolicy(): PolicyPhaseReport {
  return { seedsFound: 0, hintsFound: 0, stableHints: 0, suppressedHints: 0, rejectedHints: 0, avgPolicyStrength: 0 }
}

function emptyFeedback(): FeedbackAuditReport {
  return { beliefsTouched: 0, beliefsBoosted: 0, beliefsDampened: 0, netConfidenceDelta: 0, netVolatilityDelta: 0, entries: [] }
}

function makeSnapshot(overrides: Partial<MaintenanceTrendSnapshot> = {}): MaintenanceTrendSnapshot {
  return {
    timestamp: "2026-05-28T00:00:00Z",
    totalRecords: 100,
    recordsArchived: 5,
    insightsFound: 3,
    volatileRecords: 10,
    beliefChurn: 0.1,
    causalRejectionRate: 0.05,
    policySuppressionRate: 0.02,
    feedbackBeliefsTouched: 0,
    feedbackNetConfidenceDelta: 0,
    feedbackNetVolatilityDelta: 0,
    correctionEvents: 2,
    cumulativeCorrections: 10,
    cycleTimeMs: 1500,
    dominantPhase: "belief",
    ...overrides,
  }
}

function makeReflectionSummary(
  overrides: Partial<ReflectionSummary> = {},
  findings: ReflectionFinding[] = []
): ReflectionSummary {
  const report: ReflectionJobReport = {
    jobsRun: 1,
    blockerFindings: 0,
    contradictionFindings: 0,
    trendFindings: 0,
    totalFindings: findings.length,
    capped: false,
  }
  return {
    timestamp: "2026-05-28T00:00:00Z",
    digest: "test digest",
    dominantPhase: "belief",
    report,
    findings,
    ...overrides,
  }
}

function makeFinding(overrides: Partial<ReflectionFinding> = {}): ReflectionFinding {
  return {
    kind: "blocker",
    namespace: "tasks",
    title: "Test finding",
    detail: "Test detail",
    relatedIds: [],
    score: 0.75,
    severity: "high",
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Pure function tests
// ═══════════════════════════════════════════════════════════════════════

describe("buildTrendSnapshot", () => {
  it("returns MaintenanceTrendSnapshot with all fields matching input params", () => {
    const result = buildTrendSnapshot(
      "2026-05-28T00:00:00Z", 100, 5, 3,
      emptyEpistemic(), emptyBelief(), emptyCausal(), emptyPolicy(),
      emptyFeedback(), emptyTimings(), emptyHotspots(), 10, 0
    )

    expect(result).toMatchObject({
      timestamp: "2026-05-28T00:00:00Z",
      totalRecords: 100,
      recordsArchived: 5,
      insightsFound: 3,
      correctionEvents: 10, // cumulative(10) - previous(0)
      cumulativeCorrections: 10,
    })
  })

  it("computes correctionEvents as cumulative - previous", () => {
    const result = buildTrendSnapshot(
      "ts", 100, 0, 0,
      emptyEpistemic(), emptyBelief(), emptyCausal(), emptyPolicy(),
      emptyFeedback(), emptyTimings(), emptyHotspots(), 42, 30
    )
    expect(result.correctionEvents).toBe(12)
    expect(result.cumulativeCorrections).toBe(42)
  })

  it("computes causalRejectionRate correctly when total > 0", () => {
    const causal: CausalPhaseReport = {
      ...emptyCausal(),
      rejectedCount: 5,
      stableCount: 10,
      candidatesFound: 35,
    }
    const result = buildTrendSnapshot(
      "ts", 100, 0, 0,
      emptyEpistemic(), emptyBelief(), causal, emptyPolicy(),
      emptyFeedback(), emptyTimings(), emptyHotspots(), 0, 0
    )
    // rejection rate = 5 / (5 + 10 + 35) = 5 / 50 = 0.1
    expect(result.causalRejectionRate).toBeCloseTo(0.1, 5)
  })

  it("causalRejectionRate is 0 when total is 0", () => {
    const result = buildTrendSnapshot(
      "ts", 100, 0, 0,
      emptyEpistemic(), emptyBelief(), emptyCausal(), emptyPolicy(),
      emptyFeedback(), emptyTimings(), emptyHotspots(), 0, 0
    )
    expect(result.causalRejectionRate).toBe(0)
  })

  it("computes policySuppressionRate correctly", () => {
    const policy: PolicyPhaseReport = {
      ...emptyPolicy(),
      suppressedHints: 3,
      stableHints: 7,
      hintsFound: 10,
    }
    const result = buildTrendSnapshot(
      "ts", 100, 0, 0,
      emptyEpistemic(), emptyBelief(), emptyCausal(), policy,
      emptyFeedback(), emptyTimings(), emptyHotspots(), 0, 0
    )
    // suppression rate = 3 / (3 + 7 + 10) = 3 / 20 = 0.15
    expect(result.policySuppressionRate).toBeCloseTo(0.15, 5)
  })

  it("dominantPhase comes from hotspots", () => {
    const hotspots: MaintenanceHotspots = { ...emptyHotspots(), dominantPhase: "causal" }
    const result = buildTrendSnapshot(
      "ts", 100, 0, 0,
      emptyEpistemic(), emptyBelief(), emptyCausal(), emptyPolicy(),
      emptyFeedback(), emptyTimings(), hotspots, 0, 0
    )
    expect(result.dominantPhase).toBe("causal")
  })
})

describe("summarizeTrends", () => {
  it("with empty history returns zero averages", () => {
    const result = summarizeTrends([])
    expect(result).toMatchObject({
      snapshotCount: 0,
      avgBeliefChurn: 0,
      avgCausalRejectionRate: 0,
      avgPolicySuppressionRate: 0,
      avgCycleTimeMs: 0,
      avgCorrectionEvents: 0,
      totalCorrectionsInWindow: 0,
      latestDominantPhase: "",
    })
    expect(result.recent).toEqual([])
  })

  it("with N snapshots computes correct averages", () => {
    const history: MaintenanceTrendSnapshot[] = [
      makeSnapshot({ beliefChurn: 0.1, correctionEvents: 2, cycleTimeMs: 1000 }),
      makeSnapshot({ beliefChurn: 0.3, correctionEvents: 4, cycleTimeMs: 2000 }),
    ]
    const result = summarizeTrends(history)
    expect(result.snapshotCount).toBe(2)
    expect(result.avgBeliefChurn).toBeCloseTo(0.2, 5)
    expect(result.avgCorrectionEvents).toBeCloseTo(3, 5)
    expect(result.avgCycleTimeMs).toBeCloseTo(1500, 5)
    expect(result.totalCorrectionsInWindow).toBe(6)
    expect(result.latestDominantPhase).toBe("belief")
  })

  it("totalCorrectionsInWindow sums all correction events in recent window", () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeSnapshot({ correctionEvents: i + 1 })
    )
    const result = summarizeTrends(history)
    // Window = last 6 snapshots: indices 4-9, correctionEvents = 5+6+7+8+9+10 = 45
    expect(result.totalCorrectionsInWindow).toBe(45)
  })
})

describe("pushTrendSnapshot", () => {
  it("appends snapshot to history", async () => {
    const history: MaintenanceTrendSnapshot[] = []
    const snapshot = makeSnapshot()
    await Effect.runPromise(pushTrendSnapshot(history, snapshot))
    expect(history).toHaveLength(1)
    expect(history[0]).toEqual(snapshot)
  })

  it("when history exceeds limit, oldest is shifted", async () => {
    const history: MaintenanceTrendSnapshot[] = []
    for (let i = 0; i < MAINTENANCE_TREND_LIMIT + 5; i++) {
      await Effect.runPromise(pushTrendSnapshot(history, makeSnapshot({ timestamp: `ts-${i}` })))
    }
    expect(history).toHaveLength(MAINTENANCE_TREND_LIMIT)
    // Oldest (first 5) should have been shifted off
    expect(history[0]!.timestamp).toBe("ts-5")
    expect(history[MAINTENANCE_TREND_LIMIT - 1]!.timestamp).toBe(`ts-${MAINTENANCE_TREND_LIMIT + 4}`)
  })
})

describe("pushReflectionSummary", () => {
  it("appends and enforces REFLECTION_SUMMARY_LIMIT (16)", async () => {
    const history: ReflectionSummary[] = []
    for (let i = 0; i < REFLECTION_SUMMARY_LIMIT + 3; i++) {
      await Effect.runPromise(pushReflectionSummary(history, makeReflectionSummary({ timestamp: `rts-${i}` })))
    }
    expect(history).toHaveLength(REFLECTION_SUMMARY_LIMIT)
    expect(history[0]!.timestamp).toBe("rts-3")
  })
})

describe("summarizeReflections", () => {
  it("with empty history returns empty digest", () => {
    const result = summarizeReflections([])
    expect(result.summaryCount).toBe(0)
    expect(result.totalFindings).toBe(0)
    expect(result.highSeverityFindings).toBe(0)
    expect(result.kinds).toEqual([])
    expect(result.topFindings).toEqual([])
  })

  it("aggregates findings across summaries", () => {
    const summaries: ReflectionSummary[] = [
      makeReflectionSummary({ dominantPhase: "belief" }, [
        makeFinding({ kind: "blocker", score: 0.9, severity: "high" }),
        makeFinding({ kind: "trend", score: 0.5, severity: "medium" }),
      ]),
      makeReflectionSummary({ dominantPhase: "causal" }, [
        makeFinding({ kind: "contradiction", score: 0.8, severity: "high" }),
        makeFinding({ kind: "blocker", score: 0.3, severity: "low" }),
      ]),
    ]
    const result = summarizeReflections(summaries)

    expect(result.summaryCount).toBe(2)
    expect(result.totalFindings).toBe(4)
    expect(result.highSeverityFindings).toBe(2)
    expect(result.latestTimestamp).toBe("2026-05-28T00:00:00Z")
    expect(result.latestDominantPhase).toBe("causal")

    // Kinds: blocker count=2, trend count=1, contradiction count=1
    const blockerKind = result.kinds.find((k) => k.kind === "blocker")
    expect(blockerKind).toBeDefined()
    expect(blockerKind!.count).toBe(2)
    expect(blockerKind!.highSeverityCount).toBe(1)

    // Top findings sorted by score desc
    expect(result.topFindings).toHaveLength(4) // all 4, since 4 <= REFLECTION_FINDING_LIMIT=6
    expect(result.topFindings[0]!.score).toBe(0.9) // highest first
  })

  it("caps top findings at REFLECTION_FINDING_LIMIT (6)", () => {
    const summaries = Array.from({ length: 3 }, (_, i) =>
      makeReflectionSummary({ dominantPhase: "belief" }, [
        makeFinding({ kind: "test", score: 0.1 * (i + 1) }),
        makeFinding({ kind: "test", score: 0.1 * (i + 1) + 0.05 }),
        makeFinding({ kind: "test", score: 0.1 * (i + 1) + 0.1 }),
      ])
    )
    const result = summarizeReflections(summaries)
    // 3 summaries * 3 findings = 9 total, capped at 6
    expect(result.topFindings).toHaveLength(6)
    // Should be the 6 highest scores
    expect(result.topFindings[0]!.score).toBeGreaterThanOrEqual(result.topFindings[5]!.score)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// computeLayerStability tests (using mock engine states)
// ═══════════════════════════════════════════════════════════════════════

describe("computeLayerStability", () => {
  type MockEngine = {
    stats: () => Effect.Effect<{ beliefs?: Record<string, unknown>; key_index?: Record<string, string>; patterns?: Record<string, unknown> }>
    Interface: unknown
  }

  function mockBeliefEng(beliefs: Record<string, unknown> = {}): MockEngine {
    return {
      Interface: undefined as unknown,
      stats: () => Effect.succeed({ beliefs }),
    }
  }

  function mockConceptEng(concepts: Record<string, unknown> = {}, key_index: Record<string, string> = {}): MockEngine {
    return {
      Interface: undefined as unknown,
      stats: () => Effect.succeed({ concepts, key_index }),
    }
  }

  function mockCausalEng(patterns: Record<string, unknown> = {}): MockEngine {
    return {
      Interface: undefined as unknown,
      stats: () => Effect.succeed({ patterns }),
    }
  }

  function mockPolicyEng(key_index: Record<string, string> = {}): MockEngine {
    return {
      Interface: undefined as unknown,
      stats: () => Effect.succeed({ key_index }),
    }
  }

  it("with empty prev keys and empty current keys returns all zeros", async () => {
    const result = await Effect.runPromise(
      computeLayerStability(
        mockBeliefEng() as any,
        mockConceptEng() as any,
        mockCausalEng() as any,
        mockPolicyEng() as any,
        mockRef(new Set<string>()),
        mockRef(new Set<string>()),
        mockRef(new Set<string>()),
        mockRef(new Set<string>())
      )
    )

    const zeroChurn: LayerChurn = { retained: 0, newCount: 0, dropped: 0, churn: 0 }
    expect(result).toEqual({
      belief: zeroChurn,
      concept: zeroChurn,
      causal: zeroChurn,
      policy: zeroChurn,
    })
  })

  it("with prev keys and matching current keys returns retained=N, new=0, dropped=0, churn=0", async () => {
    const beliefs = { "b1": {}, "b2": {}, "b3": {} }
    const concepts = { "c1": {} }
    const conceptKI = { "key-a": "c1" }

    const result = await Effect.runPromise(
      computeLayerStability(
        mockBeliefEng(beliefs) as any,
        mockConceptEng(concepts, conceptKI) as any,
        mockCausalEng({}) as any,
        mockPolicyEng({}) as any,
        mockRef(new Set(["b1", "b2", "b3"])),
        mockRef(new Set(["key-a"])),
        mockRef(new Set<string>()),
        mockRef(new Set<string>())
      )
    )

    expect(result.belief).toEqual({ retained: 3, newCount: 0, dropped: 0, churn: 0 })
    // concept uses key_index keys, not concept ids
    expect(result.concept).toEqual({ retained: 1, newCount: 0, dropped: 0, churn: 0 })
    // causal: empty both sides
    expect(result.causal).toEqual({ retained: 0, newCount: 0, dropped: 0, churn: 0 })
    // policy: empty both sides
    expect(result.policy).toEqual({ retained: 0, newCount: 0, dropped: 0, churn: 0 })
  })

  it("with partially overlapping keys computes correct retained/new/dropped/churn", async () => {
    const beliefs = { "b1": {}, "b2": {}, "b4": {} } // b3 was dropped, b4 is new
    const prevKeys = new Set(["b1", "b2", "b3"])

    const result = await Effect.runPromise(
      computeLayerStability(
        mockBeliefEng(beliefs) as any,
        mockConceptEng() as any,
        mockCausalEng() as any,
        mockPolicyEng() as any,
        mockRef(prevKeys),
        mockRef(new Set<string>()),
        mockRef(new Set<string>()),
        mockRef(new Set<string>())
      )
    )

    expect(result.belief.retained).toBe(2) // b1, b2
    expect(result.belief.newCount).toBe(1) // b4
    expect(result.belief.dropped).toBe(1)  // b3
    // churn = (1 + 1) / max(1, 3) = 2/3
    expect(result.belief.churn).toBeCloseTo(2 / 3, 5)
  })

  it("with empty prev keys and new current keys returns new=N, churn=1.0", async () => {
    const result = await Effect.runPromise(
      computeLayerStability(
        mockBeliefEng({ "b1": {}, "b2": {} }) as any,
        mockConceptEng() as any,
        mockCausalEng() as any,
        mockPolicyEng() as any,
        mockRef(new Set<string>()),
        mockRef(new Set<string>()),
        mockRef(new Set<string>()),
        mockRef(new Set<string>())
      )
    )

    expect(result.belief.retained).toBe(0)
    expect(result.belief.newCount).toBe(2)
    expect(result.belief.dropped).toBe(0)
    // Rust parity: churn = (new + dropped) / max(1, current.size) = 2/2 = 1.0
    expect(result.belief.churn).toBe(1.0)
  })

  it("updates prevKeys Refs after computation", async () => {
    const prevBelief = mockRef(new Set<string>())
    const prevConcept = mockRef(new Set<string>())
    const prevCausal = mockRef(new Set<string>())
    const prevPolicy = mockRef(new Set<string>())

    await Effect.runPromise(
      computeLayerStability(
        mockBeliefEng({ "b1": {}, "b2": {} }) as any,
        mockConceptEng({}, { "key-x": "c1" }) as any,
        mockCausalEng({}) as any,
        mockPolicyEng({ "policy1": "h1" }) as any,
        prevBelief, prevConcept, prevCausal, prevPolicy
      )
    )

    expect(Effect.runSync(Ref.get(prevBelief))).toEqual(new Set(["b1", "b2"]))
    expect(Effect.runSync(Ref.get(prevConcept))).toEqual(new Set(["key-x"]))
    expect(Effect.runSync(Ref.get(prevCausal))).toEqual(new Set<string>())
    expect(Effect.runSync(Ref.get(prevPolicy))).toEqual(new Set(["policy1"]))
  })
})

describe("Phase 07 placeholder replacements", () => {
  function makeRecord(overrides: Partial<AuraRecord> = {}): AuraRecord {
    return {
      id: "r1",
      content: "Deploy to staging before production release",
      level: Level.Working,
      strength: 1,
      activation_count: 0,
      created_at: 1,
      last_activated: 1,
      tags: ["deploy", "safety"],
      connections: {},
      connection_types: {},
      content_type: "text",
      source_type: "recorded",
      namespace: "ops",
      semantic_type: "decision",
      activation_velocity: 0,
      salience: 0,
      metadata: {},
      aura_id: null,
      caused_by_id: null,
      confidence: 0.9,
      support_mass: 0,
      conflict_mass: 0,
      volatility: 0,
      ...overrides,
    }
  }

  it("TagTaxonomy classifies identity, task, and contradiction cues deterministically", () => {
    const taxonomy = createDefaultTagTaxonomy()

    expect(taxonomy.classify(makeRecord({ level: Level.Identity, tags: ["profile"] })).identityCue).toBe(true)
    expect(taxonomy.classify(makeRecord({ tags: ["scheduled-task"] })).taskCue).toBe(true)
    expect(taxonomy.classify(makeRecord({ semantic_type: "contradiction" })).contradictionCue).toBe(true)
    expect(taxonomy.classify(makeRecord({ tags: ["todo-item"] })).nonIdentityCue).toBe(true)
  })

  it("NGramIndex returns bounded MinHash content-derived candidates", () => {
    const records = new Map([
      ["r1", makeRecord({ id: "r1", content: "deploy staging safety checklist" })],
      ["r2", makeRecord({ id: "r2", content: "banana unrelated note" })],
    ])
    const hits = createNGramIndex(records).query("staging safety deploy", 4)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.[1]).toBe("r1")
    expect(hits[0]?.[0]).toBeGreaterThan(0)
  })

  it("DisabledBackgroundBrain returns explicit empty outputs for background-only paths", () => {
    const records = new Map([["r1", makeRecord()]])
    expect(DisabledBackgroundBrain.discover_cross_connections(records, 10)).toEqual([])
    expect(DisabledBackgroundBrain.scheduled_tasks(records)).toEqual([])
  })

  it("buildSdrLookup computes non-empty SDR vectors for non-empty content", async () => {
    const sdr = await SDRInterpreter.default()
    const cache = mockRef(new Map<string, ReadonlyArray<number>>())
    const timings = emptyTimings()
    const hotspots = emptyHotspots()
    const records = new Map([["r1", makeRecord({ id: "r1", content: "non empty deployment memory" })]])
    const trace = {
      event: () => Effect.succeed(undefined),
      span: <A, E, R>(_name: string, _fields: Record<string, string | number | boolean>, effect: Effect.Effect<A, E, R>) => effect,
    }

    const lookup = await Effect.runPromise(
      buildSdrLookup(sdr, cache, records, timings, hotspots).pipe(
        Effect.provideService(EpistemicTrace, trace)
      )
    )

    expect(lookup.get("r1")!.length).toBeGreaterThan(0)
    expect(hotspots.sdrVectorsComputed).toBe(1)
    expect(hotspots.sdrSourceBytes).toBeGreaterThan(0)
  })

  it("buildReflectionSummary emits blocker and trend findings from real inputs", async () => {
    const records = new Map([
      ["task1", makeRecord({
        id: "task1",
        content: "Resolve deploy rollback blocker",
        tags: ["scheduled-task", "deploy"],
        metadata: { status: "active", due_date: "2020-01-01T00:00:00Z" },
        strength: 0.4,
      })],
    ])
    const trendSummary = summarizeTrends([
      makeSnapshot({ volatileRecords: 0, policySuppressionRate: 0, causalRejectionRate: 0, correctionEvents: 0, beliefChurn: 0.05 }),
      makeSnapshot({ volatileRecords: 3, policySuppressionRate: 0.3, causalRejectionRate: 0.2, correctionEvents: 1, beliefChurn: 0.2 }),
    ])
    const hotspots = { ...emptyHotspots(), dominantPhase: "policy" }

    const summary = await Effect.runPromise(
      buildReflectionSummary("2026-05-30T00:00:00Z", records, "scheduled-task", [], trendSummary, hotspots)
    )

    expect(summary.report.blockerFindings).toBe(1)
    expect(summary.report.trendFindings).toBe(1)
    expect(summary.findings.length).toBeGreaterThan(0)
    expect(summary.digest).toContain("reflection finding")
  })

  it("runMaintenance computes SDR, emits non-zero signals, and persists trend/reflection history", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-maintenance-07-02-"))
    const ioLayer = Layer.mergeAll(NodeFileReadLive, NodeFileWriteLive, NodeClockLive, NodeCryptoLive)

    const records: AuraRecord[] = [
      makeRecord({
        id: "r1",
        content: "Deploy to staging before production deploy release",
        tags: ["deploy", "safety"],
        semantic_type: "decision",
      }),
      makeRecord({
        id: "r2",
        content: "Always verify staging before production deployment",
        tags: ["deploy", "safety"],
        semantic_type: "decision",
      }),
      makeRecord({
        id: "r3",
        content: "Skip staging and deploy production directly",
        tags: ["deploy", "safety", "contradiction"],
        semantic_type: "contradiction",
      }),
      makeRecord({
        id: "task1",
        content: "Resolve deploy rollback blocker",
        tags: ["scheduled-task", "deploy"],
        metadata: { status: "active", due_date: "2020-01-01T00:00:00Z" },
        strength: 0.4,
      }),
    ]

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* savePersistenceManifest(dir, currentPersistenceManifest())
        const auraFile = yield* BrainAuraFile.open(dir)
        yield* auraFile.flush()
        const store = yield* CognitiveStoreFile.open(dir)
        for (const record of records) {
          yield* store.appendStore(record)
        }
        yield* store.flush()
      }).pipe(Effect.provide(ioLayer))
    )

    const first = await Effect.runPromise(
      Effect.gen(function* () {
        const aura = yield* Aura.open(dir)
        return yield* aura.runMaintenance({ ...defaultMaintenanceConfigForTest(), levelFixInterval: 1 })
      }).pipe(
        Effect.provide(DefaultLayer(dir)),
        Effect.provide(ioLayer)
      )
    )

    expect(first.hotspots.sdrVectorsComputed).toBeGreaterThan(0)
    expect(first.insightsFound).toBeGreaterThan(0)
    expect(first.reflection.findings.length).toBeGreaterThan(0)
    expect(first.trendSummary.snapshotCount).toBe(1)

    const persistedTrends = await Effect.runPromise(
      MaintenanceTrendsFile.new(dir).load().pipe(Effect.provide(NodeFileReadLive))
    )
    const persistedReflections = await Effect.runPromise(
      ReflectionSummariesFile.new(dir).load().pipe(Effect.provide(NodeFileReadLive))
    )
    expect(persistedTrends).toHaveLength(1)
    expect(persistedTrends[0]!.insights_found).toBeGreaterThan(0)
    expect(persistedReflections).toHaveLength(1)
    expect(persistedReflections[0]!.findings.length).toBeGreaterThan(0)

    const second = await Effect.runPromise(
      Effect.gen(function* () {
        const reopened = yield* Aura.open(dir)
        return yield* reopened.runMaintenance({ ...defaultMaintenanceConfigForTest(), levelFixInterval: 1 })
      }).pipe(
        Effect.provide(DefaultLayer(dir)),
        Effect.provide(ioLayer)
      )
    )
    expect(second.trendSummary.snapshotCount).toBe(2)
  })
})

function defaultMaintenanceConfigForTest() {
  return {
    decayEnabled: true,
    reflectEnabled: true,
    insightsEnabled: true,
    consolidationEnabled: true,
    synthesisEnabled: true,
    archivalEnabled: true,
    levelFixInterval: 1,
    maxClustersPerRun: 3,
    archivalRules: [],
    completedArchivalRules: [],
    taskTag: "scheduled-task",
  }
}
