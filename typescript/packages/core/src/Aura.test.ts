import { describe, it, expect } from "vitest"
import { assert } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { Aura } from "./index"
import * as StoreTrust from "./Trust"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import {
  BeliefStoreFile,
  BrainAuraFile,
  CognitiveStoreFile,
  loadCognitiveRecords,
  MaintenanceTrendsFile,
  ReflectionSummariesFile,
  readBrainAuraFile,
} from "@aura/storage"
import { InvertedIndex } from "@aura/indexing"
import { EpistemicRuntimeLive } from "@aura/epistemic-runtime"
import {
  BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine,
  BeliefStore, ConceptStore, CausalStore, PolicyStore,
  EpistemicTrace,
  ConceptSeedMode, ConceptSimilarityMode, ConceptPartitionMode, ConceptUnionMode,
  CausalDiscoveryMode, CausalState, TemporalBudgetMode, EvidenceMode,
  BeliefRerankMode, ConceptSurfaceMode, CausalRerankMode, PolicyRerankMode,
  BeliefState, ConceptState, PolicyActionKind, PolicyState, Polarity,
  Clock,
  Level,
  RecordValidationError,
  defaultMaintenanceConfig,
} from "@aura/contract"

it("Aura.open loads minimal fixture", async () => {
  const fixture = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-brain-fixture-"))
  fs.copyFileSync(path.join(fixture, "temporal.bin"), path.join(brainPath, "temporal.bin"))

  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* BrainAuraFile.open(brainPath)
      yield* f.append({
        id: "ts_fixture_1",
        dna: "user_core",
        timestamp: 1,
        intensity: 0.1,
        stability: 0.2,
        decay_velocity: 0.3,
        entropy: 0.4,
        sdr_indices: [1, 10, 100, 2000],
        text: "Hello TS Fixture"
      })
      yield* f.flush()
    }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  )

  const aura = await Effect.runPromise(
    Aura.open(brainPath).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0]?.id, "ts_fixture_1")

  assert.ok(fs.existsSync(path.join(brainPath, "persistence_manifest.json")))
})

it("Aura.open bootstraps empty Rust storage files", async () => {
  const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-empty-open-"))

  const aura = await Effect.runPromise(
    Aura.open(brainPath).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
    )
  )

  assert.strictEqual(aura.listRecords().length, 0)
  assert.ok(fs.existsSync(path.join(brainPath, "brain.aura")))
  assert.ok(fs.existsSync(path.join(brainPath, "brain.cog")))
  const parsed = readBrainAuraFile(fs.readFileSync(path.join(brainPath, "brain.aura")))
  assert.strictEqual(parsed.header.count, 0n)
})

