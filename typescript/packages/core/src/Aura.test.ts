import { describe, it, expect } from "vitest"
import { assert } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { Aura } from "./index"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BrainAuraFile } from "@aura/storage"
import {
  BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine,
  BeliefStore, ConceptStore, CausalStore, PolicyStore,
  EpistemicTrace, FileWrite, FileRead,
  ConceptSeedMode, ConceptSimilarityMode, ConceptPartitionMode, ConceptUnionMode,
  CausalDiscoveryMode,
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

    // Mock FileWrite (required by runDiscoveryPhases)
    const mockFileWrite = {
      mkdirp: () => Effect.succeed(undefined),
      writeFile: () => Effect.succeed(undefined),
      appendFile: () => Effect.succeed(undefined),
      writeAt: () => Effect.succeed(undefined),
      fsync: () => Effect.succeed(undefined),
      rename: () => Effect.succeed(undefined),
    }

    // Mock FileRead (required by runMaintenance pipeline — Phase 06.2 replaced Effect.die stub)
    const mockFileRead = {
      readFile: () => Effect.succeed(new Uint8Array()),
      exists: () => Effect.succeed(false),
      stat: () => Effect.fail({ _tag: "FileReadError", path: "", cause: "not found" } as never),
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
      Layer.succeed(EpistemicTrace, mockTrace as any),
      Layer.succeed(FileWrite, mockFileWrite as any),
      Layer.succeed(FileRead, mockFileRead as any),
      Layer.succeed(BeliefEngine, mockBeliefEngine as any),
      Layer.succeed(ConceptEngine, mockConceptEngine as any),
      Layer.succeed(CausalEngine, mockCausalEngine as any),
      Layer.succeed(PolicyEngine, mockPolicyEngine as any),
      Layer.succeed(BeliefStore, mockBeliefStore as any),
      Layer.succeed(ConceptStore, mockConceptStore as any),
      Layer.succeed(CausalStore, mockCausalStore as any),
      Layer.succeed(PolicyStore, mockPolicyStore as any),
    )

    // Create Aura instance bypassing private constructor
    const brainDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-test-"))
    const aura = new (Aura as any)(brainDir, [])

    // This should fail (RED phase) because runMaintenance is still Effect.die
    const result = await Effect.runPromise(
      Effect.provide(aura.runMaintenance(), testLayer)
    )
    expect(result).toBeDefined()
  })
})
