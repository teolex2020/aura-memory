import { it } from "vitest"
import { assert } from "@effect/vitest"
import { Effect } from "effect"
import {
  surfacePolicyHints,
  surfacePolicyHintsFiltered,
  type PolicyHint,
  PolicyActionKind,
  PolicyState,
} from "./Surface"
import { Polarity, type PolicyEngineState } from "@aura/contract"

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
    pattern_id: null,
    condition: `When ${key}`,
    action: `Act on ${domain}`,
    priority: 50,
    cause_key: key,
    namespace: ns,
    domain,
    actionKind: action,
    recommendation: `Test recommendation for ${domain}`,
    effect_keys: ["rec_1", "rec_2"],
    cause_record_ids: ["rec_1"],
    confidence,
    utilityScore: 0.5,
    riskScore: risk,
    policyStrength: strength,
    polarity: Polarity.Neutral,
    state,
    last_updated: 0,
    ...overrides,
  }
}

function makeState(hints: PolicyHint[]): PolicyEngineState {
  const hintsMap: Record<string, PolicyHint> = {}
  const keyIndexMap: Record<string, string> = {}
  for (const h of hints) {
    hintsMap[h.id] = h
    keyIndexMap[h.cause_key] = h.id
  }
  return { version: 1, hints: hintsMap, key_index: keyIndexMap, metadata: {} }
}

function run<R>(effect: Effect.Effect<R>): R {
  return Effect.runSync(effect)
}

// ── 1. Empty engine returns empty result ──