describe("Aura MCP-facing operational surfaces", () => {
  function provideNode<A, E, R>(effect: Effect.Effect<A, E, R>) {
    return effect.pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  }

  function provideNodeAt<A, E, R>(effect: Effect.Effect<A, E, R>, nowUnixSec: number) {
    return effect.pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provideService(Clock, Clock.fixed(nowUnixSec)),
      Effect.provide(NodeCryptoLive)
    )
  }

  async function openWritableAuraIn(brainPath: string): Promise<Aura> {
    await Effect.runPromise(provideNode(BrainAuraFile.open(brainPath).pipe(Effect.flatMap((file) => file.flush()))))
    return Effect.runPromise(provideNode(Aura.open(brainPath)))
  }

  async function openWritableAura(): Promise<Aura> {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-mcp-core-"))
    return openWritableAuraIn(brainPath)
  }

  it("fails explicitly when passworded open is requested before encrypted storage parity exists", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-password-unsupported-"))

    await expect(
      Effect.runPromise(provideNode(Aura.open_with_password(brainPath, "secret"))),
    ).rejects.toMatchObject({
      _tag: "UnsupportedSurfaceError",
      surface: "Aura.open_with_password",
    })
  })

  it("rerank mode runtime setters mirror Rust and Python binding string semantics", async () => {
    const aura = await openWritableAura()

    assert.strictEqual(aura.get_belief_rerank_mode(), BeliefRerankMode.Limited)
    assert.strictEqual(aura.get_concept_surface_mode(), ConceptSurfaceMode.Inspect)
    assert.strictEqual(aura.get_causal_rerank_mode(), CausalRerankMode.Limited)
    assert.strictEqual(aura.get_policy_rerank_mode(), PolicyRerankMode.Limited)
    assert.strictEqual(aura.get_causal_temporal_budget_mode(), TemporalBudgetMode.NearbySuccessors)
    assert.strictEqual(aura.get_causal_evidence_mode(), EvidenceMode.StrictRepeatedWindows)

    aura.disable_full_cognitive_stack()
    assert.strictEqual(aura.get_belief_rerank_mode(), BeliefRerankMode.Off)
    assert.strictEqual(aura.get_concept_surface_mode(), ConceptSurfaceMode.Off)
    assert.strictEqual(aura.get_causal_rerank_mode(), CausalRerankMode.Off)
    assert.strictEqual(aura.get_policy_rerank_mode(), PolicyRerankMode.Off)
    assert.strictEqual(aura.is_belief_rerank_enabled(), false)

    aura.set_belief_rerank_mode("shadow")
    aura.set_concept_surface_mode("inspect")
    aura.set_causal_rerank_mode("limited")
    aura.set_policy_rerank_mode("limited")
    aura.set_causal_temporal_budget_mode("exhaustive_capped")
    aura.set_causal_evidence_mode("temporal_cluster_recovery")
    assert.strictEqual(aura.get_belief_rerank_mode(), BeliefRerankMode.Shadow)
    assert.strictEqual(aura.get_concept_surface_mode(), ConceptSurfaceMode.Inspect)
    assert.strictEqual(aura.get_causal_rerank_mode(), CausalRerankMode.Limited)
    assert.strictEqual(aura.get_policy_rerank_mode(), PolicyRerankMode.Limited)
    assert.strictEqual(aura.get_causal_temporal_budget_mode(), TemporalBudgetMode.ExhaustiveCapped)
    assert.strictEqual(aura.get_causal_evidence_mode(), EvidenceMode.TemporalClusterRecovery)

    aura.set_belief_rerank_mode("unknown")
    aura.set_concept_surface_mode("unknown")
    aura.set_causal_rerank_mode("unknown")
    aura.set_policy_rerank_mode("unknown")
    aura.set_causal_temporal_budget_mode("unknown")
    aura.set_causal_evidence_mode("unknown")
    assert.strictEqual(aura.get_belief_rerank_mode(), BeliefRerankMode.Off)
    assert.strictEqual(aura.get_concept_surface_mode(), ConceptSurfaceMode.Off)
    assert.strictEqual(aura.get_causal_rerank_mode(), CausalRerankMode.Off)
    assert.strictEqual(aura.get_policy_rerank_mode(), PolicyRerankMode.Off)
    assert.strictEqual(aura.get_causal_temporal_budget_mode(), TemporalBudgetMode.NearbySuccessors)
    assert.strictEqual(aura.get_causal_evidence_mode(), EvidenceMode.StrictRepeatedWindows)

    aura.enable_full_cognitive_stack()
    assert.strictEqual(aura.get_belief_rerank_mode(), BeliefRerankMode.Limited)
    assert.strictEqual(aura.get_concept_surface_mode(), ConceptSurfaceMode.Limited)
    assert.strictEqual(aura.get_causal_rerank_mode(), CausalRerankMode.Limited)
    assert.strictEqual(aura.get_policy_rerank_mode(), PolicyRerankMode.Limited)
    assert.strictEqual(aura.get_causal_evidence_mode(), EvidenceMode.ExplicitTrusted)
    assert.strictEqual(aura.is_belief_rerank_enabled(), true)
  })

  it("set_trust_config mirrors Rust config state and feeds recall trace scoring", async () => {
    const aura = await openWritableAura()
    aura.disable_full_cognitive_stack()
    const record = await Effect.runPromise(provideNode(aura.store("trust config alpha recall", {
      namespace: "default",
      tags: ["trust", "alpha"],
      metadata: {
        source: "user-confirmed",
        trust_score: "1",
      },
    })))

    const config = {
      source_trust: { "user-confirmed": 1 },
      source_authority: { "user-confirmed": 0.1 },
      recency_boost_max: 0,
      recency_half_life_days: 7,
    }
    aura.set_trust_config(config)
    config.source_authority["user-confirmed"] = 1.2
    assert.strictEqual(aura.get_trust_config().source_authority["user-confirmed"], 0.1)

    const returned = aura.get_trust_config()
    returned.source_authority["user-confirmed"] = 1.2
    assert.strictEqual(aura.get_trust_config().source_authority["user-confirmed"], 0.1)

    const explanation = await Effect.runPromise(provideNode(
      Effect.provide(aura.explain_recall("trust config alpha", 5, 0, false, ["default"]), governanceLayer({}))
    ))
    const item = explanation.items.find((candidate) => candidate.record_id === record.id)
    if (item === undefined) throw new Error("trust-config recall item missing")
    assert.ok(Math.abs(item.trace.trust_multiplier - 0.1) < 0.0001)
  })

  it("set_taxonomy mirrors Rust clone semantics and feeds store guards", async () => {
    const aura = await openWritableAura()
    const taxonomy = StoreTrust.createDefaultTagTaxonomy()
    const identity_tags = new Set(taxonomy.identity_tags)
    const stable_tags = new Set(taxonomy.stable_tags)
    const sensitive_tags = new Set(taxonomy.sensitive_tags)
    identity_tags.add("medical-id")
    stable_tags.add("stable-custom")
    sensitive_tags.add("needs-review")

    aura.set_taxonomy({
      ...taxonomy,
      identity_tags,
      stable_tags,
      sensitive_tags,
    })
    identity_tags.add("mutated-after-set")
    stable_tags.delete("stable-custom")
    sensitive_tags.delete("needs-review")

    const configured = aura.get_taxonomy()
    assert.strictEqual(configured.identity_tags.has("medical-id"), true)
    assert.strictEqual(configured.identity_tags.has("mutated-after-set"), false)
    assert.strictEqual(configured.stable_tags.has("stable-custom"), true)
    assert.strictEqual(configured.sensitive_tags.has("needs-review"), true)

    const exposedIdentityTags = configured.identity_tags as Set<string>
    exposedIdentityTags.add("mutated-after-get")
    assert.strictEqual(aura.get_taxonomy().identity_tags.has("mutated-after-get"), false)

    const record = await Effect.runPromise(provideNode(aura.store_with_channel(
      "custom taxonomy record without automatic sensitive content",
      {
        tags: ["needs-review", "stable-custom"],
        channel: "agent",
        auto_promote: false,
        deduplicate: false,
      },
    )))
    assert.strictEqual(record.metadata.actionable, "false")
    assert.strictEqual(record.metadata.volatility, "stable")
  })

  it("recall_at runs temporal recall over records created at or before the timestamp", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-recall-at-"))
    const aura = await openWritableAuraIn(brainPath)
    const oldRecord = await Effect.runPromise(provideNodeAt(aura.store("temporal alpha old knowledge", {
      namespace: "default",
      tags: ["temporal", "alpha"],
    }), 1_000))
    const futureRecord = await Effect.runPromise(provideNodeAt(aura.store("temporal alpha future knowledge", {
      namespace: "default",
      tags: ["temporal", "alpha"],
    }), 2_000))

    const beforeFuture = await Effect.runPromise(provideNodeAt(
      aura.recall_at("temporal alpha knowledge", 1_500, 10, 0, false, "temporal-session", ["default"]),
      3_000,
    ))
    assert.deepStrictEqual(beforeFuture.map(([, record]) => record.id), [oldRecord.id])

    const afterFuture = await Effect.runPromise(provideNodeAt(
      aura.recall_at("temporal alpha knowledge", 2_500, 10, 0, false, undefined, ["default"]),
      3_000,
    ))
    assert.deepStrictEqual(afterFuture.map(([, record]) => record.id).sort(), [oldRecord.id, futureRecord.id].sort())

    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.get(oldRecord.id)?.activation_count, 2)
    assert.strictEqual(persisted.get(futureRecord.id)?.activation_count, 1)
  })

  it("end_session applies Rust SessionTracker coactivation consolidation", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-end-session-"))
    const aura = await openWritableAuraIn(brainPath)
    const first = await Effect.runPromise(provideNode(aura.store("session coactivation alpha first", {
      namespace: "default",
    })))
    const second = await Effect.runPromise(provideNode(aura.store("session coactivation alpha second", {
      namespace: "default",
    })))

    const scored = await Effect.runPromise(provideNodeAt(aura.recall_structured("session coactivation alpha", {
      topK: 2,
      minStrength: 0,
      expandConnections: false,
      sessionId: "session-1",
      namespaces: ["default"],
    }), 4_000))
    const recalledIds = scored.map(([, record]) => record.id)
    assert.ok(recalledIds.includes(first.id))
    assert.ok(recalledIds.includes(second.id))

    const beforeEnd = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(beforeEnd.get(first.id)?.connection_types[second.id], undefined)

    const stats = await Effect.runPromise(provideNode(aura.end_session("session-1")))
    assert.deepStrictEqual(stats, { pairs_strengthened: 1, session_records: 2 })

    const afterEnd = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(afterEnd.get(first.id)?.connection_types[second.id], "coactivation")
    assert.strictEqual(afterEnd.get(second.id)?.connection_types[first.id], "coactivation")
    assert.ok((afterEnd.get(first.id)?.connections[second.id] ?? 0) > 0.05)
    assert.ok((afterEnd.get(second.id)?.connections[first.id] ?? 0) > 0.05)

    const repeated = await Effect.runPromise(provideNode(aura.end_session("session-1")))
    assert.deepStrictEqual(repeated, {})
  })

  it("decay and reflect persist Rust-aligned maintenance mutations", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-decay-reflect-"))
    const aura = await openWritableAuraIn(brainPath)
    const live = await Effect.runPromise(provideNode(aura.store("decay live memory", {
      namespace: "default",
      tags: ["decay"],
    })))
    const weak = await Effect.runPromise(provideNode(aura.store("decay weak memory", {
      namespace: "default",
      tags: ["decay"],
    })))
    await Effect.runPromise(provideNode(aura.update(weak.id, { strength: 0.04 })))

    const [decayed, archived] = await Effect.runPromise(provideNode(aura.decay()))
    assert.strictEqual(decayed, 2)
    assert.strictEqual(archived, 1)
    const afterDecay = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.ok(Math.abs((afterDecay.get(live.id)?.strength ?? 0) - 0.8) < 0.0001)
    assert.strictEqual(afterDecay.has(weak.id), false)
    assert.strictEqual(aura.get(weak.id), null)

    const promotable = await Effect.runPromise(provideNode(aura.store("reflect promotable memory", {
      namespace: "default",
      tags: ["reflect"],
    })))
    const dead = await Effect.runPromise(provideNode(aura.store("reflect dead memory", {
      namespace: "default",
      tags: ["reflect"],
    })))
    const hub = await Effect.runPromise(provideNode(aura.store("reflect hub memory", {
      namespace: "default",
      tags: ["reflect"],
    })))
    const hubConnections = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`hub-peer-${index}`, 0.4])
    )
    await Effect.runPromise(provideNode(Effect.gen(function* () {
      const store = yield* CognitiveStoreFile.open(brainPath)
      yield* store.appendUpdate({ ...promotable, activation_count: 5, strength: 0.8 })
      yield* store.appendUpdate({ ...hub, strength: 0.6, connections: hubConnections })
      yield* store.appendUpdate({ ...dead, strength: 0.04 })
      yield* store.flush()
    })))

    const reflect = await Effect.runPromise(provideNode(aura.reflect()))
    assert.deepStrictEqual(reflect, { promoted: 2, archived: 1 })
    const afterReflect = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(afterReflect.get(promotable.id)?.level, Level.Decisions)
    assert.strictEqual(afterReflect.get(hub.id)?.level, Level.Decisions)
    assert.strictEqual(afterReflect.has(dead.id), false)
    assert.strictEqual(aura.get(promotable.id)?.level, Level.Decisions)
    assert.strictEqual(aura.get(hub.id)?.level, Level.Decisions)
  })

  it("reports Rust-shaped startup validation fallbacks on open", async () => {
    const aura = await openWritableAura()
    const report = aura.get_startup_validation_report()
    const event = (surface: string, status?: string) =>
      report.events.find((item) => item.surface === surface && (status === undefined || item.status === status))

    assert.strictEqual(report.loaded_surfaces, 2)
    assert.strictEqual(report.missing_fallbacks, 7)
    assert.strictEqual(report.recovered_fallbacks, 0)
    assert.strictEqual(report.derived_skips, 0)
    assert.strictEqual(report.has_recovery_warnings, true)

    assert.strictEqual(event("records", "loaded")?.detail, "loaded 0 records")
    assert.strictEqual(event("belief", "missing_fallback")?.recovered, true)
    assert.strictEqual(event("concept", "missing_fallback")?.recovered, false)
    assert.strictEqual(event("causal", "missing_fallback")?.recovered, true)
    assert.strictEqual(event("policy", "missing_fallback")?.recovered, true)
    assert.strictEqual(event("persistence_manifest", "missing_fallback")?.recovered, true)
    assert.strictEqual(event("persistence_manifest", "loaded")?.detail, "loaded current persistence manifest")
    assert.strictEqual(event("maintenance_trends", "missing_fallback")?.recovered, true)
    assert.strictEqual(event("reflection_summaries", "missing_fallback")?.recovered, true)
  })

  it("reports startup validation recovery for corrupt persisted surfaces", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-startup-corrupt-"))
    await Effect.runPromise(provideNode(BrainAuraFile.open(brainPath).pipe(Effect.flatMap((file) => file.flush()))))
    fs.writeFileSync(path.join(brainPath, "policies.cog"), "{ not valid json")
    fs.writeFileSync(path.join(brainPath, "maintenance_trends.json"), "{ not valid json")
    fs.writeFileSync(path.join(brainPath, "reflection_summaries.json"), "{ not valid json")

    const aura = await Effect.runPromise(provideNode(Aura.open(brainPath)))
    const report = aura.get_startup_validation_report()
    const health = await Effect.runPromise(Effect.provide(aura.memory_health(5), governanceLayer({})))

    assert.strictEqual(report.has_recovery_warnings, true)
    assert.ok(report.recovered_fallbacks >= 3)
    assert.ok(report.events.some((event) =>
      event.surface === "policy" &&
      event.status === "load_error_fallback" &&
      event.recovered
    ))
    assert.ok(report.events.some((event) =>
      event.surface === "maintenance_trends" &&
      event.status === "load_error_fallback" &&
      event.recovered
    ))
    assert.ok(report.events.some((event) =>
      event.surface === "reflection_summaries" &&
      event.status === "load_error_fallback" &&
      event.recovered
    ))
    assert.strictEqual(aura.get_maintenance_trend_history().length, 0)
    assert.strictEqual(aura.get_reflection_summaries(8).length, 0)
    assert.strictEqual(health.startup_has_recovery_warnings, true)
  })

  it("exposes Rust-shaped maintenance trend and reflection history", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-maintenance-history-"))
    await Effect.runPromise(provideNode(BrainAuraFile.open(brainPath).pipe(Effect.flatMap((file) => file.flush()))))

    await Effect.runPromise(provideNode(MaintenanceTrendsFile.new(brainPath).save([
      {
        timestamp: "2026-05-30T00:00:00.000Z",
        total_records: 2,
        records_archived: 0,
        insights_found: 1,
        volatile_records: 1,
        belief_churn: 0.25,
        causal_rejection_rate: 0.1,
        policy_suppression_rate: 0.2,
        feedback_beliefs_touched: 1,
        feedback_net_confidence_delta: 0.05,
        feedback_net_volatility_delta: -0.02,
        correction_events: 1,
        cumulative_corrections: 3,
        cycle_time_ms: 12,
        dominant_phase: "belief",
      },
      {
        timestamp: "2026-05-31T00:00:00.000Z",
        total_records: 3,
        records_archived: 1,
        insights_found: 2,
        volatile_records: 0,
        belief_churn: 0.1,
        causal_rejection_rate: 0,
        policy_suppression_rate: 0,
        feedback_beliefs_touched: 0,
        feedback_net_confidence_delta: 0,
        feedback_net_volatility_delta: 0,
        correction_events: 0,
        cumulative_corrections: 3,
        cycle_time_ms: 8,
        dominant_phase: "policy",
      },
    ])))

    await Effect.runPromise(provideNode(ReflectionSummariesFile.new(brainPath).save([
      {
        timestamp: "2026-05-29T00:00:00.000Z",
        digest: "old",
        dominant_phase: "old-phase",
        report: {
          jobs_run: 3,
          blocker_findings: 0,
          contradiction_findings: 0,
          trend_findings: 1,
          total_findings: 99,
          capped: false,
        },
        findings: [
          {
            kind: "trend",
            namespace: "old-ns",
            title: "old finding",
            detail: "old",
            related_ids: ["old"],
            score: 0.1,
            severity: "low",
          },
        ],
      },
      {
        timestamp: "2026-05-30T00:00:00.000Z",
        digest: "mid",
        dominant_phase: "mid-phase",
        report: {
          jobs_run: 3,
          blocker_findings: 1,
          contradiction_findings: 0,
          trend_findings: 0,
          total_findings: 99,
          capped: false,
        },
        findings: [
          {
            kind: "blocker",
            namespace: "alpha",
            title: "mid blocker",
            detail: "mid",
            related_ids: ["mid"],
            score: 0.4,
            severity: "low",
          },
        ],
      },
      {
        timestamp: "2026-05-31T00:00:00.000Z",
        digest: "latest",
        dominant_phase: "latest-phase",
        report: {
          jobs_run: 3,
          blocker_findings: 1,
          contradiction_findings: 0,
          trend_findings: 1,
          total_findings: 99,
          capped: false,
        },
        findings: [
          {
            kind: "blocker",
            namespace: "beta",
            title: "B blocker",
            detail: "new blocker",
            related_ids: ["new-b"],
            score: 0.9,
            severity: "high",
          },
          {
            kind: "trend",
            namespace: "alpha",
            title: "A trend",
            detail: "new trend",
            related_ids: ["new-a"],
            score: 0.9,
            severity: "medium",
          },
        ],
      },
    ])))

    const aura = await Effect.runPromise(provideNode(Aura.open(brainPath)))

    const manifest = aura.get_persistence_manifest()
    assert.strictEqual(manifest.schema_version, 1)
    assert.strictEqual(manifest.surfaces.maintenance_trends, 1)
    assert.strictEqual(manifest.surfaces.reflection_summaries, 1)

    const startup = aura.get_startup_validation_report()
    assert.strictEqual(startup.events.find((event) => event.surface === "maintenance_trends")?.status, "loaded")
    assert.strictEqual(startup.events.find((event) => event.surface === "reflection_summaries")?.status, "loaded")

    const trends = aura.get_maintenance_trend_history()
    assert.strictEqual(trends.length, 2)
    assert.strictEqual(trends[0]?.total_records, 2)
    assert.strictEqual(trends[1]?.dominant_phase, "policy")

    const latestFirst = aura.get_reflection_summaries(2)
    assert.deepStrictEqual(latestFirst.map((summary) => summary.digest), ["latest", "mid"])
    assert.strictEqual(aura.get_latest_reflection_digest()?.digest, "latest")

    const digest = aura.get_reflection_digest(2)
    assert.strictEqual(digest.summary_count, 2)
    assert.strictEqual(digest.total_findings, 3)
    assert.strictEqual(digest.high_severity_findings, 1)
    assert.strictEqual(digest.latest_dominant_phase, "latest-phase")
    assert.deepStrictEqual(digest.namespaces, ["alpha", "beta"])
    assert.deepStrictEqual(digest.top_findings.map((finding) => finding.title), [
      "A trend",
      "B blocker",
      "mid blocker",
    ])
  })

  it("recall shadow and rerank report methods use raw baseline then finalize", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-rerank-report-"))
    const aura = await openWritableAuraIn(brainPath)
    const stored = []
    for (let i = 0; i < 4; i++) {
      stored.push(await Effect.runPromise(provideNode(aura.store(`alpha report shared evidence ${i}`, {
        namespace: "default",
        tags: ["alpha", "report"],
        semantic_type: "fact",
        deduplicate: false,
      }))))
    }
    const target = stored[3]!
    await Effect.runPromise(provideNode(BeliefStoreFile.new(brainPath).save({
      version: 1,
      beliefs: {
        "belief-target": makeBelief("belief-target", "default:alpha:report", BeliefState.Resolved, 0.05, 1),
      },
      hypotheses: {},
      record_to_belief: { [target.id]: "belief-target" },
      key_index: { "default:alpha:report": "belief-target" },
      record_index: { [target.id]: "belief-target" },
    })))

    const [shadowHits, shadowReport] = await Effect.runPromise(provideNode(
      aura.recall_structured_with_shadow("alpha report", 10, 0, false, "shadow-session", ["default"])
    ))
    assert.ok(shadowHits.some(([, record]) => record.id === target.id))
    assert.strictEqual(shadowReport.scores.length, shadowHits.length)
    assert.ok(shadowReport.belief_coverage > 0)

    const [rerankedHits, rerankReport] = await Effect.runPromise(provideNode(
      aura.recall_structured_with_rerank_report("alpha report", 10, 0, false, "rerank-session", ["default"])
    ))
    assert.ok(rerankedHits.some(([, record]) => record.id === target.id))
    assert.strictEqual(rerankReport.was_applied, true)
    assert.ok(rerankReport.belief_coverage > 0)
  })

  it("store_code and store_decision are thin store wrappers with Rust-aligned defaults", async () => {
    const aura = await openWritableAura()

    const code = await Effect.runPromise(provideNode(aura.store_code({
      language: "ts",
      code: "export const answer = 42",
      filename: "answer.ts",
      namespace: "dev",
    })))
    const decision = await Effect.runPromise(provideNode(aura.store_decision({
      decision: "Use typed unsupported errors",
      reasoning: "MCP callers need recoverable failures",
      alternatives: ["Effect.die", "dummy success"],
    })))

    assert.strictEqual(code.level, Level.Domain)
    assert.strictEqual(code.content_type, "code")
    assert.deepStrictEqual(code.tags, ["code", "ts", "file:answer.ts"])
    assert.include(code.content, "```ts")

    assert.strictEqual(decision.level, Level.Decisions)
    assert.strictEqual(decision.semantic_type, "decision")
    assert.include(decision.content, "DECISION: Use typed unsupported errors")
    assert.include(decision.tags, "decision")

    assert.strictEqual(aura.search({ namespace: "dev", content_type: "code" }).length, 1)
    assert.strictEqual(aura.stats().domain, 1)
    assert.strictEqual(aura.insights().decisions, 1)
  })

  it("store defaults semantic_type to fact and auto-connects same-namespace shared tags", async () => {
    const aura = await openWritableAura()

    const first = await Effect.runPromise(provideNode(aura.store("first MCP parity record", {
      namespace: "alpha",
      tags: ["phase07"],
    })))
    const second = await Effect.runPromise(provideNode(aura.store("second MCP parity record", {
      namespace: "alpha",
      tags: ["phase07"],
    })))
    const third = await Effect.runPromise(provideNode(aura.store("third MCP parity record", {
      namespace: "alpha",
      tags: ["phase07"],
    })))
    await Effect.runPromise(provideNode(aura.store("beta MCP parity record", {
      namespace: "beta",
      tags: ["phase07"],
    })))

    assert.strictEqual(first.semantic_type, "fact")
    assert.strictEqual(first.source_type, "recorded")
    assert.strictEqual(first.activation_velocity, 0)
    assert.strictEqual(first.salience, 0)
    assert.strictEqual(first.confidence, 0.9)
    assert.strictEqual(first.support_mass, 0)
    assert.strictEqual(first.conflict_mass, 0)
    assert.strictEqual(first.volatility, 0)

    const generated = await Effect.runPromise(provideNode(aura.store("generated MCP parity record", {
      namespace: "gamma",
      source_type: "generated",
    })))
    assert.strictEqual(generated.confidence, 0.5)

    const records = new Map(
      aura.search({ namespace: "alpha", tags: ["phase07"], limit: 10 })
        .map((record) => [record.id, record]),
    )
    const firstView = records.get(first.id)!
    const secondView = records.get(second.id)!
    const thirdView = records.get(third.id)!

    assert.strictEqual(records.size, 3)
    assert.strictEqual(firstView.connections[second.id], 0.35)
    assert.strictEqual(firstView.connections[third.id], 0.35)
    assert.strictEqual(secondView.connections[first.id], 0.35)
    assert.strictEqual(secondView.connections[third.id], 0.35)
    assert.strictEqual(thirdView.connections[first.id], 0.35)
    assert.strictEqual(thirdView.connections[second.id], 0.35)
    assert.strictEqual(firstView.connection_types[second.id], "associative")
    assert.strictEqual(secondView.connection_types[third.id], "associative")
    assert.strictEqual(aura.stats().total_connections, 6)
  })

  it("store_with_channel persists brain.aura, SDR index, and aura_id", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-store-write-"))
    const aura = await Effect.runPromise(provideNodeAt(Aura.open(brainPath), 1_700_000_000))

    const record = await Effect.runPromise(provideNodeAt(aura.store("indexed alpha storage closure", {
      namespace: "alpha",
      level: Level.Domain,
      tags: ["indexed", "alpha"],
      pin: true,
    }), 1_700_000_123))

    assert.strictEqual(record.aura_id, record.id)
    assert.strictEqual(aura.listRecords().length, 1)

    const parsed = readBrainAuraFile(fs.readFileSync(path.join(brainPath, "brain.aura")))
    assert.strictEqual(parsed.header.count, 1n)
    const stored = parsed.records[0]!
    assert.strictEqual(stored.id, record.id)
    assert.strictEqual(stored.dna, "user_core")
    assert.strictEqual(stored.text, "indexed alpha storage closure")
    assert.strictEqual(stored.stability, 100)
    assert.ok(stored.sdr_indices.length > 0)

    const cognitive = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(cognitive.get(record.id)?.aura_id, record.id)

    const index = await Effect.runPromise(InvertedIndex.load(path.join(brainPath, "index")).pipe(
      Effect.provide(NodeFileReadLive)
    ))
    const hits = index.searchScored(stored.sdr_indices, 10, 1)
    assert.strictEqual(hits[0]?.[0], record.id)
  })

  it("store_with_channel deduplicates strong same-namespace text matches like Rust", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-store-dedup-"))
    const aura = await Effect.runPromise(provideNodeAt(Aura.open(brainPath), 1_700_000_000))
    const content = "deduplicate alpha memory with enough shared text for rust threshold"

    const first = await Effect.runPromise(provideNodeAt(aura.store(content, {
      namespace: "alpha",
      tags: ["original"],
    }), 1_700_000_010))
    const duplicate = await Effect.runPromise(provideNodeAt(aura.store(content, {
      namespace: "alpha",
      tags: ["merged"],
    }), 1_700_000_020))

    assert.strictEqual(duplicate.id, first.id)
    assert.strictEqual(aura.listRecords().length, 1)
    const active = aura.get(first.id)!
    assert.strictEqual(active.activation_count, 1)
    assert.deepStrictEqual(new Set(active.tags), new Set(["original", "merged"]))

    const parsed = readBrainAuraFile(fs.readFileSync(path.join(brainPath, "brain.aura")))
    assert.strictEqual(parsed.header.count, 1n)
    const cognitive = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(cognitive.size, 1)
    assert.strictEqual(cognitive.get(first.id)?.activation_count, 1)

    const crossNamespace = await Effect.runPromise(provideNodeAt(aura.store(content, {
      namespace: "beta",
      tags: ["merged"],
    }), 1_700_000_030))
    assert.notStrictEqual(crossNamespace.id, first.id)
    assert.strictEqual(aura.listRecords().length, 2)

    const viaMergedTag = await Effect.runPromise(provideNodeAt(aura.store_with_channel(
      "fresh alpha record connected only if dedup tag index is rebuilt",
      {
        namespace: "alpha",
        tags: ["merged"],
        auto_promote: false,
        deduplicate: false,
      },
    ), 1_700_000_040))
    assert.strictEqual(viaMergedTag.connections[first.id], undefined)

    const multibyte = "多字节重复内容123"
    assert.ok(multibyte.length < 20)
    assert.ok(new TextEncoder().encode(multibyte).byteLength >= 20)
    const multibyteFirst = await Effect.runPromise(provideNodeAt(aura.store(multibyte, {
      namespace: "gamma",
      tags: ["utf8"],
    }), 1_700_000_050))
    const multibyteDuplicate = await Effect.runPromise(provideNodeAt(aura.store(multibyte, {
      namespace: "gamma",
      tags: ["utf8-duplicate"],
    }), 1_700_000_060))
    assert.strictEqual(multibyteDuplicate.id, multibyteFirst.id)
  })

  it("store_with_channel stamps guard provenance, surprise-promotes, and links causal parent", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-store-guards-"))
    const aura = await Effect.runPromise(provideNodeAt(Aura.open(brainPath), 1_700_000_000))

    const parent = await Effect.runPromise(provideNodeAt(aura.store_with_channel("parent causal anchor memory for store guard test", {
      namespace: "alpha",
      tags: ["parent-anchor"],
      auto_promote: false,
      deduplicate: false,
    }), 1_700_000_001))
    for (let i = 0; i < 4; i += 1) {
      await Effect.runPromise(provideNodeAt(aura.store_with_channel(`baseline unrelated memory ${i} for surprise gate`, {
        namespace: "alpha",
        tags: [`baseline-${i}`],
        auto_promote: false,
        deduplicate: false,
      }), 1_700_000_010 + i))
    }

    const novel = await Effect.runPromise(provideNodeAt(aura.store("z", {
      namespace: "alpha",
      level: Level.Working,
    }), 1_700_000_090))
    assert.strictEqual(novel.level, Level.Decisions)

    const child = await Effect.runPromise(provideNodeAt(aura.store_with_channel(
      "Reach me at test@example.com and rotate api_key: abcdefghijklmnopqrstuvwxyz1234",
      {
        namespace: "alpha",
        tags: ["child"],
        caused_by_id: parent.id,
        channel: "telegram",
        auto_promote: false,
      },
    ), 1_700_000_100))

    assert.strictEqual(child.level, Level.Working)
    assert.ok(child.tags.includes("contact"))
    assert.ok(child.tags.includes("credential"))
    assert.strictEqual(child.metadata.source, "user-telegram")
    assert.strictEqual(child.metadata.verified, "true")
    assert.strictEqual(child.metadata.trust_score, "0.50")
    assert.strictEqual(child.metadata.volatility, "stable")
    assert.strictEqual(child.metadata.timestamp, new Date(1_700_000_100 * 1000).toISOString())
    assert.strictEqual(child.metadata.actionable, "true")
    assert.strictEqual(child.caused_by_id, parent.id)
    assert.strictEqual(child.connections[parent.id], 0.7)
    assert.strictEqual(child.connection_types[parent.id], "causal")

    const parentLive = aura.get(parent.id)!
    assert.strictEqual(parentLive.connections[child.id], 0.7)
    assert.strictEqual(parentLive.connection_types[child.id], "causal")

    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.get(child.id)?.connections[parent.id], 0.7)
    assert.strictEqual(persisted.get(parent.id)?.connections[child.id], undefined)
  })

  it("basic read facades mirror Rust PyO3 get/count/namespace/history semantics", async () => {
    const aura = await openWritableAura()
    const alpha = await Effect.runPromise(provideNode(aura.store("alpha tagged record", {
      namespace: "alpha",
      level: Level.Domain,
      tags: ["shared", "alpha-only"],
      metadata: { salience_reason: "operator boost" },
    })))
    const beta = await Effect.runPromise(provideNode(aura.store("beta tagged record", {
      namespace: "beta",
      level: Level.Working,
      tags: ["shared", "beta-only"],
    })))
    const defaultRecord = await Effect.runPromise(provideNode(aura.store("default tagged record", {
      tags: ["default-only"],
    })))

    const fetchedAlpha = aura.get(alpha.id)
    assert.strictEqual(fetchedAlpha?.id, alpha.id)
    fetchedAlpha!.content = "mutated outside Aura"
    assert.strictEqual(aura.get(alpha.id)?.content, "alpha tagged record")
    assert.strictEqual(aura.get("missing"), null)
    assert.strictEqual(aura.count(), 3)
    assert.strictEqual(aura.count(Level.Domain), 1)
    assert.deepStrictEqual(aura.list_namespaces(), ["alpha", "beta", "default"])
    assert.deepStrictEqual(aura.namespace_stats(), { alpha: 1, beta: 1, default: 1 })

    const anyTagMatches = aura.search({
      tags: ["alpha-only", "beta-only"],
      namespaces: ["alpha", "beta", "default"],
      limit: 10,
    })
    assert.deepStrictEqual(new Set(anyTagMatches.map((record) => record.id)), new Set([alpha.id, beta.id]))
    assert.ok(!anyTagMatches.some((record) => record.id === defaultRecord.id))

    const history = await Effect.runPromise(aura.history(alpha.id))
    assert.strictEqual(history.id, alpha.id)
    assert.strictEqual(history.level, "DOMAIN")
    assert.strictEqual(history.strength, alpha.strength.toFixed(4))
    assert.strictEqual(history.activation_count, String(alpha.activation_count))
    assert.strictEqual(history.namespace, "alpha")
    assert.strictEqual(history.source_type, "recorded")
    assert.strictEqual(history.tags, "shared, alpha-only")
    assert.strictEqual(history.salience, "0.0000")
    assert.strictEqual(history.salience_reason, "operator boost")
    assert.strictEqual(history.connections, "0")

    await expect(Effect.runPromise(aura.history("missing"))).rejects.toMatchObject({
      _tag: "RecordNotFoundError",
      recordId: "missing",
    })
  })

  it("move_record mirrors Rust namespace move and connection pruning semantics", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-move-record-"))
    await Effect.runPromise(provideNode(Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(brainPath)
      yield* brain.flush()
      const store = yield* CognitiveStoreFile.open(brainPath)
      const makeRecord = (
        id: string,
        namespace: string,
        connections: Record<string, number>,
        connectionTypes: Record<string, string>,
      ) => ({
        id,
        content: `${id} content`,
        level: Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: 1,
        last_activated: 1,
        tags: [],
        connections,
        connection_types: connectionTypes,
        content_type: "text",
        source_type: "recorded",
        namespace,
        semantic_type: "fact",
        activation_velocity: 0,
        salience: 0,
        metadata: {},
        aura_id: null,
        caused_by_id: null,
        confidence: 0.9,
        support_mass: 0,
        conflict_mass: 0,
        volatility: 0,
      })

      yield* store.appendStore(makeRecord(
        "move-me",
        "alpha",
        { "alpha-peer": 0.7, "beta-peer": 0.9 },
        { "alpha-peer": "associative", "beta-peer": "causal" },
      ))
      yield* store.appendStore(makeRecord(
        "alpha-peer",
        "alpha",
        { "move-me": 0.7 },
        { "move-me": "associative" },
      ))
      yield* store.appendStore(makeRecord(
        "beta-peer",
        "beta",
        { "move-me": 0.9 },
        { "move-me": "causal" },
      ))
      yield* store.flush()
    })))

    const aura = await Effect.runPromise(provideNode(Aura.open(brainPath)))

    assert.strictEqual(await Effect.runPromise(provideNode(aura.move_record("move-me", "ns/path"))), null)
    assert.strictEqual(aura.get("move-me")?.namespace, "alpha")
    assert.strictEqual(await Effect.runPromise(provideNode(aura.move_record("missing", "beta"))), null)

    const moved = await Effect.runPromise(provideNode(aura.move_record("move-me", "beta")))
    if (moved === null) throw new Error("expected move_record to return moved record")

    assert.strictEqual(moved.namespace, "beta")
    assert.strictEqual(moved.connections["alpha-peer"], undefined)
    assert.strictEqual(moved.connections["beta-peer"], 0.9)
    assert.strictEqual(moved.connection_types["alpha-peer"], "associative")
    moved.content = "mutated outside Aura"
    assert.strictEqual(aura.get("move-me")?.content, "move-me content")

    const alphaPeer = aura.get("alpha-peer")
    const betaPeer = aura.get("beta-peer")
    assert.strictEqual(alphaPeer?.connections["move-me"], undefined)
    assert.strictEqual(alphaPeer?.connection_types["move-me"], "associative")
    assert.strictEqual(betaPeer?.connections["move-me"], 0.9)
    assert.deepStrictEqual(aura.list_namespaces(), ["alpha", "beta", "default"])
    assert.deepStrictEqual(aura.namespace_stats(), { alpha: 1, beta: 2 })

    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.get("move-me")?.namespace, "beta")
    assert.strictEqual(persisted.get("move-me")?.connections["alpha-peer"], undefined)
    assert.strictEqual(persisted.get("move-me")?.connections["beta-peer"], 0.9)
  })

  it("open migrates legacy deserialized confidence to source_type defaults", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-legacy-confidence-"))
    await Effect.runPromise(provideNode(Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(brainPath)
      yield* brain.flush()
      const store = yield* CognitiveStoreFile.open(brainPath)
      yield* store.appendStore({
        id: "legacy_retrieved",
        content: "legacy retrieved memory",
        level: Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: 1,
        last_activated: 1,
        tags: [],
        connections: {},
        connection_types: {},
        content_type: "text",
        source_type: "retrieved",
        namespace: "default",
        semantic_type: "fact",
        metadata: {},
      })
      yield* store.flush()
    })))

    const aura = await Effect.runPromise(provideNode(Aura.open(brainPath)))
    const opened = aura.listCognitiveRecords().find((record) => record.id === "legacy_retrieved")
    assert.strictEqual(opened?.confidence, 0.75)

    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.get("legacy_retrieved")?.confidence, 0.75)
  })

  it("search is owned by Aura and refreshes through store/update/connect/delete mutations", async () => {
    const aura = await openWritableAura()

    const alpha = await Effect.runPromise(provideNode(aura.store("alpha durable memory", {
      namespace: "default",
      tags: ["alpha"],
      content_type: "note",
      source_type: "retrieved",
      semantic_type: "fact",
    })))
    const beta = await Effect.runPromise(provideNode(aura.store("beta durable memory", {
      namespace: "default",
      tags: ["beta"],
      content_type: "note",
      source_type: "retrieved",
      semantic_type: "fact",
    })))
    await Effect.runPromise(provideNode(aura.store("ops-only memory", { namespace: "ops", tags: ["alpha"] })))

    await Effect.runPromise(provideNode(aura.update(alpha.id, { strength: 0.10, content: "alpha updated memory" })))
    await Effect.runPromise(provideNode(aura.update(beta.id, { strength: 0.90 })))
    await Effect.runPromise(provideNode(aura.connect(beta.id, alpha.id, 0.75)))

    const defaultAlpha = aura.search({ query: "memory", tags: ["alpha"], namespace: "default" })
    assert.strictEqual(defaultAlpha.length, 1)
    assert.strictEqual(defaultAlpha[0]!.id, alpha.id)

    const ordered = aura.search({ query: "memory", namespace: "default", limit: 2 })
    assert.strictEqual(ordered[0]!.id, beta.id)
    assert.strictEqual(aura.stats().total_connections, 2)

    assert.strictEqual(aura.search({ tags: ["alpha"] }).length, 1)
    assert.strictEqual(aura.search({ tags: ["alpha"], namespace: "ops" }).length, 1)

    await Effect.runPromise(provideNode(aura.delete(alpha.id)))
    assert.strictEqual(aura.search({ query: "alpha", namespace: "default" }).length, 0)
    const betaAfterDelete = aura.listCognitiveRecords().find((record) => record.id === beta.id)!
    assert.strictEqual(betaAfterDelete.connections[alpha.id], undefined)
    assert.strictEqual(betaAfterDelete.connection_types[alpha.id], undefined)
    assert.strictEqual(aura.stats().total_connections, 0)
  })

  it("delete persists Rust graph cleanup for target neighbors", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-delete-graph-"))
    const aura = await openWritableAuraIn(brainPath)

    const alpha = await Effect.runPromise(provideNode(aura.store("alpha delete graph target", {
      namespace: "default",
    })))
    const beta = await Effect.runPromise(provideNode(aura.store("beta delete graph neighbor", {
      namespace: "default",
    })))
    const gamma = await Effect.runPromise(provideNode(aura.store("gamma delete graph neighbor", {
      namespace: "default",
    })))

    await Effect.runPromise(provideNode(aura.connect(alpha.id, beta.id, 0.7, "causal")))
    await Effect.runPromise(provideNode(aura.connect(alpha.id, gamma.id, 0.4, "associative")))

    const alphaStored = readBrainAuraFile(fs.readFileSync(path.join(brainPath, "brain.aura")))
      .records.find((stored) => stored.id === alpha.id)!
    assert.strictEqual(await Effect.runPromise(provideNode(aura.delete(alpha.id))), true)

    const view = new Map(aura.listCognitiveRecords().map((record) => [record.id, record]))
    assert.strictEqual(aura.listRecords().some((record) => record.id === alpha.id), false)
    assert.strictEqual(view.has(alpha.id), false)
    assert.strictEqual(view.get(beta.id)?.connections[alpha.id], undefined)
    assert.strictEqual(view.get(beta.id)?.connection_types[alpha.id], undefined)
    assert.strictEqual(view.get(gamma.id)?.connections[alpha.id], undefined)
    assert.strictEqual(view.get(gamma.id)?.connection_types[alpha.id], undefined)

    const persisted = await Effect.runPromise(
      loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive))
    )
    assert.strictEqual(persisted.has(alpha.id), false)
    assert.strictEqual(persisted.get(beta.id)?.connections[alpha.id], undefined)
    assert.strictEqual(persisted.get(beta.id)?.connection_types[alpha.id], undefined)
    assert.strictEqual(persisted.get(gamma.id)?.connections[alpha.id], undefined)
    assert.strictEqual(persisted.get(gamma.id)?.connection_types[alpha.id], undefined)

    const index = await Effect.runPromise(InvertedIndex.load(path.join(brainPath, "index")).pipe(
      Effect.provide(NodeFileReadLive)
    ))
    const sdrHits = index.searchScored(alphaStored.sdr_indices, 10, 1)
    assert.strictEqual(sdrHits.some(([id]) => id === alpha.id), false)
  })

  it("recall persists activation side effects and refreshes the open Aura view", async () => {
    const aura = await openWritableAura()
    const first = await Effect.runPromise(provideNode(aura.store("shared recall finalizer alpha one", {
      namespace: "default",
      deduplicate: false,
    })))
    const second = await Effect.runPromise(provideNode(aura.store("shared recall finalizer alpha two", {
      namespace: "default",
      deduplicate: false,
    })))

    const context = await Effect.runPromise(provideNode(aura.recall("shared recall finalizer alpha", {
      topK: 2,
      expandConnections: false,
    })))
    assert.include(context, "=== COGNITIVE CONTEXT ===")
    assert.include(context, "shared recall finalizer alpha")

    const records = new Map(aura.listCognitiveRecords().map((record) => [record.id, record]))
    const updatedFirst = records.get(first.id)!
    const updatedSecond = records.get(second.id)!

    assert.strictEqual(updatedFirst.activation_count, 1)
    assert.strictEqual(updatedSecond.activation_count, 1)
    assert.strictEqual(updatedFirst.connections[second.id], 0.05)
    assert.strictEqual(updatedSecond.connections[first.id], 0.05)
  })

  it("recall caches are invalidated after write-affecting updates", async () => {
    const aura = await openWritableAura()
    const record = await Effect.runPromise(provideNode(aura.store("cache invalidation alpha original", {
      namespace: "default",
      tags: ["cache"],
    })))

    const first = await Effect.runPromise(provideNode(aura.recall("cache invalidation alpha", {
      topK: 1,
      expandConnections: false,
    })))
    assert.include(first, "cache invalidation alpha original")

    await Effect.runPromise(provideNode(aura.update(record.id, {
      content: "cache invalidation alpha replacement",
    })))

    const second = await Effect.runPromise(provideNode(aura.recall("cache invalidation alpha", {
      topK: 1,
      expandConnections: false,
    })))
    assert.include(second, "cache invalidation alpha replacement")
    assert.notInclude(second, "cache invalidation alpha original")

    const structured = await Effect.runPromise(provideNode(aura.recall_structured("cache invalidation alpha", {
      topK: 1,
      expandConnections: false,
    })))
    assert.strictEqual(structured[0]?.[1].content, "cache invalidation alpha replacement")
  })

  it("recall_full merges substring and failure fallbacks after the RRF stage", async () => {
    const aura = await openWritableAura()
    const direct = await Effect.runPromise(provideNode(aura.store("deploy recovery direct phrase", {
      namespace: "default",
      tags: ["note"],
    })))
    const failure = await Effect.runPromise(provideNode(aura.store("deploy outage root cause", {
      namespace: "default",
      tags: ["outcome-failure"],
    })))
    const otherNamespace = await Effect.runPromise(provideNode(aura.store("deploy recovery hidden namespace", {
      namespace: "sandbox",
      tags: ["note"],
    })))

    const withFailures = await Effect.runPromise(provideNode(aura.recall_full("deploy recovery", {
      topK: 0,
      includeFailures: true,
      expandConnections: false,
    })))
    const withoutFailures = await Effect.runPromise(provideNode(aura.recall_full("deploy recovery", {
      topK: 0,
      includeFailures: false,
      expandConnections: false,
    })))

    assert.deepStrictEqual(withFailures.map(([, record]) => record.id), [failure.id, direct.id])
    assert.deepStrictEqual(withFailures.map(([score]) => score), [0.8, 0.6])
    assert.deepStrictEqual(withoutFailures.map(([, record]) => record.id), [direct.id])
    assert.ok(!withFailures.some(([, record]) => record.id === otherNamespace.id))
  })

  it("store/update/delete/connect follow Rust record validation boundaries", async () => {
    const aura = await openWritableAura()

    const invalidSource = await Effect.runPromise(Effect.flip(provideNode(aura.store("bad source", {
      source_type: "user",
    }))))
    assert.instanceOf(invalidSource, RecordValidationError)
    assert.strictEqual((invalidSource as RecordValidationError).field, "source_type")

    const invalidSemantic = await Effect.runPromise(Effect.flip(provideNode(aura.store("bad semantic", {
      semantic_type: "memory",
    }))))
    assert.instanceOf(invalidSemantic, RecordValidationError)
    assert.strictEqual((invalidSemantic as RecordValidationError).field, "semantic_type")

    const invalidNamespace = await Effect.runPromise(Effect.flip(provideNode(aura.store("bad namespace", {
      namespace: "ns/path",
    }))))
    assert.instanceOf(invalidNamespace, RecordValidationError)
    assert.strictEqual((invalidNamespace as RecordValidationError).field, "namespace")

    const first = await Effect.runPromise(provideNode(aura.store("first writable record", { namespace: "alpha" })))
    const second = await Effect.runPromise(provideNode(aura.store("second writable record", { namespace: "alpha" })))
    const otherNs = await Effect.runPromise(provideNode(aura.store("other namespace record", { namespace: "beta" })))

    const missingUpdate = await Effect.runPromise(provideNode(aura.update("missing-record", { content: "ignored" })))
    assert.strictEqual(missingUpdate, null)

    const updated = await Effect.runPromise(provideNode(aura.update(first.id, {
      level: Level.Decisions,
      strength: 2,
      metadata: { source: "replacement" },
      source_type: "generated",
    })))
    if (updated === null) throw new Error("expected update to return existing record")
    assert.strictEqual(updated.level, Level.Decisions)
    assert.strictEqual(updated.strength, 1)
    assert.deepStrictEqual(updated.metadata, { source: "replacement" })
    assert.strictEqual(updated.source_type, "generated")

    await Effect.runPromise(provideNode(aura.connect(first.id, second.id, 2, "causal")))
    const firstView = aura.search({ namespace: "alpha" }).find((record) => record.id === first.id)!
    const secondView = aura.search({ namespace: "alpha" }).find((record) => record.id === second.id)!
    assert.strictEqual(firstView.connections[second.id], 1)
    assert.strictEqual(secondView.connections[first.id], 1)
    assert.strictEqual(firstView.connection_types[second.id], "causal")
    assert.strictEqual(secondView.connection_types[first.id], "causal")

    const crossNamespace = await Effect.runPromise(Effect.flip(provideNode(aura.connect(first.id, otherNs.id))))
    assert.instanceOf(crossNamespace, RecordValidationError)
    assert.strictEqual((crossNamespace as RecordValidationError).field, "namespace")

    assert.strictEqual(await Effect.runPromise(provideNode(aura.delete("missing-record"))), false)
  })

  it("consolidate hard-merges same-namespace duplicate records", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-consolidate-"))
    const aura = await openWritableAuraIn(brainPath)

    const low = await Effect.runPromise(provideNode(aura.store("duplicate consolidation memory", {
      namespace: "default",
      tags: ["low"],
      level: Level.Working,
      deduplicate: false,
    })))
    const high = await Effect.runPromise(provideNode(aura.store("duplicate consolidation memory", {
      namespace: "default",
      tags: ["high"],
      level: Level.Domain,
      deduplicate: false,
    })))

    const consolidate = await Effect.runPromise(provideNode(aura.consolidate()))

    assert.deepStrictEqual(consolidate, { merged: 1, checked: 1 })
    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.has(low.id), false)
    assert.strictEqual(persisted.has(high.id), true)
    assert.ok(persisted.get(high.id)?.tags.includes("low"))
    assert.strictEqual(aura.get(low.id), null)
    assert.strictEqual(aura.get(high.id)?.level, Level.Domain)
  })

  it("lifecycle facades flush close and expose encryption state", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-lifecycle-"))
    const aura = await openWritableAuraIn(brainPath)

    assert.strictEqual(aura.is_encrypted(), false)
    await Effect.runPromise(provideNode(aura.flush()))
    await Effect.runPromise(provideNode(aura.close()))

    assert.ok(fs.existsSync(path.join(brainPath, "brain.aura")))
    assert.ok(fs.existsSync(path.join(brainPath, "brain.cog")))
  })

  it("export_json and import_json roundtrip cognitive records", async () => {
    const source = await openWritableAura()
    const record = await Effect.runPromise(provideNode(source.store("Alpha JSON export record", {
      namespace: "alpha",
      tags: ["json", "export"],
      semantic_type: "fact",
    })))

    const exported = source.export_json()
    const parsed = JSON.parse(exported) as ReadonlyArray<{ readonly id?: string }>
    assert.deepStrictEqual(parsed.map((item) => item.id), [record.id])

    const targetPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-import-json-"))
    const target = await openWritableAuraIn(targetPath)
    assert.strictEqual(await Effect.runPromise(provideNode(target.import_json(exported))), 1)
    assert.ok(target.search({ namespace: "alpha" }).some((item) => item.id === record.id))

    const reopened = await Effect.runPromise(provideNode(Aura.open(targetPath)))
    assert.ok(reopened.search({ namespace: "alpha" }).some((item) => item.id === record.id))
  })

  it("cross_namespace_digest is deterministic and non-vacuous for a seeded multi-namespace fixture", async () => {
    const aura = await openWritableAura()
    const alpha = await Effect.runPromise(provideNode(aura.store("Alpha deploy recovery", {
      namespace: "alpha",
      tags: ["deploy", "ops"],
      content_type: "note",
      semantic_type: "fact",
    })))
    const beta = await Effect.runPromise(provideNode(aura.store("Beta deploy recovery", {
      namespace: "beta",
      tags: ["deploy", "ops"],
      content_type: "note",
      semantic_type: "fact",
    })))

    const layer = governanceLayer({
      concepts: {
        "concept-alpha": {
          id: "concept-alpha",
          key: "alpha:deploy",
          namespace: "alpha",
          semantic_type: "fact",
          belief_ids: ["belief-alpha"],
          record_ids: [alpha.id],
          core_terms: ["deploy"],
          shell_terms: ["ops"],
          tags: ["deploy"],
          support_mass: 1,
          confidence: 0.9,
          stability: 1,
          cohesion: 1,
          abstraction_score: 0.8,
          state: ConceptState.Stable,
          last_updated: 1,
        },
        "concept-beta": {
          id: "concept-beta",
          key: "beta:deploy",
          namespace: "beta",
          semantic_type: "fact",
          belief_ids: ["belief-beta"],
          record_ids: [beta.id],
          core_terms: ["deploy"],
          shell_terms: ["ops"],
          tags: ["deploy"],
          support_mass: 1,
          confidence: 0.85,
          stability: 1,
          cohesion: 1,
          abstraction_score: 0.75,
          state: ConceptState.Stable,
          last_updated: 1,
        },
      },
      beliefs: {
        "belief-alpha": makeBelief("belief-alpha", "alpha:deploy:fact", BeliefState.Unresolved, 0.3, 0.6),
        "belief-beta": makeBelief("belief-beta", "beta:deploy:fact", BeliefState.Resolved, 0.1, 1.2),
      },
    })

    const digest = await Effect.runPromise(Effect.provide(
      aura.cross_namespace_digest_with_options(undefined, {
        include_dimensions: ["concepts", "tags", "beliefs", "correction_density", "unknown"],
        pairwise_similarity_threshold: 0,
      }),
      layer
    ))
    const repeat = await Effect.runPromise(Effect.provide(
      aura.cross_namespace_digest_with_options(undefined, {
        include_dimensions: ["concepts", "tags", "beliefs", "correction_density", "unknown"],
        pairwise_similarity_threshold: 0,
      }),
      layer
    ))

    assert.deepStrictEqual(digest.namespaces, repeat.namespaces)
    assert.deepStrictEqual(digest.pairs, repeat.pairs)
    assert.deepStrictEqual(digest.included_dimensions, ["concepts", "tags", "belief_states", "corrections"])
    assert.strictEqual(digest.namespace_count, 2)
    assert.ok(digest.pairs.some((pair) => pair.tag_jaccard > 0 || pair.concept_signature_similarity > 0))
    assert.ok(digest.namespaces.some((namespace) => namespace.belief_state_summary?.high_volatility_count === 1))
    assert.ok(digest.namespaces.every((namespace) => namespace.correction_count === 0))
  })

  it("operator governance facades reuse runtime data and expose suggested correction pressure", async () => {
    const aura = await openWritableAura()
    await Effect.runPromise(provideNode(aura.store("Alpha policy pressure", { namespace: "alpha", tags: ["policy"] })))
    await Effect.runPromise(provideNode(aura.store("Beta baseline", { namespace: "beta", tags: ["baseline"] })))

    const layer = governanceLayer({
      beliefs: {
        "belief-alpha": makeBelief("belief-alpha", "alpha:policy:fact", BeliefState.Unresolved, 0.36, 0.5),
        "belief-beta": makeBelief("belief-beta", "beta:baseline:fact", BeliefState.Resolved, 0.08, 1.2),
      },
      concepts: {
        "concept-alpha": {
          id: "concept-alpha",
          key: "alpha:policy",
          namespace: "alpha",
          semantic_type: "fact",
          belief_ids: ["belief-alpha"],
          record_ids: ["record-alpha"],
          core_terms: ["policy"],
          shell_terms: ["pressure"],
          tags: ["policy"],
          support_mass: 1,
          confidence: 0.91,
          stability: 1,
          cohesion: 1,
          abstraction_score: 0.82,
          state: ConceptState.Stable,
          last_updated: 1,
        },
      },
      policies: {
        "policy-alpha": {
          id: "policy-alpha",
          pattern_id: null,
          condition: "alpha deploy has risk",
          action: "verify alpha",
          priority: 1,
          confidence: 0.8,
          state: PolicyState.Suppressed,
          last_updated: 2,
          actionKind: PolicyActionKind.VerifyFirst,
          policyStrength: 0.72,
          riskScore: 0.81,
          namespace: "alpha",
          domain: "deploy",
          polarity: Polarity.Negative,
          recommendation: "Verify alpha deploy",
          utilityScore: 0.3,
          cause_key: "alpha:policy:fact",
          effect_keys: [],
          cause_record_ids: [],
        },
        "policy-beta": {
          id: "policy-beta",
          pattern_id: null,
          condition: "beta baseline is stale",
          action: "refresh beta",
          priority: 1,
          confidence: 0.6,
          state: PolicyState.Rejected,
          last_updated: 3,
          actionKind: PolicyActionKind.Warn,
          policyStrength: 0.55,
          riskScore: 0.44,
          namespace: "beta",
          domain: "baseline",
          polarity: Polarity.Neutral,
          recommendation: "Refresh beta baseline",
          utilityScore: 0.1,
          cause_key: "beta:baseline:fact",
          effect_keys: [],
          cause_record_ids: [],
        },
        "policy-stable": {
          id: "policy-stable",
          pattern_id: null,
          condition: "alpha policy is stable",
          action: "prefer alpha",
          priority: 1,
          confidence: 0.9,
          state: PolicyState.Stable,
          last_updated: 4,
          actionKind: PolicyActionKind.Prefer,
          policyStrength: 0.88,
          riskScore: 0.1,
          namespace: "alpha",
          domain: "deploy",
          polarity: Polarity.Positive,
          recommendation: "Prefer alpha policy",
          utilityScore: 0.9,
          cause_key: "alpha:policy:fact",
          effect_keys: ["alpha:policy:result"],
          cause_record_ids: ["record-alpha"],
        },
      },
    })

    const instability = await Effect.runPromise(Effect.provide(aura.belief_instability(), layer))
    const lifecycle = await Effect.runPromise(Effect.provide(aura.policy_lifecycle(), layer))
    const health = await Effect.runPromise(Effect.provide(aura.memory_health(5), layer))
    const governance = await Effect.runPromise(Effect.provide(aura.namespace_governance_status(["alpha", "beta"]), layer))

    assert.strictEqual(instability.high_volatility_count, 1)
    assert.strictEqual(lifecycle.suppressed_hints, 1)
    assert.strictEqual(health.total_records, 2)
    assert.strictEqual(health.high_volatility_belief_count, 1)
    assert.strictEqual(health.recent_correction_count, 0)
    assert.strictEqual(health.high_salience_record_count, 0)
    assert.ok(health.policy_pressure_area_count > 0)
    assert.ok(health.top_issues.some((issue) => issue.kind === "belief_instability"))

    const alpha = governance.find((status) => status.namespace === "alpha")
    if (!alpha) throw new Error("alpha namespace status missing")
    assert.strictEqual(alpha.correction_count, 0)
    assert.strictEqual(alpha.suggested_correction_count, 1)
    assert.ok(alpha.instability_score > 0)
    assert.deepStrictEqual(governance.map((status) => status.namespace).sort(), ["alpha", "beta"])

    const highVolatility = await Effect.runPromise(Effect.provide(aura.get_high_volatility_beliefs(0.2, 5), layer))
    assert.deepStrictEqual(highVolatility.map((belief) => belief.id), ["belief-alpha"])
    const lowStability = await Effect.runPromise(Effect.provide(aura.get_low_stability_beliefs(1, 5), layer))
    assert.deepStrictEqual(lowStability.map((belief) => belief.id), ["belief-alpha"])
    const clusters = await Effect.runPromise(Effect.provide(aura.get_contradiction_clusters(undefined, 5), layer))
    assert.ok(clusters.some((cluster) => cluster.beliefIds.includes("belief-alpha")))

    const surfacedConcepts = await Effect.runPromise(Effect.provide(aura.get_surfaced_concepts_for_namespace("alpha", 5), layer))
    assert.deepStrictEqual(surfacedConcepts.map((concept) => concept.id), ["concept-alpha"])
    const suppressedHints = await Effect.runPromise(Effect.provide(aura.get_suppressed_policy_hints("alpha", 5), layer))
    assert.deepStrictEqual(suppressedHints.map((hint) => hint.id), ["policy-alpha"])
    const rejectedHints = await Effect.runPromise(Effect.provide(aura.get_rejected_policy_hints(undefined, 5), layer))
    assert.deepStrictEqual(rejectedHints.map((hint) => hint.id), ["policy-beta"])
    const surfacedPolicyHints = await Effect.runPromise(Effect.provide(aura.get_surfaced_policy_hints_for_namespace("alpha", 5), layer))
    assert.ok(surfacedPolicyHints.some((hint) => hint.id === "policy-stable"))
  })

  it("memory_health projects high-salience records into summary and review issues", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-salience-health-"))
    const aura = await Effect.runPromise(provideNode(Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(brainPath)
      yield* brain.flush()
      const store = yield* CognitiveStoreFile.open(brainPath)
      yield* store.appendStore({
        id: "salient_record",
        content: "Alpha deploy record marked as operator priority",
        level: Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: 1,
        last_activated: 1,
        tags: ["deploy"],
        connections: {},
        connection_types: {},
        content_type: "text",
        source_type: "recorded",
        namespace: "alpha",
        semantic_type: "fact",
        activation_velocity: 0,
        salience: 0.88,
        metadata: { salience_reason: "operator_priority" },
        aura_id: null,
        caused_by_id: null,
        confidence: 0.9,
        support_mass: 0,
        conflict_mass: 0,
        volatility: 0,
      })
      yield* store.flush()
      return yield* Aura.open(brainPath)
    })))

    const health = await Effect.runPromise(Effect.provide(aura.memory_health(10), governanceLayer({})))

    assert.strictEqual(health.high_salience_record_count, 1)
    assert.ok(health.avg_salience > 0)
    assert.ok(health.max_salience >= 0.88)
    assert.ok(health.top_issues.some((issue) =>
      issue.kind === "high_salience_record" &&
      issue.target_id === "salient_record" &&
      issue.severity === "medium"
    ))
  })

  it("salience facades mirror Rust PyO3 ordering and summary semantics", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-salience-facades-"))
    const aura = await Effect.runPromise(provideNode(Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(brainPath)
      yield* brain.flush()
      const store = yield* CognitiveStoreFile.open(brainPath)
      const records = [
        { id: "low", content: "Low salience record", salience: 0.10, strength: 1, level: Level.Working },
        { id: "medium", content: "Medium salience record", salience: 0.40, strength: 1, level: Level.Decisions },
        { id: "boundary", content: "Boundary salience record", salience: 0.50, strength: 1, level: Level.Decisions },
        { id: "high-weaker", content: "High salience weaker record", salience: 0.85, strength: 0.10, level: Level.Working },
        { id: "high-stronger", content: "High salience stronger record", salience: 0.85, strength: 1, level: Level.Identity },
      ] as const
      for (const record of records) {
        yield* store.appendStore({
          id: record.id,
          content: record.content,
          level: record.level,
          strength: record.strength,
          activation_count: 0,
          created_at: 1,
          last_activated: 1,
          tags: ["salience"],
          connections: {},
          connection_types: {},
          content_type: "text",
          source_type: "recorded",
          namespace: "alpha",
          semantic_type: "fact",
          activation_velocity: 0,
          salience: record.salience,
          metadata: {},
          aura_id: null,
          caused_by_id: null,
          confidence: 0.9,
          support_mass: 0,
          conflict_mass: 0,
          volatility: 0,
        })
      }
      yield* store.flush()
      return yield* Aura.open(brainPath)
    })))

    const topDefault = aura.get_high_salience_records()
    assert.deepStrictEqual(topDefault.map((record) => record.id), ["high-stronger", "high-weaker", "boundary"])
    topDefault[0]!.content = "mutated outside Aura"
    assert.strictEqual(aura.get("high-stronger")?.content, "High salience stronger record")

    assert.deepStrictEqual(
      aura.get_high_salience_records(0.30, 10).map((record) => record.id),
      ["high-stronger", "high-weaker", "boundary", "medium"],
    )
    assert.deepStrictEqual(
      aura.get_high_salience_records(-1, 2).map((record) => record.id),
      ["high-stronger", "high-weaker"],
    )

    const summary = aura.get_salience_summary()
    assert.strictEqual(summary.total_records, 5)
    assert.strictEqual(summary.high_salience_count, 2)
    assert.ok(Math.abs(summary.avg_salience - 0.54) < 0.000001)
    assert.strictEqual(summary.max_salience, 0.85)
    assert.deepStrictEqual(summary.bands, { low: 1, medium: 2, high: 2 })

    const marked = await Effect.runPromise(provideNode(
      aura.mark_record_salience("medium", 1.4, " user_priority ")
    ))
    assert.strictEqual(marked?.salience, 1)
    assert.strictEqual(marked?.metadata.salience_reason, "user_priority")
    assert.match(marked?.metadata.salience_marked_at ?? "", /^\d+\.\d{3}$/)
    assert.deepStrictEqual(
      aura.get_high_salience_records(0.90, 10).map((record) => record.id),
      ["medium"],
    )

    const cleared = await Effect.runPromise(provideNode(
      aura.mark_record_salience("medium", 0.2, "   ")
    ))
    assert.strictEqual(cleared?.salience, 0.2)
    assert.strictEqual(cleared?.metadata.salience_reason, undefined)
    assert.match(cleared?.metadata.salience_marked_at ?? "", /^\d+\.\d{3}$/)
    assert.strictEqual(await Effect.runPromise(provideNode(aura.mark_record_salience("missing", 0.9))), null)

    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.get("medium")?.salience, 0.2)
    assert.strictEqual(persisted.get("medium")?.metadata.salience_reason, undefined)
  })

  it("two-tier stats and promotion facades mirror Rust PyO3 semantics", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-two-tier-facades-"))
    const aura = await Effect.runPromise(provideNode(Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(brainPath)
      yield* brain.flush()
      const store = yield* CognitiveStoreFile.open(brainPath)
      const makeRecord = (
        id: string,
        level: Level,
        activationCount: number,
        strength: number,
      ) => ({
        id,
        content: `${id} content`,
        level,
        strength,
        activation_count: activationCount,
        created_at: 1,
        last_activated: 1,
        tags: [],
        connections: {},
        connection_types: {},
        content_type: "text",
        source_type: "recorded",
        namespace: "default",
        semantic_type: "fact",
        activation_velocity: 0,
        salience: 0,
        metadata: {},
        aura_id: null,
        caused_by_id: null,
        confidence: 0.9,
        support_mass: 0,
        conflict_mass: 0,
        volatility: 0,
      })

      yield* store.appendStore(makeRecord("working-candidate", Level.Working, 6, 0.8))
      yield* store.appendStore(makeRecord("decisions-candidate", Level.Decisions, 8, 0.75))
      yield* store.appendStore(makeRecord("working-weak", Level.Working, 9, 0.2))
      yield* store.appendStore(makeRecord("domain-core", Level.Domain, 2, 0.95))
      yield* store.appendStore(makeRecord("identity-core", Level.Identity, 3, 0.95))
      yield* store.flush()
      return yield* Aura.open(brainPath)
    })))

    assert.deepStrictEqual(aura.tier_stats(), {
      cognitive_total: 3,
      cognitive_working: 2,
      cognitive_decisions: 1,
      core_total: 2,
      core_domain: 1,
      core_identity: 1,
      total: 5,
    })

    assert.deepStrictEqual(
      (await Effect.runPromise(provideNode(aura.recall_cognitive(null, 10)))).map((record) => record.id),
      ["decisions-candidate", "working-candidate", "working-weak"],
    )
    assert.deepStrictEqual(
      (await Effect.runPromise(provideNode(aura.recall_core_tier(undefined, 10)))).map((record) => record.id),
      ["identity-core", "domain-core"],
    )
    assert.deepStrictEqual(
      (await Effect.runPromise(provideNode(aura.recall_cognitive(undefined, 10, ["missing"])))).map((record) => record.id),
      [],
    )

    const candidates = aura.promotion_candidates()
    assert.deepStrictEqual(candidates.map((record) => record.id), ["decisions-candidate", "working-candidate"])
    candidates[0]!.content = "mutated outside Aura"
    assert.strictEqual(aura.get("decisions-candidate")?.content, "decisions-candidate content")
    assert.deepStrictEqual(aura.promotion_candidates(7).map((record) => record.id), ["decisions-candidate"])
    assert.deepStrictEqual(aura.promotion_candidates(undefined, 0.9).map((record) => record.id), [])

    assert.strictEqual(await Effect.runPromise(provideNode(aura.promote_record("working-candidate"))), Level.Decisions)
    assert.strictEqual(aura.get("working-candidate")?.level, Level.Decisions)
    assert.strictEqual(await Effect.runPromise(provideNode(aura.promote_record("working-candidate"))), Level.Domain)
    assert.strictEqual(await Effect.runPromise(provideNode(aura.promote_record("working-candidate"))), Level.Identity)
    assert.strictEqual(await Effect.runPromise(provideNode(aura.promote_record("working-candidate"))), null)
    assert.strictEqual(await Effect.runPromise(provideNode(aura.promote_record("missing"))), null)

    assert.deepStrictEqual(aura.tier_stats(), {
      cognitive_total: 2,
      cognitive_working: 1,
      cognitive_decisions: 1,
      core_total: 3,
      core_domain: 1,
      core_identity: 2,
      total: 5,
    })

    const persisted = await Effect.runPromise(loadCognitiveRecords(brainPath).pipe(Effect.provide(NodeFileReadLive)))
    assert.strictEqual(persisted.get("working-candidate")?.level, Level.Identity)
  })

  it("two-tier recall facades run query pipeline then filter tier and namespace", async () => {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-two-tier-recall-"))
    const aura = await Effect.runPromise(provideNode(Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(brainPath)
      yield* brain.flush()
      const store = yield* CognitiveStoreFile.open(brainPath)
      const makeRecord = (
        id: string,
        level: Level,
        namespace: string,
        strength: number,
      ) => ({
        id,
        content: `alpha ${id} content`,
        level,
        strength,
        activation_count: 0,
        created_at: 1,
        last_activated: 1,
        tags: ["alpha"],
        connections: {},
        connection_types: {},
        content_type: "text",
        source_type: "recorded",
        namespace,
        semantic_type: "fact",
        activation_velocity: 0,
        salience: 0,
        metadata: {},
        aura_id: null,
        caused_by_id: null,
        confidence: 0.9,
        support_mass: 0,
        conflict_mass: 0,
        volatility: 0,
      })

      yield* store.appendStore(makeRecord("alpha-working", Level.Working, "default", 1))
      yield* store.appendStore(makeRecord("alpha-decision", Level.Decisions, "default", 1))
      yield* store.appendStore(makeRecord("alpha-domain", Level.Domain, "default", 1))
      yield* store.appendStore(makeRecord("alpha-identity", Level.Identity, "default", 1))
      yield* store.appendStore(makeRecord("beta-working", Level.Working, "beta", 1))
      yield* store.appendStore(makeRecord("beta-domain", Level.Domain, "beta", 1))
      yield* store.flush()
      return yield* Aura.open(brainPath)
    })))

    const cognitive = await Effect.runPromise(provideNode(aura.recall_cognitive("alpha", 5)))
    assert.deepStrictEqual(
      new Set(cognitive.map((record) => record.id)),
      new Set(["alpha-working", "alpha-decision"]),
    )
    assert.ok(cognitive.every((record) => record.level === Level.Working || record.level === Level.Decisions))
    assert.ok(cognitive.every((record) => record.namespace === "default"))

    const core = await Effect.runPromise(provideNode(aura.recall_core_tier("alpha", 5)))
    assert.deepStrictEqual(
      new Set(core.map((record) => record.id)),
      new Set(["alpha-domain", "alpha-identity"]),
    )
    assert.ok(core.every((record) => record.level === Level.Domain || record.level === Level.Identity))
    assert.ok(core.every((record) => record.namespace === "default"))

    const betaCognitive = await Effect.runPromise(provideNode(aura.recall_cognitive("alpha", 5, ["beta"])))
    assert.deepStrictEqual(betaCognitive.map((record) => record.id), ["beta-working"])
    const betaCore = await Effect.runPromise(provideNode(aura.recall_core_tier("alpha", 5, ["beta"])))
    assert.deepStrictEqual(betaCore.map((record) => record.id), ["beta-domain"])
  })

  it("correction writers populate logs, review queues, and 07-04 governance backfills", async () => {
    const aura = await openWritableAura()
    const record = await Effect.runPromise(provideNode(aura.store("Alpha deploy correction evidence", {
      namespace: "alpha",
      tags: ["deploy", "ops"],
      semantic_type: "fact",
    })))

    const layer = correctionLayer(record.id)
    const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(provideNode(Effect.provide(effect, layer)) as Effect.Effect<A, E, never>)

    assert.strictEqual(await run(aura.deprecate_belief_with_reason("belief-alpha", "manual_review")), true)
    assert.strictEqual(await run(aura.invalidate_causal_pattern_with_reason("causal-alpha", "spurious_correlation")), true)
    assert.strictEqual(await run(aura.retract_policy_hint_with_reason("policy-alpha", "superseded_runbook")), true)

    assert.strictEqual(aura.get_correction_log().length, 3)
    const recentlyCorrected = await run(aura.get_recently_corrected_beliefs(5))
    assert.deepStrictEqual(recentlyCorrected.map((belief) => belief.id), ["belief-alpha"])

    const queue = await run(aura.correction_review_queue(10))
    assert.strictEqual(queue.length, 3)
    assert.ok(queue.some((item) => item.target_kind === "belief" && item.namespace === "alpha"))

    const health = await run(aura.memory_health(10))
    assert.strictEqual(health.recent_correction_count, 3)

    const governance = await run(aura.namespace_governance_status(["alpha"]))
    assert.strictEqual(governance[0]?.correction_count, 3)
    assert.ok((governance[0]?.correction_density ?? 0) > 0)

    const digest = await run(aura.cross_namespace_digest_with_options(["alpha"], {
      include_dimensions: ["corrections", "beliefs"],
    }))
    assert.strictEqual(digest.namespaces[0]?.correction_count, 3)

    const suggestions = await run(aura.get_suggested_corrections(5))
    const suggestionReport = await run(aura.get_suggested_corrections_report(5))
    assert.deepStrictEqual(suggestionReport.entries, suggestions)
    assert.ok(suggestionReport.scan_latency_ms >= 0)
  })

  it("correction aliases use Rust default reasons and causal retraction compatibility", async () => {
    const aura = await openWritableAura()
    const record = await Effect.runPromise(provideNode(aura.store("Alpha deploy alias correction evidence", {
      namespace: "alpha",
      tags: ["deploy", "ops"],
      semantic_type: "fact",
    })))
    const runFresh = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(provideNode(Effect.provide(effect, correctionLayer(record.id))) as Effect.Effect<A, E, never>)

    assert.strictEqual(await runFresh(aura.deprecate_belief("belief-alpha")), true)
    assert.strictEqual(await runFresh(aura.invalidate_causal_pattern("causal-alpha")), true)
    assert.strictEqual(await runFresh(aura.retract_causal_pattern("causal-alpha")), true)
    assert.strictEqual(await runFresh(aura.retract_causal_pattern_with_reason("causal-alpha", "legacy_retraction")), true)
    assert.strictEqual(await runFresh(aura.retract_policy_hint("policy-alpha")), true)

    assert.deepStrictEqual(
      aura.get_correction_log().map((entry) => [entry.target_kind, entry.operation, entry.reason]),
      [
        ["belief", "deprecate", "manual_deprecation"],
        ["causal_pattern", "invalidate", "manual_invalidation"],
        ["causal_pattern", "invalidate", "manual_retraction"],
        ["causal_pattern", "invalidate", "legacy_retraction"],
        ["policy_hint", "retract", "manual_retraction"],
      ],
    )
  })

  it("explainability surfaces use recall trace plus maintenance evidence", async () => {
    const aura = await openWritableAura()
    const source = await Effect.runPromise(provideNode(aura.store("Alpha deploy source", {
      namespace: "alpha",
      tags: ["deploy"],
      semantic_type: "fact",
    })))
    const record = await Effect.runPromise(provideNode(aura.store("Alpha deploy policy evidence", {
      namespace: "alpha",
      tags: ["deploy", "policy"],
      semantic_type: "fact",
      caused_by_id: source.id,
    })))

    const layer = correctionLayer(record.id)
    const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(provideNode(Effect.provide(effect, layer)) as Effect.Effect<A, E, never>)

    await run(aura.invalidate_causal_pattern_with_reason("causal-alpha", "bundle_correction"))

    const explanation = await run(aura.explain_record(record.id))
    if (explanation === null) throw new Error("explanation missing")
    assert.strictEqual(explanation.record_id, record.id)
    assert.strictEqual(explanation.belief?.id, "belief-alpha")
    assert.ok(explanation.concepts.some((concept) => concept.id === "concept-alpha"))
    assert.ok(explanation.causal_patterns.some((pattern) => pattern.id === "causal-alpha"))
    assert.ok(explanation.policy_hints.some((hint) => hint.id === "policy-alpha"))
    assert.strictEqual(explanation.because_record_id, source.id)

    const recall = await run(aura.explain_recall("deploy policy", 5, 0, true, ["alpha"]))
    assert.ok(recall.items.length > 0)
    assert.strictEqual(recall.belief_rerank_mode, "limited")
    assert.strictEqual(recall.concept_surface_mode, "inspect")
    assert.strictEqual(recall.causal_rerank_mode, "limited")
    assert.strictEqual(recall.policy_rerank_mode, "limited")
    assert.ok(recall.items.some((item) => item.trace.tags !== null || item.trace.ngram !== null || item.trace.sdr !== null))

    aura.disable_full_cognitive_stack()
    const offRecall = await run(aura.explain_recall("deploy policy", 5, 0, true, ["alpha"]))
    assert.strictEqual(offRecall.belief_rerank_mode, "off")
    assert.strictEqual(offRecall.concept_surface_mode, "off")
    assert.strictEqual(offRecall.causal_rerank_mode, "off")
    assert.strictEqual(offRecall.policy_rerank_mode, "off")

    const bundle = await run(aura.explainability_bundle(record.id))
    if (bundle === null) throw new Error("bundle missing")
    assert.strictEqual(bundle.record_id, record.id)
    assert.ok(bundle.provenance.steps.length > 0)
    assert.strictEqual(bundle.causal_corrections.length, 1)
  })
})

