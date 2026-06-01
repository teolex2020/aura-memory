/**
 * Policy Surface Functions — advisory action hints over causal, concept, and belief layers.
 *
 * These pure computations filter, sort, and map contract PolicyEngineState
 * directly into external-facing SurfacedPolicyHint views. No IO, no side effects.
 *
 * @module @aura/policy
 */

import { Effect } from "effect"
import {
  PolicyState,
  type SurfacedPolicyHint,
  type PolicyEngineState,
  type PolicyHint,
} from "@aura/contract"

// ── Constants ──

/** Minimum policy_strength for a Candidate to be surfaced. */
const STRONG_CANDIDATE_THRESHOLD = 0.70

/** Minimum confidence for surfacing. */
const MIN_SURFACE_CONFIDENCE = 0.55

/** Maximum total surfaced hints. */
const MAX_SURFACED_HINTS = 10

/** Maximum surfaced hints per domain. */
const MAX_SURFACED_PER_DOMAIN = 3

// ── Types ──

/** Maps PolicyState to its external string representation. */
function stateString(state: PolicyState): SurfacedPolicyHint["state"] {
  if (state === PolicyState.Stable) return "stable"
  if (state === PolicyState.Candidate) return "candidate"
  return "candidate"
}

function hintKey(hint: PolicyHint): string {
  return hint.cause_key || hint.pattern_id || hint.id
}

// ── Helper: is hint eligible for surfacing? ──

function isHintEligible(hint: PolicyHint, namespace?: string): boolean {
  // Namespace filter
  if (namespace !== undefined && hint.namespace !== namespace) return false

  // Must have provenance
  if (hint.cause_record_ids.length === 0 || hint.effect_keys.length === 0) return false

  // Must have non-empty domain and recommendation
  if (hint.domain.length === 0 || hint.recommendation.length === 0) return false

  // State gate
  switch (hint.state) {
    case PolicyState.Stable:
      return true
    case PolicyState.Candidate:
      return hint.policyStrength >= STRONG_CANDIDATE_THRESHOLD && hint.confidence >= MIN_SURFACE_CONFIDENCE
    case PolicyState.Suppressed:
    case PolicyState.Rejected:
      return false
  }
}

// ── Helper: map contract hint to surfaced hint ──

function toSurfaced(hint: PolicyHint): SurfacedPolicyHint {
  return {
    id: hint.id,
    state: stateString(hint.state),
    actionKind: hint.actionKind,
    namespace: hint.namespace,
    domain: hint.domain,
    // Truncate recommendation to 200 characters
    recommendation: hint.recommendation.length > 200
      ? hint.recommendation.slice(0, 200)
      : hint.recommendation,
    policyStrength: hint.policyStrength,
    riskScore: hint.riskScore,
    triggerCausalIds: hint.cause_record_ids,
  }
}

// ── Public API ──

/**
 * Surface policy hints for external consumption.
 *
 * Filters eligible hints (Stable or strong Candidate with provenance),
 * sorts by Rust-aligned order (policyStrength DESC -> confidence DESC ->
 * risk_score DESC -> stable priority -> key ASC), enforces per-domain
 * and global caps, and deduplicates by key and recommendation text.
 */
export function surfacePolicyHints(
  state: PolicyEngineState,
  limit?: number
): Effect.Effect<readonly SurfacedPolicyHint[]> {
  return surfacePolicyHintsFiltered(state, limit, undefined)
}

/**
 * Surface policy hints with optional namespace filter.
 *
 * Same filtering/sorting/capping as {@link surfacePolicyHints}, but only
 * includes hints from the given namespace when specified.
 */
export function surfacePolicyHintsFiltered(
  state: PolicyEngineState,
  limit?: number,
  namespace?: string
): Effect.Effect<readonly SurfacedPolicyHint[]> {
  const max = limit !== undefined ? Math.min(limit, MAX_SURFACED_HINTS) : MAX_SURFACED_HINTS

  // Phase A+B: filter eligible hints
  const eligible = Object.values(state.hints).filter((hint) => isHintEligible(hint, namespace))

  // Phase C: sort — Rust policy.rs surface_policy_hints sort (lines 978-999)
  // policy_strength DESC -> confidence DESC -> risk_score DESC -> stable before candidate -> key ASC
  eligible.sort((a, b) => {
    // Primary: policyStrength descending
    const strengthDiff = b.policyStrength - a.policyStrength
    if (strengthDiff !== 0) return strengthDiff

    // Secondary: confidence descending
    const confDiff = b.confidence - a.confidence
    if (confDiff !== 0) return confDiff

    // Tertiary: riskScore descending
    const riskDiff = b.riskScore - a.riskScore
    if (riskDiff !== 0) return riskDiff

    // Tiebreak: Stable before Candidate
    if (a.state === PolicyState.Stable && b.state !== PolicyState.Stable) return -1
    if (a.state !== PolicyState.Stable && b.state === PolicyState.Stable) return 1

    // Final tiebreak: key (deterministic)
    const aKey = hintKey(a)
    const bKey = hintKey(b)
    if (aKey < bKey) return -1
    if (aKey > bKey) return 1
    return 0
  })

  // Phase D: per-domain cap + global limit + dedup
  const result: SurfacedPolicyHint[] = []
  const domainCounts = new Map<string, number>()
  const seenKeys = new Set<string>()
  const seenRecommendations = new Set<string>()

  for (const hint of eligible) {
    if (result.length >= max) break

    // Dedupe by key
    const key = hintKey(hint)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    // Dedupe identical recommendation text
    if (seenRecommendations.has(hint.recommendation)) continue
    seenRecommendations.add(hint.recommendation)

    // Per-domain cap
    const count = domainCounts.get(hint.domain) ?? 0
    if (count >= MAX_SURFACED_PER_DOMAIN) continue
    domainCounts.set(hint.domain, count + 1)

    // Phase E: map to surfaced type
    result.push(toSurfaced(hint))
  }

  return Effect.succeed(result)
}

// ── Re-exports for downstream consumers ──

export { PolicyActionKind, PolicyState } from "@aura/contract"
export type { PolicyEngineState, PolicyHint, SurfacedPolicyHint } from "@aura/contract"
