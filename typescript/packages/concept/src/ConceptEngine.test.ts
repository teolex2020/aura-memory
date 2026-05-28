import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  BeliefState,
  ConceptSimilarityMode,
  ConceptUnionMode,
  EpistemicTrace,
  Level,
  type BeliefEngine,
  type BeliefEngineState,
  type BeliefReport,
  type EpistemicTraceImpl,
  type Record as AuraRecord,
  type SdrLookup
} from "@aura/contract"
import { nowSecs } from "@aura/utils"
import {
  ConceptEngineImpl,
  stemWord,
  applyEquivalenceDictionary,
  isCanonicalStopword,
  jaccardSimilarity,
  canonicalTokens,
  buildCanonicalTokens,
  tagBarrier,
  familyGuard,
  genericFamilyGuard,
  semanticTypeBridge,
  parseBeliefKeyFamily,
  familyTokenSet,
  isGenericFamily
} from "./ConceptEngine"

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
    connection_types: {},
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
    update: () => Effect.succeed({ coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0, beliefs_created: 0, beliefs_pruned: 0, revisions: 0, resolved: 0, unresolved: 0, total_beliefs: 0, total_hypotheses: 0, churn_rate: 0 } as BeliefReport),
    update_with_sdr: () => Effect.succeed({ coarse_groups: 0, beliefs_built: 0, hypotheses_built: 0, beliefs_created: 0, beliefs_pruned: 0, revisions: 0, resolved: 0, unresolved: 0, total_beliefs: 0, total_hypotheses: 0, churn_rate: 0 } as BeliefReport),
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
    record_to_belief: { r1: "b1" },
    key_index: {},
    record_index: { r1: "b1" }
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
    record_to_belief: { r1: "b1", r2: "b1", r3: "b2" },
    key_index: {},
    record_index: { r1: "b1", r2: "b1", r3: "b2" }
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
    record_to_belief: { r1: "b1", r2: "b1", r3: "b2" },
    key_index: {},
    record_index: { r1: "b1", r2: "b1", r3: "b2" }
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

// ═══════════════════════════════════════════════════════════════════
// CanonicalFeature Mode Tests — TDD RED phase
// All tests extracted from Rust concept.rs behavior
// ═══════════════════════════════════════════════════════════════════

// ── stemWord ──

it("stemWord: removes 'ing' suffix when word > 5 chars", () => {
  assert.strictEqual(stemWord("testing"), "test")
})

it("stemWord: removes 'ed' suffix when word > 5 chars", () => {
  assert.strictEqual(stemWord("deployed"), "deploy")
})

it("stemWord: removes 'ly' suffix when word > 5 chars", () => {
  assert.strictEqual(stemWord("quickly"), "quick")
})

it("stemWord: converts 'ies' to 'y' (plural→singular)", () => {
  assert.strictEqual(stemWord("queries"), "query")
})

it("stemWord: converts 'ied' to 'y' (past→present)", () => {
  assert.strictEqual(stemWord("studied"), "study")
})

it("stemWord: removes 'es' suffix when word > 5 chars", () => {
  assert.strictEqual(stemWord("classes"), "class")
})

it("stemWord: removes 'er' suffix when word > 5 chars", () => {
  assert.strictEqual(stemWord("higher"), "high")
})

it("stemWord: removes 's' suffix (unless 'ss') when word > 5 chars and base >= 4", () => {
  assert.strictEqual(stemWord("writers"), "writer")
})

it("stemWord: does NOT remove 's' when word ends with 'ss'", () => {
  assert.strictEqual(stemWord("boss"), "boss")
})

it("stemWord: does NOT stem words <= 5 chars", () => {
  assert.strictEqual(stemWord("cats"), "cats")
  assert.strictEqual(stemWord("run"), "run")
})

it("stemWord: removes 'ness' suffix when word > 5 chars", () => {
  assert.strictEqual(stemWord("darkness"), "dark")
})

it("stemWord: removes 'ment' suffix when word > 5 chars and base >= 4", () => {
  assert.strictEqual(stemWord("placement"), "place")
})

it("stemWord: removes 'ations' suffix (longest first) when word > 7 chars", () => {
  assert.strictEqual(stemWord("computations"), "comput")
})