function makeBelief(
  id: string,
  key: string,
  state: BeliefState,
  volatility: number,
  stability: number,
) {
  return {
    id,
    key,
    hypothesis_ids: [],
    winner_id: null,
    state,
    score: 0.5,
    confidence: 0.7,
    support_mass: 1,
    conflict_mass: volatility,
    stability,
    volatility,
    last_updated: 1,
  }
}

function governanceLayer(overrides: {
  readonly beliefs?: Record<string, ReturnType<typeof makeBelief>>
  readonly concepts?: Record<string, unknown>
  readonly causal?: Record<string, unknown>
  readonly policies?: Record<string, unknown>
}) {
  const beliefEngine = {
    stats: () => Effect.succeed({
      version: 1,
      beliefs: overrides.beliefs ?? {},
      hypotheses: {},
      record_to_belief: {},
      key_index: {},
      record_index: {},
    }),
    belief_for_record: () => Effect.succeed(null),
  }
  const conceptEngine = {
    stats: () => Effect.succeed({
      version: 1,
      concepts: overrides.concepts ?? {},
      key_index: {},
      seed_mode: ConceptSeedMode.Standard,
      similarity_mode: ConceptSimilarityMode.SdrTanimoto,
      partition_mode: ConceptPartitionMode.Standard,
      union_mode: ConceptUnionMode.Standard,
    }),
  }
  const causalEngine = {
    stats: () => Effect.succeed({
      version: 1,
      patterns: overrides.causal ?? {},
      discovery_mode: CausalDiscoveryMode.Standard,
      edges_found_total: 0,
      temporal_budget_mode: "ExhaustiveCapped",
      evidence_mode: "StrictRepeatedWindows",
      last_corpus_fingerprint: "",
    }),
  }
  const policyEngine = {
    stats: () => Effect.succeed({
      version: 1,
      hints: overrides.policies ?? {},
      metadata: {},
      key_index: {},
    }),
  }
  return Layer.mergeAll(
    EpistemicRuntimeLive,
    Layer.succeed(BeliefEngine, beliefEngine as any),
    Layer.succeed(ConceptEngine, conceptEngine as any),
    Layer.succeed(CausalEngine, causalEngine as any),
    Layer.succeed(PolicyEngine, policyEngine as any),
  )
}