it("empty engine returns empty result", () => {
  const engine = makeState([])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 2. Stable hints are surfaced ──

it("stable hints are surfaced", () => {
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  assert.strictEqual(surfaced[0]!.state, "stable")
  assert.strictEqual(surfaced[0]!.actionKind, "prefer")
})

// ── 3. Strong candidates can be surfaced ──

it("strong candidates can be surfaced", () => {
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Recommend, PolicyState.Candidate, 0.75, 0.60, 0.0),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  assert.strictEqual(surfaced[0]!.state, "candidate")
  assert.strictEqual(surfaced[0]!.actionKind, "recommend")
})

// ── 4. Suppressed hints are not surfaced ──

it("suppressed hints are not surfaced", () => {
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Avoid, PolicyState.Suppressed, 0.80, 0.75, 0.5),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 5. Rejected hints are not surfaced ──

it("rejected hints are not surfaced", () => {
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Warn, PolicyState.Rejected, 0.30, 0.20, 0.1),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 6. Hints without provenance are not surfaced ──

it("hints without provenance are not surfaced", () => {
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0, {
      cause_record_ids: [],
      effect_keys: [],
    }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 7. Surface sorting is deterministic with actionKind tiebreaker ──

it("surface sorting is deterministic — policyStrength -> confidence -> riskScore -> key", () => {
  // Same policyStrength=0.80 for all, same confidence=0.70, same riskScore=0.0
  // Rust sort: policy_strength DESC -> confidence DESC -> risk_score DESC -> stable -> key ASC
  // Final tiebreak is key alphabetical
  const engine = makeState([
    makeHint("h_prefer", "k_prefer", "default", "domain_a", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Prefer approach A" }),
    makeHint("h_recommend", "k_recommend", "default", "domain_b", PolicyActionKind.Recommend, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Recommend approach B" }),
    makeHint("h_verify", "k_verify", "default", "domain_c", PolicyActionKind.VerifyFirst, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Verify first for C" }),
    makeHint("h_warn", "k_warn", "default", "domain_d", PolicyActionKind.Warn, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Warn about D" }),
    makeHint("h_avoid", "k_avoid", "default", "domain_e", PolicyActionKind.Avoid, PolicyState.Stable, 0.80, 0.70, 0.0, { recommendation: "Avoid approach E" }),
  ])

  const s1 = run(surfacePolicyHints(engine))
  const s2 = run(surfacePolicyHints(engine))

  assert.strictEqual(s1.length, 5)
  // Deterministic: both calls produce same key-ordered output
  for (let i = 0; i < s1.length; i++) {
    assert.strictEqual(s1[i]!.id, s2[i]!.id)
  }
  // Key alphabetical order (final tiebreak when all scores equal):
  // k_avoid, k_prefer, k_recommend, k_verify, k_warn
  assert.strictEqual(s1[0]!.id, "h_avoid")
  assert.strictEqual(s1[1]!.id, "h_prefer")
  assert.strictEqual(s1[2]!.id, "h_recommend")
  assert.strictEqual(s1[3]!.id, "h_verify")
  assert.strictEqual(s1[4]!.id, "h_warn")
})

// ── 8. Surface limit is enforced ──

it("surface limit is enforced", () => {
  const hints: PolicyHint[] = []
  for (let i = 0; i < 15; i++) {
    hints.push(makeHint(`h${i}`, `k${i}`, "default", `domain_${i}`, PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.70, 0.0))
  }
  const engine = makeState(hints)

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
  const engine = makeState(hints)

  const surfaced = run(surfacePolicyHints(engine))
  // MAX_SURFACED_PER_DOMAIN = 3
  assert.isTrue(surfaced.length <= 3)
})

// ── 10. Weak candidates not surfaced ──

it("weak candidates not surfaced", () => {
  // Candidate with strength below STRONG_CANDIDATE_THRESHOLD (0.70)
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Recommend, PolicyState.Candidate, 0.50, 0.60, 0.0),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 0)
})

// ── 11. Surfaced hints have full provenance ──

it("surfaced hints have full provenance", () => {
  const engine = makeState([
    makeHint("h1", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0, {
      cause_record_ids: ["c1", "c2"],
      effect_keys: ["r1", "r2", "r3"],
    }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  const h = surfaced[0]!
  assert.deepStrictEqual(h.triggerCausalIds, ["c1", "c2"])
})

// ── 12. Namespace filter works ──

it("namespace filter works", () => {
  const engine = makeState([
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

// ═══════════════════════════════════════════════════════════════════════════
// Task 2 RED Tests: Rust-aligned surface sorting + thresholds
// ═══════════════════════════════════════════════════════════════════════════

it("surface sorts by policyStrength DESC -> confidence DESC -> riskScore DESC (Rust order)", () => {
  // Same policyStrength=0.80 for all, different confidence/riskScore
  // Rust order: policy_strength DESC -> confidence DESC -> risk_score DESC -> stable -> key
  const engine = makeState([
    makeHint("h1", "k1", "default", "domain_a", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.70, 0.2, { recommendation: "A" }),
    makeHint("h2", "k2", "default", "domain_b", PolicyActionKind.Avoid, PolicyState.Stable, 0.80, 0.90, 0.3, { recommendation: "B" }),
    makeHint("h3", "k3", "default", "domain_c", PolicyActionKind.Warn, PolicyState.Stable, 0.80, 0.80, 0.1, { recommendation: "C" }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  // RED: current implementation sorts by actionKind priority (Avoid > Warn > ...)
  //   which would put h2 (Avoid) first
  // Rust sort: confidence DESC would put h2 first (confidence 0.90)
  //   h2 (conf 0.90) > h3 (conf 0.80) > h1 (conf 0.70)
  // Both sorting methods put h2 first, so this test may coincidentally pass.
  // The key distinction: when confidence differs but actionKind differs too
  assert.strictEqual(surfaced.length, 3)
  // Verify deterministic order
  const order = surfaced.map(h => h.id)
  // Rust expected: h2 (conf 0.90) > h3 (conf 0.80) > h1 (conf 0.70)
  // Old sort: h2 (Avoid,conf 0.90) > h3 (Warn,conf 0.80) > h1 (Pref,conf 0.70)
  // Both produce same order here — but the mechanism differs
  assert.deepStrictEqual(order, ["h2", "h3", "h1"])
})

it("surface: equal policy_strength + equal confidence -> sorted by risk_score DESC (Rust order)", () => {
  // All same policyStrength=0.75, same confidence=0.80, different riskScore
  // Rust order: risk_score DESC > stable priority > key
  const engine = makeState([
    makeHint("h_low_risk", "k1", "default", "domain_a", PolicyActionKind.Prefer, PolicyState.Stable, 0.75, 0.80, 0.1, { recommendation: "Low" }),
    makeHint("h_high_risk", "k2", "default", "domain_b", PolicyActionKind.Recommend, PolicyState.Stable, 0.75, 0.80, 0.9, { recommendation: "High" }),
    makeHint("h_mid_risk", "k3", "default", "domain_c", PolicyActionKind.Avoid, PolicyState.Stable, 0.75, 0.80, 0.5, { recommendation: "Mid" }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  // RED: current sort uses actionKind priority: Avoid(0) > Recommend(3) > Prefer(4)
  //   which would produce: h_mid_risk (Avoid), h_high_risk (Recommend), h_low_risk (Prefer)
  // Rust sort uses risk_score DESC: 0.9 > 0.5 > 0.1
  //   which would produce: h_high_risk, h_mid_risk, h_low_risk
  // These DIFFER: old actionKind sort puts h_mid_risk (Avoid) first,
  // Rust sort puts h_high_risk (risk=0.9) first
  const order = surfaced.map(h => h.id)
  assert.deepStrictEqual(order, ["h_high_risk", "h_mid_risk", "h_low_risk"])
})

it("surface: Stable hints appear before Candidate hints when all scores equal (Rust tiebreak)", () => {
  const engine = makeState([
    makeHint("h_candidate", "k1", "default", "domain_a", PolicyActionKind.Prefer, PolicyState.Candidate, 0.80, 0.80, 0.0, { recommendation: "C" }),
    makeHint("h_stable", "k2", "default", "domain_b", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.80, 0.0, { recommendation: "S" }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  // Rust: stable before candidate
  const order = surfaced.map(h => h.id)
  assert.deepStrictEqual(order, ["h_stable", "h_candidate"])
})

it("surface: hint with empty recommendation is filtered out", () => {
  const engine = makeState([
    makeHint("h_good", "k1", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0, { recommendation: "Good" }),
    makeHint("h_empty", "k2", "default", "deploy", PolicyActionKind.Prefer, PolicyState.Stable, 0.80, 0.75, 0.0, { recommendation: "" }),
  ])
  const surfaced = run(surfacePolicyHints(engine))
  assert.strictEqual(surfaced.length, 1)
  assert.strictEqual(surfaced[0]!.id, "h_good")
})