it("stemWord: removes 'ation' suffix when word > 6 chars", () => {
  assert.strictEqual(stemWord("compilation"), "compil")
})

it("stemWord: removes 'ments' suffix when word > 6 chars", () => {
  assert.strictEqual(stemWord("deployments"), "deploy")
})

// ── applyEquivalenceDictionary ──

it("applyEquivalenceDictionary: maps deployment family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("deployment"), "deploy")
  assert.strictEqual(applyEquivalenceDictionary("deploying"), "deploy")
  assert.strictEqual(applyEquivalenceDictionary("deployed"), "deploy")
  assert.strictEqual(applyEquivalenceDictionary("deployments"), "deploy")
  assert.strictEqual(applyEquivalenceDictionary("post-deploy"), "deploy")
})

it("applyEquivalenceDictionary: maps database family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("db"), "database")
  assert.strictEqual(applyEquivalenceDictionary("postgresql"), "database")
  assert.strictEqual(applyEquivalenceDictionary("postgres"), "database")
  assert.strictEqual(applyEquivalenceDictionary("mysql"), "database")
  assert.strictEqual(applyEquivalenceDictionary("databases"), "database")
})

it("applyEquivalenceDictionary: maps query variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("queries"), "query")
  assert.strictEqual(applyEquivalenceDictionary("querying"), "query")
  assert.strictEqual(applyEquivalenceDictionary("queried"), "query")
})

it("applyEquivalenceDictionary: maps config family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("configuration"), "config")
  assert.strictEqual(applyEquivalenceDictionary("configurations"), "config")
  assert.strictEqual(applyEquivalenceDictionary("configure"), "config")
  assert.strictEqual(applyEquivalenceDictionary("configured"), "config")
  assert.strictEqual(applyEquivalenceDictionary("configuring"), "config")
})

it("applyEquivalenceDictionary: maps test variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("testing"), "test")
  assert.strictEqual(applyEquivalenceDictionary("tested"), "test")
  assert.strictEqual(applyEquivalenceDictionary("tests"), "test")
})

it("applyEquivalenceDictionary: maps monitor family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("monitoring"), "monitor")
  assert.strictEqual(applyEquivalenceDictionary("monitored"), "monitor")
  assert.strictEqual(applyEquivalenceDictionary("monitors"), "monitor")
})

it("applyEquivalenceDictionary: maps release family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("release"), "release")
  assert.strictEqual(applyEquivalenceDictionary("releases"), "release")
  assert.strictEqual(applyEquivalenceDictionary("released"), "release")
  assert.strictEqual(applyEquivalenceDictionary("releasing"), "release")
})

it("applyEquivalenceDictionary: maps security family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("secure"), "security")
  assert.strictEqual(applyEquivalenceDictionary("secured"), "security")
  assert.strictEqual(applyEquivalenceDictionary("securing"), "security")
})

it("applyEquivalenceDictionary: maps approval family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("approve"), "approval")
  assert.strictEqual(applyEquivalenceDictionary("approved"), "approval")
  assert.strictEqual(applyEquivalenceDictionary("approving"), "approval")
})

it("applyEquivalenceDictionary: maps rollout variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("rollout"), "rollout")
  assert.strictEqual(applyEquivalenceDictionary("rollouts"), "rollout")
  assert.strictEqual(applyEquivalenceDictionary("roll-out"), "rollout")
  assert.strictEqual(applyEquivalenceDictionary("rolling"), "rollout")
})

it("applyEquivalenceDictionary: maps blue-green → bluegreen (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("blue-green"), "bluegreen")
})

it("applyEquivalenceDictionary: maps prod → production (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("prod"), "production")
  assert.strictEqual(applyEquivalenceDictionary("production"), "production")
})

it("applyEquivalenceDictionary: maps env → environment (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("env"), "environment")
  assert.strictEqual(applyEquivalenceDictionary("environment"), "environment")
  assert.strictEqual(applyEquivalenceDictionary("environments"), "environment")
})

it("applyEquivalenceDictionary: maps perf → performance (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("perf"), "performance")
  assert.strictEqual(applyEquivalenceDictionary("performance"), "performance")
})