function correctionLayer(recordId: string) {
  let beliefState: any = {
    version: 1 as const,
    beliefs: {
      "belief-alpha": makeBelief("belief-alpha", "alpha:deploy:fact", BeliefState.Unresolved, 0.36, 0.5),
    },
    hypotheses: {},
    record_to_belief: { [recordId]: "belief-alpha" },
    key_index: { "alpha:deploy:fact": "belief-alpha" },
    record_index: { [recordId]: "belief-alpha" },
  }
  let causalState: any = {
    version: 1 as const,
    patterns: {
      "causal-alpha": {
        id: "causal-alpha",
        cause_belief_id: "belief-alpha",
        effect_belief_id: "belief-alpha",
        cause_key: "alpha:deploy:fact",
        effect_key: "alpha:policy:fact",
        edge_hash: "edge-alpha",
        support: 2,
        confidence: 0.8,
        lift: 1.2,
        state: CausalState.Stable,
        last_updated: 1,
        transition_lift: 1,
        temporal_consistency: 1,
        outcome_stability: 0.9,
        causal_strength: 0.82,
        support_count: 2,
        explicit_support_count: 1,
        temporal_support_count: 1,
        counterevidence_count: 0,
        temporal_windows: 1,
        explicit_support_total_for_cause: 1,
        explicit_effect_variants_for_cause: 1,
        effect_record_signature_variants: 1,
        positive_effect_signals: 1,
        negative_effect_signals: 0,
        namespace: "alpha",
        cause_record_ids: [recordId],
        effect_record_ids: [recordId],
      },
    },
    discovery_mode: CausalDiscoveryMode.Standard,
    edges_found_total: 0,
    temporal_budget_mode: TemporalBudgetMode.ExhaustiveCapped,
    evidence_mode: EvidenceMode.StrictRepeatedWindows,
    last_corpus_fingerprint: "",
  }
  let policyState: any = {
    version: 1 as const,
    hints: {
      "policy-alpha": {
        id: "policy-alpha",
        pattern_id: "causal-alpha",
        condition: "alpha deploy needs verification",
        action: "verify alpha deploy",
        priority: 1,
        confidence: 0.8,
        state: PolicyState.Stable,
        last_updated: 1,
        actionKind: PolicyActionKind.VerifyFirst,
        policyStrength: 0.75,
        riskScore: 0.7,
        namespace: "alpha",
        domain: "deploy",
        polarity: Polarity.Negative,
        recommendation: "Verify alpha deploy",
        utilityScore: 0.3,
        cause_key: "alpha:deploy:fact",
        effect_keys: [recordId],
        cause_record_ids: [recordId],
      },
    },
    metadata: {},
    key_index: { "alpha:deploy:policy": "policy-alpha" },
  }
  const conceptState: any = {
    version: 1 as const,
    concepts: {
      "concept-alpha": {
        id: "concept-alpha",
        key: "alpha:deploy",
        namespace: "alpha",
        semantic_type: "fact",
        belief_ids: ["belief-alpha"],
        record_ids: [recordId],
        core_terms: ["deploy"],
        shell_terms: ["ops"],
        tags: ["deploy"],
        support_mass: 1,
        confidence: 0.9,
        stability: 1,
        cohesion: 1,
        abstraction_score: 0.8,
        state: ConceptState.Stable,
        last_updated: 1,
      },
    },
    key_index: { "alpha:deploy": "concept-alpha" },
    seed_mode: ConceptSeedMode.Standard,
    similarity_mode: ConceptSimilarityMode.SdrTanimoto,
    partition_mode: ConceptPartitionMode.Standard,
    union_mode: ConceptUnionMode.Standard,
  }

  const beliefEngine = {
    stats: () => Effect.succeed(beliefState),
    belief_for_record: (rid: string) => Effect.succeed(beliefState.record_to_belief[rid] ?? null),
    deprecate_belief: (beliefId: string) =>
      Effect.sync(() => {
        const belief = beliefState.beliefs[beliefId as "belief-alpha"]
        if (belief === undefined) return
        beliefState = {
          ...beliefState,
          beliefs: {
            ...beliefState.beliefs,
            [beliefId]: {
              ...belief,
              confidence: belief.confidence * 0.5,
              state: BeliefState.Unresolved,
              winner_id: null,
              stability: 0,
            },
          },
        }
      }),
  }
  const conceptEngine = {
    stats: () => Effect.succeed(conceptState),
  }
  const causalEngine = {
    stats: () => Effect.succeed(causalState),
    invalidate_pattern: (id: string) =>
      Effect.sync(() => {
        const pattern = causalState.patterns[id as "causal-alpha"]
        if (pattern === undefined) return
        causalState = {
          ...causalState,
          patterns: {
            ...causalState.patterns,
            [id]: { ...pattern, state: CausalState.Invalidated },
          },
        }
      }),
    retract_pattern: () => Effect.void,
  }
  const policyEngine = {
    stats: () => Effect.succeed(policyState),
    retract_hint: (id: string) =>
      Effect.sync(() => {
        const { [id]: _removed, ...remaining } = policyState.hints
        policyState = { ...policyState, hints: remaining }
      }),
  }
  return Layer.mergeAll(
    EpistemicRuntimeLive,
    Layer.succeed(BeliefEngine, beliefEngine as any),
    Layer.succeed(ConceptEngine, conceptEngine as any),
    Layer.succeed(CausalEngine, causalEngine as any),
    Layer.succeed(PolicyEngine, policyEngine as any),
    Layer.succeed(BeliefStore, { load: () => Effect.succeed(beliefState), save: (state: typeof beliefState) => Effect.sync(() => { beliefState = state }) } as any),
    Layer.succeed(ConceptStore, { load: () => Effect.succeed(conceptState), save: () => Effect.void } as any),
    Layer.succeed(CausalStore, { load: () => Effect.succeed(causalState), save: (state: typeof causalState) => Effect.sync(() => { causalState = state }) } as any),
    Layer.succeed(PolicyStore, { load: () => Effect.succeed(policyState), save: (state: typeof policyState) => Effect.sync(() => { policyState = state }) } as any),
  )
}

