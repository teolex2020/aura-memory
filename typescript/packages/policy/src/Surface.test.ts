import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  surfacePolicyHints,
  surfacePolicyHintsFiltered,
  type PolicyEngine,
  type PolicyHint,
  PolicyActionKind,
  PolicyState,
} from "./Surface"

// ── Test helpers ──

function makeHint(
  id: string,
  key: string,
  ns: string,
  domain: string,
  action: PolicyActionKind,
  state: PolicyState,
  strength: number,
  confidence: number,
  risk: number,
  overrides?: Partial<PolicyHint>
): PolicyHint {
  return {
    id,
    key,
    namespace: ns,
    domain,
    actionKind: action,
    recommendation: `Test recommendation for ${domain}`,
    triggerCausalIds: ["causal_1"],
    triggerConceptIds: [],
    triggerBeliefIds: ["belief_1"],
    supportingRecordIds: ["rec_1", "rec_2"],
    causeRecordIds: ["rec_1"],
    confidence,
    utilityScore: 0.5,
    riskScore: risk,
    policyStrength: strength,
    state,
    lastUpdated: 0,
    ...overrides,
  }
}

function makeEngine(hints: PolicyHint[]): PolicyEngine {
  const hintsMap = new Map<string, PolicyHint>()
  const keyIndexMap = new Map<string, string>()
  for (const h of hints) {
    hintsMap.set(h.id, h)
    keyIndexMap.set(h.key, h.id)
  }
  return { hints: hintsMap, keyIndex: keyIndexMap }
}

function run<R>(effect: Effect.Effect<R>): R {
  return Effect.runSync(effect)
}

// ── 1. Empty engine returns empty result ──

it("empty engine returns empty result", () => {
  const engine = makeEngine([])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 2. Stable hints are surfaced ──

it("stable hints are surfaced", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  assert.strictEqual(surfaced[0]!.state, "stable")
  assert.strictEqual(surfaced[0]!.actionKind, "prefer")
})

// ── 3. Strong candidates can be surfaced ──

it("strong candidates can be surfaced", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Recommend, PolicyState.Candidate, 0.75, 0.60, 0.0),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  assert.strictEqual(surfaced[0]!.state, "candidate")
  assert.strictEqual(surfaced[0]!.actionKind, "recommend")
})

// ── 4. Suppressed hints are not surfaced ──

it("suppressed hints are not surfaced", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Avoid, PolicyState.Suppressed, 0.80, 0.75, 0.5),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 5. Rejected hints are not surfaced ──

it("rejected hints are not surfaced", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Warn, PolicyState.Rejected, 0.30, 0.20, 0.1),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 6. Hints without provenance are not surfaced ──

it("hints without provenance are not surfaced", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0, {
      triggerCausalIds: [],
      supportingRecordIds: [],
    }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 7. Surface sorting is deterministic with actionKind tiebreaker ──

it("surface sorting is deterministic with actionKind tiebreaker", () => {
  // Same policyStrength for all, so actionKind priority is the differentiator
  // Avoid > Warn > VerifyFirst > Recommend > Prefer
  // Use different domains to avoid per-domain cap (MAX_SURFACED_PER_DOMAIN=3)
  const engine = makeEngine([
    makeHint("h_prefer", "k_prefer", "default", "domain_a", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Prefer approach A" }),
    makeHint("h_recommend", "k_recommend", "default", "domain_b", PolicyActionKind.Recommend, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Recommend approach B" }),
    makeHint("h_verify", "k_verify", "default", "domain_c", PolicyActionKind.VerifyFirst, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Verify first for C" }),
    makeHint("h_warn", "k_warn", "default", "domain_d", PolicyActionKind.Warn, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Warn about D" }),
    makeHint("h_avoid", "k_avoid", "default", "domain_e", PolicyActionKind.Avoid, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Avoid approach E" }),
  ])

  const s1 = run(surfacePolicyHints(engine))
  const s2 = run(surfacePolicyHints(engine))

  assert.strictEqual(s1.length, 5)
  // Deterministic: both calls produce same order
  for (let i = 0; i < s1.length; i++) {
    assert.strictEqual(s1[i]!.id, s2[i]!.id)
  }
  // ActionKind priority: Avoid > Warn > VerifyFirst > Recommend > Prefer
  assert.strictEqual(s1[0]!.id, "h_avoid")
  assert.strictEqual(s1[1]!.id, "h_warn")
  assert.strictEqual(s1[2]!.id, "h_verify")
  assert.strictEqual(s1[3]!.id, "h_recommend")
  assert.strictEqual(s1[4]!.id, "h_prefer")
})

// ── 8. Surface limit is enforced ──

it("surface limit is enforced", () => {
  const hints: PolicyHint[] = []
  for (let i = 0; i < 15; i++) {
    hints.push(makeHint(`h${i}`, `k${i}`, "default", `domain_${i}`, PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.70, 0.0))
  }
  const engine = makeEngine(hints)

  // Default limit (10)
  const surfaced = run(surfacePolicyHints(engine))
  assert.isTrue(surfaced.length <= 10)

  // Explicit limit
  const surfaced5 = run(surfacePolicyHints(engine, 5))
  assert.isTrue(surfaced5.length <= 5)
})

// ── 9. Per-domain cap enforced ──

it("per-domain cap enforced", () => {
  const hints: PolicyHint[] = []
  for (let i = 0; i < 6; i++) {
    hints.push(makeHint(`h${i}`, `k${i}`, "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80 - i * 0.01, 0.70, 0.0))
  }
  const engine = makeEngine(hints)

  const surfaced = run(surfacePolicyHints(engine))
  // MAX_SURFACED_PER_DOMAIN = 3
  assert.isTrue(surfaced.length <= 3)
})

// ── 10. Weak candidates not surfaced ──

it("weak candidates not surfaced", () => {
  // Candidate with strength below STRONG_CANDIDATE_THRESHOLD (0.70)
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Recommend, PolicyState.Candidate, 0.50, 0.60, 0.0),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 11. Surfaced hints have full provenance ──

it("surfaced hints have full provenance", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0, {
      triggerCausalIds: ["c1", "c2"],
      triggerConceptIds: ["concept_1"],
      triggerBeliefIds: ["b1", "b2"],
      supportingRecordIds: ["r1", "r2", "r3"],
    }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  const h = surfaced[0]!
  assert.deepStrictEqual(h.triggerCausalIds, ["c1", "c2"])
})

// ── 12. Namespace filter works ──

it("namespace filter works", () => {
  const engine = makeEngine([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0),
    makeHint("h2", "k2", "ops", "monitoring", PolicyActionKind.Avoid, PolicyState.Stable, 0.90, 0.80, 0.6),
    makeHint("h3", "k3", "default", "logging", PolicyActionKind.Recommend, PolicyState.Stable, 0.70, 0.65, 0.0),
  ])

  // No filter: all 3
  const all = run(surfacePolicyHints(engine))
  assert.strictEqual(all.length, 3)

  // Filter "default": only h1 and h3
  const defaultNs = run(surfacePolicyHintsFiltered(engine, undefined, "default"))
  assert.strictEqual(defaultNs.length, 2)
  const ids = defaultNs.map(h => h.id)
  assert.isTrue(ids.includes("h1"))
  assert.isTrue(ids.includes("h3"))

  // Filter "ops": only h2
  const ops = run(surfacePolicyHintsFiltered(engine, undefined, "ops"))
  assert.strictEqual(ops.length, 1)
  assert.strictEqual(ops[0]!.id, "h2")
})