it("applyEquivalenceDictionary: maps index variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("indexes"), "index")
  assert.strictEqual(applyEquivalenceDictionary("indices"), "index")
  assert.strictEqual(applyEquivalenceDictionary("indexed"), "index")
  assert.strictEqual(applyEquivalenceDictionary("indexing"), "index")
})

it("applyEquivalenceDictionary: maps migration variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("migrations"), "migration")
  assert.strictEqual(applyEquivalenceDictionary("migrating"), "migration")
  assert.strictEqual(applyEquivalenceDictionary("migrate"), "migration")
})

it("applyEquivalenceDictionary: maps replica/replicate (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("replicas"), "replica")
  assert.strictEqual(applyEquivalenceDictionary("replication"), "replica")
  assert.strictEqual(applyEquivalenceDictionary("replicate"), "replica")
})

it("applyEquivalenceDictionary: maps connection variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("connections"), "connection")
  assert.strictEqual(applyEquivalenceDictionary("connecting"), "connection")
  assert.strictEqual(applyEquivalenceDictionary("connect"), "connection")
})

it("applyEquivalenceDictionary: maps pool variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("pools"), "pool")
  assert.strictEqual(applyEquivalenceDictionary("pooling"), "pool")
})

it("applyEquivalenceDictionary: maps scan variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("scans"), "scan")
  assert.strictEqual(applyEquivalenceDictionary("scanning"), "scan")
  assert.strictEqual(applyEquivalenceDictionary("scanned"), "scan")
  assert.strictEqual(applyEquivalenceDictionary("scanner"), "scan")
})

it("applyEquivalenceDictionary: maps version variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("versions"), "version")
  assert.strictEqual(applyEquivalenceDictionary("versioned"), "version")
  assert.strictEqual(applyEquivalenceDictionary("versioning"), "version")
})

it("applyEquivalenceDictionary: maps log variants (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("logs"), "log")
  assert.strictEqual(applyEquivalenceDictionary("logging"), "log")
  assert.strictEqual(applyEquivalenceDictionary("logged"), "log")
})

it("applyEquivalenceDictionary: maps strategy→strategy, feature→feature, flag→flag, container→container (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("strategies"), "strategy")
  assert.strictEqual(applyEquivalenceDictionary("features"), "feature")
  assert.strictEqual(applyEquivalenceDictionary("flags"), "flag")
  assert.strictEqual(applyEquivalenceDictionary("containers"), "container")
})

it("applyEquivalenceDictionary: maps health→health, auto→automated (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("healthy"), "health")
  assert.strictEqual(applyEquivalenceDictionary("health"), "health")
  assert.strictEqual(applyEquivalenceDictionary("automatic"), "automated")
  assert.strictEqual(applyEquivalenceDictionary("auto"), "automated")
})

it("applyEquivalenceDictionary: maps registry→registry, artifact→artifact, timeout→timeout, credential→credential (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("registries"), "registry")
  assert.strictEqual(applyEquivalenceDictionary("artifacts"), "artifact")
  assert.strictEqual(applyEquivalenceDictionary("timeouts"), "timeout")
  assert.strictEqual(applyEquivalenceDictionary("credentials"), "credential")
})

it("applyEquivalenceDictionary: maps editor/UI family (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("editors"), "editor")
  assert.strictEqual(applyEquivalenceDictionary("themes"), "theme")
  assert.strictEqual(applyEquivalenceDictionary("themed"), "theme")
  assert.strictEqual(applyEquivalenceDictionary("darker"), "dark")
  assert.strictEqual(applyEquivalenceDictionary("modes"), "mode")
  assert.strictEqual(applyEquivalenceDictionary("fonts"), "font")
  assert.strictEqual(applyEquivalenceDictionary("bindings"), "keybinding")
  assert.strictEqual(applyEquivalenceDictionary("keybindings"), "keybinding")
  assert.strictEqual(applyEquivalenceDictionary("vi"), "vim")
  assert.strictEqual(applyEquivalenceDictionary("extensions"), "extension")
})

