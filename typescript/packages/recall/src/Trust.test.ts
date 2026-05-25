import { it } from "vitest"
import { assert } from "@effect/vitest"
import { computeEffectiveTrust, defaultTrustConfig } from "./Trust"

function makeMeta(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    trust_score: "0.5",
    source: "user-confirmed",
    timestamp: new Date(1_700_000_000_000).toISOString(),
    ...overrides
  }
}

it("defaultTrustConfig matches Rust defaults", () => {
  const cfg = defaultTrustConfig()
  assert.strictEqual(cfg.recency_boost_max, 0.2)
  assert.strictEqual(cfg.recency_half_life_days, 7.0)
  assert.strictEqual(cfg.source_trust["user-confirmed"], 1.0)
  assert.strictEqual(cfg.source_authority["user-telegram"], 1.2)
})

it("recency boost is max when age is 0", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const meta = makeMeta({ timestamp: new Date(now * 1000).toISOString() })
  const score = computeEffectiveTrust(meta, now, cfg, "recorded")
  // trust=0.5, recency=0.2, authority=1.2, source_type=1.0 => (0.5+0.2)*1.2 = 0.84
  assert.strictEqual(score, 0.84)
})

it("recency boost is 0 when age equals halfLife", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const ts = now - 7 * 86400 // exactly half_life days old
  const meta = makeMeta({ timestamp: new Date(ts * 1000).toISOString() })
  const score = computeEffectiveTrust(meta, now, cfg, "recorded")
  // trust=0.5, recency=0, authority=1.2, source_type=1.0 => 0.5*1.2 = 0.6
  assert.strictEqual(score, 0.6)
})

it("recency boost is 0 when age exceeds halfLife", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const ts = now - 30 * 86400 // 30 days old, > 7
  const meta = makeMeta({ timestamp: new Date(ts * 1000).toISOString() })
  const score = computeEffectiveTrust(meta, now, cfg, "recorded")
  // Same as halfLife case: trust=0.5, recency=0 => 0.6
  assert.strictEqual(score, 0.6)
})

it("falls back to 14 days old when timestamp is missing or unparsable", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000

  // Missing timestamp
  const metaMissing = makeMeta({ timestamp: "" })
  const scoreMissing = computeEffectiveTrust(metaMissing, now, cfg, "recorded")
  // age = 14 days => recency = 0.2 * (1 - 14/7) = 0.2 * (-1) => max(0, -0.2) = 0
  // => 0.5 * 1.2 = 0.6
  assert.strictEqual(scoreMissing, 0.6)

  // Unparsable timestamp
  const metaBad = makeMeta({ timestamp: "not-a-date" })
  const scoreBad = computeEffectiveTrust(metaBad, now, cfg, "recorded")
  assert.strictEqual(scoreBad, 0.6)
})

it("uses created_at fallback when timestamp is missing", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const meta: Record<string, string> = {
    trust_score: "0.5",
    source: "user-confirmed",
    created_at: new Date(now * 1000).toISOString()
  }
  const score = computeEffectiveTrust(meta, now, cfg, "recorded")
  // Same as age=0 case
  assert.strictEqual(score, 0.84)
})

it("source_type factors ordered correctly", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const ts = now - 30 * 86400 // old, so recency=0
  const meta = makeMeta({ timestamp: new Date(ts * 1000).toISOString() })

  const recorded = computeEffectiveTrust(meta, now, cfg, "recorded")
  const retrieved = computeEffectiveTrust(meta, now, cfg, "retrieved")
  const inferred = computeEffectiveTrust(meta, now, cfg, "inferred")
  const generated = computeEffectiveTrust(meta, now, cfg, "generated")
  const unknown = computeEffectiveTrust(meta, now, cfg, "unknown")

  assert.isTrue(recorded > retrieved, "recorded > retrieved")
  assert.isTrue(retrieved > inferred, "retrieved > inferred")
  assert.isTrue(inferred > generated, "inferred > generated")
  assert.strictEqual(unknown, retrieved, "unknown defaults to retrieved level")
})

it("clamps effective trust between 0.05 and 1.0", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000

  // High trust + high authority + fresh => could exceed 1.0
  const metaHigh = makeMeta({
    trust_score: "0.9",
    source: "user-telegram", // authority 1.2
    timestamp: new Date(now * 1000).toISOString()
  })
  const scoreHigh = computeEffectiveTrust(metaHigh, now, cfg, "recorded")
  // (0.9 + 0.2) * 1.2 = 1.32 => clamped to 1.0
  assert.strictEqual(scoreHigh, 1.0)

  // Very low trust => clamped to 0.05 floor
  const metaLow: Record<string, string> = {
    trust_score: "0.01",
    source: "agent-worker", // authority 0.7
    timestamp: new Date((now - 30 * 86400) * 1000).toISOString()
  }
  const scoreLow = computeEffectiveTrust(metaLow, now, cfg, "generated")
  // 0.01 * 0.7 * 0.8 = 0.0056 => clamped to 0.05
  assert.strictEqual(scoreLow, 0.05)
})

it("defaults trust_score to 0.5 when missing or invalid", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const ts = now - 30 * 86400

  const metaMissing = makeMeta({ trust_score: "", timestamp: new Date(ts * 1000).toISOString() })
  const scoreMissing = computeEffectiveTrust(metaMissing, now, cfg, "recorded")

  const metaInvalid = makeMeta({ trust_score: "abc", timestamp: new Date(ts * 1000).toISOString() })
  const scoreInvalid = computeEffectiveTrust(metaInvalid, now, cfg, "recorded")

  // Both should fall back to trust=0.5 => 0.5 * 1.2 = 0.6
  assert.strictEqual(scoreMissing, 0.6)
  assert.strictEqual(scoreInvalid, 0.6)
})

it("defaults source authority to 0.85 when unknown", () => {
  const cfg = defaultTrustConfig()
  const now = 1_700_000_000
  const ts = now - 30 * 86400
  const meta = makeMeta({ source: "unknown-source", timestamp: new Date(ts * 1000).toISOString() })
  const score = computeEffectiveTrust(meta, now, cfg, "recorded")
  // trust=0.5, recency=0, authority=0.85 => 0.5 * 0.85 = 0.425 => clamped to 0.05
  // Wait: 0.425 is above 0.05, so no clamp
  assert.strictEqual(score, 0.425)
})