// ═══════════════════════════════════════════════════════════════════════
// Aura.runMaintenance integration tests
// ═══════════════════════════════════════════════════════════════════════

describe("Aura.runMaintenance", () => {
  it("returns a MaintenanceReport with mock engines", async () => {
    // Mock EpistemicTrace
    const mockTrace = {
      event: () => Effect.succeed(undefined),
      span: (_name: string, _fields: unknown, effect: Effect.Effect<unknown, unknown, unknown>) => effect,
    }

    // Mock engines — each returns empty state from stats()
    const mockBeliefEngine = {
      stats: () => Effect.succeed({ version: 1, beliefs: {}, hypotheses: {}, record_to_belief: {} }),
      update_with_sdr: () => Effect.succeed({ coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0 }),
      claim_key: () => Effect.succeed(""),
      claim_key_with_mode: () => Effect.succeed(""),
      update: () => Effect.succeed({ coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0 }),
      belief_for_record: () => Effect.succeed(null),
      deprecate_belief: () => Effect.succeed(undefined),
      apply_layer_feedback: () => Effect.succeed(undefined),
      unresolved_beliefs: () => Effect.succeed([]),
      with_coarse_key_mode: () => Effect.succeed(undefined),
    }

    const mockConceptEngine = {
      stats: () => Effect.succeed({
        version: 1, concepts: {}, key_index: {},
        seed_mode: ConceptSeedMode.Standard,
        similarity_mode: ConceptSimilarityMode.SdrTanimoto,
        partition_mode: ConceptPartitionMode.Standard,
        union_mode: ConceptUnionMode.Standard,
      }),
      discover: () => Effect.succeed({
        seeds_found: 0, candidates_found: 0, stable_count: 0, rejected_count: 0,
        avg_abstraction_score: 0, centroids_built: 0,
        partitions_with_multiple_seeds: 0, multi_seed_partition_sizes: [],
        cluster_sizes: [], clusters_with_multiple_beliefs: 0,
        largest_cluster_size: 0, pairwise_comparisons: 0,
        pairwise_above_threshold: 0, tanimoto_min: 0, tanimoto_max: 0,
        tanimoto_avg: 0, tanimoto_p50: 0, tanimoto_p95: 0,
        avg_centroid_size: 0, seeds_capped: 0,
      }),
      stable_concepts: () => Effect.succeed([]),
      active_candidates: () => Effect.succeed([]),
      with_seed_mode: () => Effect.succeed(undefined),
    }

    let syncedTemporalBudgetMode: TemporalBudgetMode | undefined
    let syncedEvidenceMode: EvidenceMode | undefined
    const mockCausalEngine = {
      stats: () => Effect.succeed({
        version: 1,
        patterns: {},
        discovery_mode: CausalDiscoveryMode.Standard,
        temporal_budget_mode: syncedTemporalBudgetMode ?? TemporalBudgetMode.NearbySuccessors,
        evidence_mode: syncedEvidenceMode ?? EvidenceMode.StrictRepeatedWindows,
        edges_found_total: 0,
        last_corpus_fingerprint: "",
      }),
      discover: () => Effect.succeed({ patterns_found: 0, patterns_active: 0, patterns_invalidated: 0, avg_confidence: 0, avg_lift: 0 }),
      invalidate_pattern: () => Effect.succeed(undefined),
      retract_pattern: () => Effect.succeed(undefined),
      set_temporal_budget_mode: (mode: TemporalBudgetMode) => Effect.sync(() => {
        syncedTemporalBudgetMode = mode
      }),
      set_evidence_mode: (mode: EvidenceMode) => Effect.sync(() => {
        syncedEvidenceMode = mode
      }),
    }

    const mockPolicyEngine = {
      stats: () => Effect.succeed({ version: 1, hints: {}, metadata: {}, key_index: {} }),
      discover: () => Effect.succeed({ hints_found: 0, hints_active: 0, hints_suppressed: 0, avg_confidence: 0 }),
      retract_hint: () => Effect.succeed(undefined),
    }

    // Mock stores
    const mockBeliefStore = {
      load: () => Effect.succeed({} as never),
      save: () => Effect.succeed(undefined),
    }
    const mockConceptStore = {
      load: () => Effect.succeed({} as never),
      save: () => Effect.succeed(undefined),
    }
    const mockCausalStore = {
      load: () => Effect.succeed({} as never),
      save: () => Effect.succeed(undefined),
    }
    const mockPolicyStore = {
      load: () => Effect.succeed({} as never),
      save: () => Effect.succeed(undefined),
    }

    // Build test layer
    const testLayer = Layer.mergeAll(
      NodeFileReadLive,
      NodeFileWriteLive,
      NodeClockLive,
      NodeCryptoLive,
      Layer.succeed(EpistemicTrace, mockTrace as any),
      Layer.succeed(BeliefEngine, mockBeliefEngine as any),
      Layer.succeed(ConceptEngine, mockConceptEngine as any),
      Layer.succeed(CausalEngine, mockCausalEngine as any),
      Layer.succeed(PolicyEngine, mockPolicyEngine as any),
      Layer.succeed(BeliefStore, mockBeliefStore as any),
      Layer.succeed(ConceptStore, mockConceptStore as any),
      Layer.succeed(CausalStore, mockCausalStore as any),
      Layer.succeed(PolicyStore, mockPolicyStore as any),
    )

    // Create Aura through the same brain.cog normalization boundary used by production open().
    const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-test-"))
    const aura = await Effect.runPromise(
      Effect.gen(function* () {
        const f = yield* BrainAuraFile.open(brainDir)
        yield* f.flush()
        const store = yield* CognitiveStoreFile.open(brainDir)
        yield* store.appendStore({
          id: "maintain_rec_1",
          content: "maintenance contract record",
          level: Level.Working,
          strength: 1,
          activation_count: 0,
          created_at: 1,
          last_activated: 1,
          tags: [],
          connections: {},
          connection_types: {},
          content_type: "text",
          source_type: "recorded",
          namespace: "default",
          semantic_type: "fact",
          metadata: {},
        })
        yield* store.flush()
        return yield* Aura.open(brainDir)
      }).pipe(
        Effect.provide(NodeFileReadLive),
        Effect.provide(NodeFileWriteLive),
        Effect.provide(NodeClockLive),
        Effect.provide(NodeCryptoLive)
      )
    )

    aura.set_causal_temporal_budget_mode("exhaustive_capped")
    aura.set_causal_evidence_mode("explicit_trusted")
    aura.configure_maintenance({
      ...defaultMaintenanceConfig,
      decayEnabled: false,
      reflectEnabled: false,
      insightsEnabled: false,
      levelFixInterval: 0,
    })
    const result = await Effect.runPromise(
      Effect.provide(aura.run_maintenance(), testLayer)
    )
    expect(result).toBeDefined()
    expect(result.totalRecords).toBe(1)
    expect(result.decay.decayed).toBe(0)
    expect(result.insightsFound).toBe(0)
    expect(syncedTemporalBudgetMode).toBe(TemporalBudgetMode.ExhaustiveCapped)
    expect(syncedEvidenceMode).toBe(EvidenceMode.ExplicitTrusted)
  })
})