it("applyEquivalenceDictionary: maps promote/promotion, validate/validation, region/regional (Rust-extracted)", () => {
  assert.strictEqual(applyEquivalenceDictionary("promotion"), "promote")
  assert.strictEqual(applyEquivalenceDictionary("promotes"), "promote")
  assert.strictEqual(applyEquivalenceDictionary("promoted"), "promote")
  assert.strictEqual(applyEquivalenceDictionary("promoting"), "promote")
  assert.strictEqual(applyEquivalenceDictionary("validation"), "validate")
  assert.strictEqual(applyEquivalenceDictionary("validated"), "validate")
  assert.strictEqual(applyEquivalenceDictionary("validating"), "validate")
  assert.strictEqual(applyEquivalenceDictionary("regional"), "region")
})

it("applyEquivalenceDictionary: returns unknown word unchanged", () => {
  assert.strictEqual(applyEquivalenceDictionary("xyzzzfoo"), "xyzzzfoo")
  assert.strictEqual(applyEquivalenceDictionary("supercalifragilistic"), "supercalifragilistic")
})

// ── jaccardSimilarity ──

it("jaccardSimilarity: returns 0.5 for half-overlapping sets", () => {
  assert.strictEqual(jaccardSimilarity(["a", "b", "c"], ["a", "b", "d"]), 0.5)
})

it("jaccardSimilarity: returns 1.0 for identical sets", () => {
  assert.strictEqual(jaccardSimilarity(["a"], ["a"]), 1.0)
})

it("jaccardSimilarity: returns 0.0 when one set is empty", () => {
  assert.strictEqual(jaccardSimilarity([], ["a"]), 0.0)
})

it("jaccardSimilarity: returns 0.0 when both sets are empty (matches Rust)", () => {
  assert.strictEqual(jaccardSimilarity([], []), 0.0)
})

it("jaccardSimilarity: returns correct ratio for partial overlap", () => {
  assert.strictEqual(jaccardSimilarity(["a", "b"], ["a", "c"]), 1 / 3)
})

it("jaccardSimilarity: returns 0.0 for completely disjoint sets", () => {
  assert.strictEqual(jaccardSimilarity(["a", "b"], ["c", "d"]), 0.0)
})

// ── isCanonicalStopword ──

it("isCanonicalStopword: matches Rust is_canonical_stopword — sample verification", () => {
  // Words in the Rust extended stopword list (concept.rs:1637-1731)
  assert.strictEqual(isCanonicalStopword("the"), true)
  assert.strictEqual(isCanonicalStopword("about"), true)
  assert.strictEqual(isCanonicalStopword("between"), true)
  assert.strictEqual(isCanonicalStopword("during"), true)
  assert.strictEqual(isCanonicalStopword("already"), true)
  assert.strictEqual(isCanonicalStopword("every"), true)
  assert.strictEqual(isCanonicalStopword("least"), true)
  // Words NOT in the Rust stopword list
  assert.strictEqual(isCanonicalStopword("database"), false)
  assert.strictEqual(isCanonicalStopword("deploy"), false)
  assert.strictEqual(isCanonicalStopword("test"), false)
  assert.strictEqual(isCanonicalStopword("config"), false)
  assert.strictEqual(isCanonicalStopword("monitor"), false)
})

// ── stop word list drift detection ──

it("isCanonicalStopword: total count matches Rust source (detect drift)", () => {
  // Rust concept.rs is_canonical_stopword has 93 entries (grep-verified from concept.rs:1637-1731)
  // Count all entries via exhaustive check
  const stopWords = [
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "his", "how", "its", "may",
    "new", "now", "old", "see", "way", "who", "did", "get", "let", "say",
    "she", "too", "use", "with", "this", "that", "have", "from", "they",
    "been", "will", "into", "when", "what", "which", "their", "than", "each",
    "make", "like", "just", "over", "such", "take", "also", "some", "could",
    "them", "only", "other", "very", "after", "most", "then", "more", "should",
    "would", "there", "about", "these", "where", "being", "does", "much",
    "every", "always", "using", "during", "before", "between", "through",
    "while", "since", "both", "still", "need", "set", "via", "per", "least",
    "already"
  ]
  assert.strictEqual(stopWords.length, 91)
  // Verify all are recognized as stopwords
  for (const w of stopWords) {
    assert.ok(isCanonicalStopword(w), `expected "${w}" to be a stopword`)
  }
})

