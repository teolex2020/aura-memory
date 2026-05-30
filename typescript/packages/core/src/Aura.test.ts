import { describe, it, expect } from "vitest"
import { assert } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { Aura } from "./index"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BrainAuraFile, CognitiveStoreFile } from "@aura/storage"
import { EpistemicRuntimeLive } from "@aura/epistemic-runtime"
import {
  BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine,
  BeliefStore, ConceptStore, CausalStore, PolicyStore,
  EpistemicTrace,
  ConceptSeedMode, ConceptSimilarityMode, ConceptPartitionMode, ConceptUnionMode,
  CausalDiscoveryMode,
  BeliefState, ConceptState, PolicyActionKind, PolicyState, Polarity,
  Level,
  UnsupportedSurfaceError,
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

describe("Aura MCP-facing operational surfaces", () => {
  function provideNode<A, E, R>(effect: Effect.Effect<A, E, R>) {
    return effect.pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  }

  async function openWritableAura(): Promise<Aura> {
    const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-mcp-core-"))
    await Effect.runPromise(provideNode(BrainAuraFile.open(brainPath).pipe(Effect.flatMap((file) => file.flush()))))
    return Effect.runPromise(provideNode(Aura.open(brainPath)))
  }

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

  it("search is owned by Aura and refreshes through store/update/connect/delete mutations", async () => {
    const aura = await openWritableAura()

    const alpha = await Effect.runPromise(provideNode(aura.store("alpha durable memory", {
      namespace: "default",
      tags: ["alpha"],
      content_type: "note",
      source_type: "user",
      semantic_type: "memory",
    })))
    const beta = await Effect.runPromise(provideNode(aura.store("beta durable memory", {
      namespace: "default",
      tags: ["beta"],
      content_type: "note",
      source_type: "user",
      semantic_type: "memory",
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
    assert.strictEqual(aura.stats().total_connections, 1)

    assert.strictEqual(aura.search({ tags: ["alpha"] }).length, 1)
    assert.strictEqual(aura.search({ tags: ["alpha"], namespace: "ops" }).length, 1)

    await Effect.runPromise(provideNode(aura.delete(alpha.id)))
    assert.strictEqual(aura.search({ query: "alpha", namespace: "default" }).length, 0)
  })

  it("consolidate and explainability gaps fail with typed unsupported errors", async () => {
    const aura = await openWritableAura()

    const consolidate = await Effect.runPromise(Effect.flip(aura.consolidate()))
    assert.instanceOf(consolidate, UnsupportedSurfaceError)
    assert.strictEqual(consolidate.surface, "Aura.consolidate")

    const explain = await Effect.runPromise(Effect.flip(aura.explain_record("missing")))
    assert.instanceOf(explain, UnsupportedSurfaceError)
    assert.strictEqual(explain.surface, "Aura.explain_record")
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

  it("operator governance facades reuse runtime data and keep staged correction fields at zero", async () => {
    const aura = await openWritableAura()
    await Effect.runPromise(provideNode(aura.store("Alpha policy pressure", { namespace: "alpha", tags: ["policy"] })))
    await Effect.runPromise(provideNode(aura.store("Beta baseline", { namespace: "beta", tags: ["baseline"] })))

    const layer = governanceLayer({
      beliefs: {
        "belief-alpha": makeBelief("belief-alpha", "alpha:policy:fact", BeliefState.Unresolved, 0.36, 0.5),
        "belief-beta": makeBelief("belief-beta", "beta:baseline:fact", BeliefState.Resolved, 0.08, 1.2),
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
    assert.strictEqual(alpha.suggested_correction_count, 0)
    assert.ok(alpha.instability_score > 0)
    assert.deepStrictEqual(governance.map((status) => status.namespace).sort(), ["alpha", "beta"])
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

    const mockCausalEngine = {
      stats: () => Effect.succeed({ version: 1, patterns: {}, discovery_mode: CausalDiscoveryMode.Standard }),
      discover: () => Effect.succeed({ patterns_found: 0, patterns_active: 0, patterns_invalidated: 0, avg_confidence: 0, avg_lift: 0 }),
      invalidate_pattern: () => Effect.succeed(undefined),
      retract_pattern: () => Effect.succeed(undefined),
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
          semantic_type: "memory",
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

    const result = await Effect.runPromise(
      Effect.provide(aura.runMaintenance(), testLayer)
    )
    expect(result).toBeDefined()
    expect(result.totalRecords).toBe(1)
  })
})