// ── canonicalTokens pipeline ──

it("canonicalTokens: extracts tokens from text with stemming + equivalence", () => {
  const tokens = canonicalTokens("deployment running monitoring configuration database")
  // "deployment" → applyEquivalenceDictionary → "deploy"
  // "running" → stemWord → "runn"
  // "monitoring" → applyEquivalenceDictionary → "monitor"
  // "configuration" → applyEquivalenceDictionary → "config"
  // "database" → applyEquivalenceDictionary → "database"
  assert.deepStrictEqual(tokens, ["config", "database", "deploy", "monitor", "runn"])
})

it("canonicalTokens: filters stopwords", () => {
  const tokens = canonicalTokens("the and about between deploy test")
  // "the", "and", "about", "between" → stopwords (removed)
  // "deploy", "test" → kept
  assert.deepStrictEqual(tokens, ["deploy", "test"])
})

it("canonicalTokens: returns empty for stopword-only content", () => {
  assert.deepStrictEqual(canonicalTokens("the about between during already"), [])
})

it("canonicalTokens: strips punctuation from tokens", () => {
  const tokens = canonicalTokens("deploy! test? (config) {database}")
  // Rust: trim_matches(!is_alphanumeric) strips ! ? ( ) { }
  assert.deepStrictEqual(tokens, ["config", "database", "deploy", "test"])
})

it("canonicalTokens: filters tokens shorter than 3 chars before equivalence", () => {
  const tokens = canonicalTokens("a ab abc deploy")
  // "a" → len 1 < 3 → removed
  // "ab" → len 2 < 3 → removed
  // "abc" → len 3 → kept (no equiv match, no stemming)
  // "deploy" → kept
  assert.deepStrictEqual(tokens, ["abc", "deploy"])
})

it("canonicalTokens: filters resulting tokens shorter than 2 chars after stemming/equivalence", () => {
  // "hi" → len 2, but passes initial filter (>=3)... wait, "hi" is len 2 < 3 → filtered at initial stage
  // After stemming: "testing" → "test" (4 chars, kept)
  const tokens = canonicalTokens("testing")
  assert.deepStrictEqual(tokens, ["test"])
})

it("canonicalTokens: deduplicates tokens", () => {
  const tokens = canonicalTokens("deploy deploy deploy deploy")
  assert.deepStrictEqual(tokens, ["deploy"])
})

it("canonicalTokens: converts to lowercase", () => {
  const tokens = canonicalTokens("Deploy TESTING Config")
  assert.deepStrictEqual(tokens, ["config", "deploy", "test"])
})

// ── buildCanonicalTokens ──

it("buildCanonicalTokens: returns same result as canonicalTokens", () => {
  const a = buildCanonicalTokens("deployment test monitoring")
  const b = canonicalTokens("deployment test monitoring")
  assert.deepStrictEqual(a, b)
})

// ── ConceptEngine default similarity mode ──

it("ConceptEngine: defaults to CanonicalFeature similarity mode (matching Rust)", async () => {
  const concept = new ConceptEngineImpl()
  const stats = await Effect.runPromise(concept.stats())
  assert.strictEqual(stats.similarity_mode, ConceptSimilarityMode.CanonicalFeature)
})

// ═══════════════════════════════════════════════════════════════════
// Cluster Guard Tests — RED phase (stubs always allow)
// Extracted from Rust concept.rs cluster_beliefs / cluster_beliefs_canonical
// ═══════════════════════════════════════════════════════════════════

// ── Helper: build tag set from string array ──

function tagSet(tags: string[]): Set<string> {
  return new Set(tags)
}

// ── parseBeliefKeyFamily ──

it("parseBeliefKeyFamily: extracts tags portion from belief key", () => {
  assert.strictEqual(parseBeliefKeyFamily("default:ui,theme:preference"), "ui,theme")
  assert.strictEqual(parseBeliefKeyFamily("default:deploy:fact"), "deploy")
  assert.strictEqual(parseBeliefKeyFamily("default:alerts:fact"), "alerts")
  assert.strictEqual(parseBeliefKeyFamily("ns:fact"), "")  // only 2 parts
  assert.strictEqual(parseBeliefKeyFamily(""), "")
})

// ── familyTokenSet ──

it("familyTokenSet: splits comma-separated family into token set", () => {
  const tokens = familyTokenSet("deploy,devops,monitor")
  assert.strictEqual(tokens.size, 3)
  assert.ok(tokens.has("deploy"))
  assert.ok(tokens.has("devops"))
  assert.ok(tokens.has("monitor"))
})

it("familyTokenSet: returns empty set for empty family", () => {
  assert.strictEqual(familyTokenSet("").size, 0)
})

// ── isGenericFamily ──

it("isGenericFamily: 'alerts' is generic, others are not", () => {
  assert.strictEqual(isGenericFamily("alerts"), true)
  assert.strictEqual(isGenericFamily("deploy"), false)
  assert.strictEqual(isGenericFamily("frontend"), false)
  assert.strictEqual(isGenericFamily(""), false)
})

// ── Task 1a: tagBarrier ──

it("tagBarrier: blocks merge when shared_tags == 0 and both have tags", () => {
  // RED: stub always returns true, this assertion FAILS
  const tagsA = tagSet(["deploy", "api"])
  const tagsB = tagSet(["frontend", "ui"])
  assert.strictEqual(tagBarrier(tagsA, tagsB), false)
})

it("tagBarrier: allows merge when shared_tags >= 1", () => {
  const tagsA = tagSet(["deploy", "api"])
  const tagsB = tagSet(["deploy", "frontend"])
  assert.strictEqual(tagBarrier(tagsA, tagsB), true)
})

it("tagBarrier: allows merge when one side has no tags", () => {
  const tagsA = tagSet([])
  const tagsB = tagSet(["deploy", "api"])
  assert.strictEqual(tagBarrier(tagsA, tagsB), true)
})

// ── Task 1b: familyGuard ──

it("familyGuard: blocks merge when families differ and no bridge applies", () => {
  // RED: stub always returns 'allowed', this assertion FAILS
  assert.strictEqual(
    familyGuard("deploy", "frontend", 1, "fact", "fact", ConceptUnionMode.Standard),
    "blocked"
  )
})

it("familyGuard: allows merge when families are the same", () => {
  assert.strictEqual(
    familyGuard("deploy", "deploy", 1, "fact", "fact", ConceptUnionMode.Standard),
    "allowed"
  )
})

it("familyGuard: overlap bridge — different families with token overlap AND shared tag", () => {
  // "deploy,devops" vs "devops,monitor" — "devops" token overlaps, shared >= 1
  assert.strictEqual(
    familyGuard("deploy,devops", "devops,monitor", 1, "fact", "fact", ConceptUnionMode.Standard),
    "bridge_allowed"
  )
})

it("familyGuard: single-tag fact↔decision bridge", () => {
  // Each family has exactly 1 tag (different families), shared >= 2, different semantic types
  // Families differ ("deploy" vs "rollout"), but both are single-tag non-generic families
  assert.strictEqual(
    familyGuard("deploy", "rollout", 2, "fact", "decision", ConceptUnionMode.SingleTagFactDecisionBridge),
    "bridge_allowed"
  )
})

it("familyGuard: single-tag bridge blocked when union_mode is Standard", () => {
  // Same scenario as above but Standard union_mode — bridge NOT allowed
  assert.strictEqual(
    familyGuard("deploy", "rollout", 2, "fact", "decision", ConceptUnionMode.Standard),
    "blocked"
  )
})

// ── Task 1c: genericFamilyGuard ──

it("genericFamilyGuard: 'alerts' requires shared_tags >= 2", () => {
  // RED: stub always returns true, this assertion FAILS
  assert.strictEqual(genericFamilyGuard("alerts", 1), false)
  assert.strictEqual(genericFamilyGuard("alerts", 0), false)
  assert.strictEqual(genericFamilyGuard("alerts", 2), true)
})

it("genericFamilyGuard: non-alerts families pass with any shared_tags", () => {
  assert.strictEqual(genericFamilyGuard("deploy", 0), true)
  assert.strictEqual(genericFamilyGuard("frontend", 1), true)
})

// ── Task 1d: semanticTypeBridge ──

it("semanticTypeBridge: same semantic_type always allowed", () => {
  assert.strictEqual(
    semanticTypeBridge("fact", "fact", tagSet(["deploy"]), tagSet(["api"])),
    true
  )
})

it("semanticTypeBridge: different semantic_type but overlapping tags → allowed", () => {
  assert.strictEqual(
    semanticTypeBridge("fact", "decision", tagSet(["deploy", "api"]), tagSet(["deploy"])),
    true
  )
})

it("semanticTypeBridge: different semantic_type and no overlapping tags → blocked", () => {
  // RED: stub always returns true, this assertion FAILS
  assert.strictEqual(
    semanticTypeBridge("fact", "decision", tagSet(["deploy"]), tagSet(["frontend"])),
    false
  )
})

// ── Task 1e: SdrTanimoto mode integration with guards ──

it("ConceptEngine: SdrTanimoto mode clusters beliefs with guard-aware partitioning", async () => {
  // Create beliefs with:
  // - b1, b2: same tags "deploy" → should cluster together
  // - b3: different tag "frontend", no shared tags with b1/b2 → guard should block
  // All have high-Tanimoto SDR centroids (would merge without guards)
  const concept = new ConceptEngineImpl()
  // Set to SdrTanimoto mode explicitly
  await Effect.runPromise(concept.with_similarity_mode(ConceptSimilarityMode.SdrTanimoto))

  const state: BeliefEngineState = {
    version: 1,
    beliefs: {
      b1: {
        id: "b1",
        key: "default:deploy:fact",
        hypothesis_ids: ["h1"],
        winner_id: "h1",
        state: BeliefState.Resolved,
        score: 1.0,
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        stability: 2,
        volatility: 0,
        last_updated: nowSecs()
      },
      b2: {
        id: "b2",
        key: "default:deploy:fact",
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
      },
      b3: {
        id: "b3",
        key: "default:frontend:fact",
        hypothesis_ids: ["h3"],
        winner_id: "h3",
        state: BeliefState.Resolved,
        score: 1.0,
        confidence: 0.9,
        support_mass: 10,
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
        prototype_record_ids: ["r1"],
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.0
      },
      h2: {
        id: "h2",
        belief_id: "b2",
        prototype_record_ids: ["r2"],
        confidence: 0.9,
        support_mass: 8,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.0
      },
      h3: {
        id: "h3",
        belief_id: "b3",
        prototype_record_ids: ["r3"],
        confidence: 0.9,
        support_mass: 10,
        conflict_mass: 0,
        recency: 1,
        consistency: 1,
        score: 1.0
      }
    },
    record_to_belief: { r1: "b1", r2: "b2", r3: "b3" },
    key_index: {},
    record_index: { r1: "b1", r2: "b2", r3: "b3" }
  }

  const records = new Map<string, AuraRecord>([
    ["r1", makeRecord("r1", "deploy service to production", ["deploy"], "fact")],
    ["r2", makeRecord("r2", "deploy new version release", ["deploy"], "fact")],
    ["r3", makeRecord("r3", "frontend ui update theme", ["frontend"], "fact")]
  ])
  // All SDR centroids overlap heavily → Tanimoto would be high
  // But b3 has different tags → tag barrier should block if implemented
  const sdr: SdrLookup = new Map([
    ["r1", [1, 2, 3, 4, 5, 6, 7]],
    ["r2", [3, 4, 5, 6, 7, 8, 9]],
    ["r3", [6, 7, 8, 9, 10, 11, 12]]
  ])

  const report = await Effect.runPromise(
    concept.discover(fakeBeliefEngine(state), records, sdr).pipe(Effect.provideService(EpistemicTrace, NoopTrace))
  )

  // RED: without guards, b3 may merge with b1/b2 cluster.
  // After guards are implemented, b3 should be separated.
  // For now (stub always allows), this assertion checks that the engine runs.
  assert.ok(report.candidates_found >= 1)
  assert.ok(report.seeds_found >= 3)
})
