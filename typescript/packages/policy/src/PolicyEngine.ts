import { Effect, Layer, Option } from "effect"
import { xxh3_64 } from "@aura/utils"
import {
  PolicyEngine,
  PolicyActionKind,
  Polarity,
  PolicyState,
  EpistemicTrace,
  serviceOption,
  Clock,
  type CausalEngine,
  type BeliefEngine,
  type ConceptEngine,
  type PolicyEngineState,
  type PolicyHint,
  type PolicyReport,
  type Record as AuraRecord,
  type CausalEngineState,
  type CausalPattern,
  type BeliefEngineState,
  type ConceptEngineState,
} from "@aura/contract"
import { EvidenceMode, CausalState, BeliefState, ConceptState } from "@aura/contract"
import {
  meetsEvidenceGate,
  meetsCounterfactualGate,
} from "@aura/causal"

export { PolicyState } from "@aura/contract"

// ═══════════════════════════════════════════════════════════════════════════
// Constants (Rust-aligned policy.rs lines 28-38)
// ═══════════════════════════════════════════════════════════════════════════

/** Minimum causal_strength to consider a pattern as policy seed. */
const MIN_CAUSAL_STRENGTH_FOR_SEED = 0.65
/** Minimum supporting observations before a causal pattern can seed policy hints. */
const MIN_CAUSAL_SUPPORT_FOR_SEED = 2

// ═══════════════════════════════════════════════════════════════════════════
// PolicySeed — internal seed structure with provenance
// ═══════════════════════════════════════════════════════════════════════════

type PolicySeed = {
  pattern: CausalPattern
  cause_belief_id: string | null
  effect_belief_id: string | null
  cause_record_ids: string[]
  effect_record_ids: string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure helper gates (local to PolicyEngine)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strength gate: Stable patterns always pass; Candidate patterns need
 * causal_strength >= 0.65; ExplicitTrusted bypass for weak Candidates
 * if they have explicit support and are not Rejected/Invalidated.
 * Matches Rust policy.rs seed filter lines 275-281.
 */
function meetsSeedStrengthGate(
  pattern: CausalPattern,
  evidenceMode: EvidenceMode
): boolean {
  if (pattern.state === CausalState.Stable) return true
  if (pattern.state === CausalState.Candidate && pattern.causal_strength >= MIN_CAUSAL_STRENGTH_FOR_SEED) return true
  if (
    evidenceMode === EvidenceMode.ExplicitTrusted &&
    pattern.explicit_support_count >= 1 &&
    pattern.state !== CausalState.Rejected &&
    pattern.state !== CausalState.Invalidated
  ) return true
  return false
}

/**
 * Support gate: support_count >= 2, or ExplicitTrusted bypass with explicit_support >= 1.
 * Matches Rust policy.rs seed filter lines 283-286.
 */
function meetsSeedSupportGate(
  pattern: CausalPattern,
  evidenceMode: EvidenceMode
): boolean {
  if (pattern.support_count >= MIN_CAUSAL_SUPPORT_FOR_SEED) return true
  if (evidenceMode === EvidenceMode.ExplicitTrusted && pattern.explicit_support_count >= 1) return true
  return false
}

/**
 * Counterevidence gate: counterevidence must not exceed half the support.
 * Matches Rust meets_counterevidence_gate (simple ratio check).
 */
function meetsSeedCounterevidenceGate(pattern: CausalPattern): boolean {
  return pattern.counterevidence_count <= pattern.support_count / 2
}

/**
 * Belief gate: at least one cause-side belief must be Resolved or Singleton,
 * OR ExplicitTrusted bypass with explicit support.
 * Matches Rust policy.rs seed filter lines 313-321.
 */
function meetsSeedBeliefGate(
  pattern: CausalPattern,
  beliefState: BeliefEngineState,
  evidenceMode: EvidenceMode
): boolean {
  // Check cause belief
  const causeBid = pattern.cause_belief_id
  if (causeBid) {
    const belief = beliefState.beliefs[causeBid]
    if (belief &&
      (belief.state === BeliefState.Resolved || belief.state === BeliefState.Singleton)) {
      return true
    }
  }
  // ExplicitTrusted bypass
  if (evidenceMode === EvidenceMode.ExplicitTrusted && pattern.explicit_support_count >= 1) {
    return true
  }
  return false
}

// ═══════════════════════════════════════════════════════════════════════════
// Seed selection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Select causal pattern seeds for policy hint generation.
 *
 * Applies 6 gates (strength, support, evidence, counterevidence,
 * counterfactual, belief) to filter patterns from the causal engine.
 *
 * Matches Rust policy.rs discover seed filter lines 268-329.
 */
function selectSeeds(
  causalState: CausalEngineState,
  beliefState: BeliefEngineState,
  evidenceMode: EvidenceMode
): PolicySeed[] {
  const seeds: PolicySeed[] = []

  for (const pattern of Object.values(causalState.patterns)) {
    // Gate 1: Strength
    if (!meetsSeedStrengthGate(pattern, evidenceMode)) continue

    // Gate 2: Support
    if (!meetsSeedSupportGate(pattern, evidenceMode)) continue

    // Gate 3: Evidence (combined support + repeated evidence)
    // Try StrictRepeatedWindows first; fall back to mode-specific
    const evidenceOk =
      meetsEvidenceGate(pattern, EvidenceMode.StrictRepeatedWindows) ||
      (evidenceMode === EvidenceMode.ExplicitTrusted &&
        meetsEvidenceGate(pattern, EvidenceMode.ExplicitTrusted)) ||
      (evidenceMode === EvidenceMode.TemporalClusterRecovery &&
        meetsEvidenceGate(pattern, EvidenceMode.TemporalClusterRecovery) &&
        pattern.explicit_support_count === 0 &&
        pattern.explicit_support_total_for_cause === 0 &&
        pattern.counterevidence_count === 0 &&
        pattern.positive_effect_signals > 0 &&
        pattern.negative_effect_signals === 0)
    if (!evidenceOk) continue

    // Gate 4: Counterevidence
    if (!meetsSeedCounterevidenceGate(pattern)) continue

    // Gate 5: Counterfactual
    if (!meetsCounterfactualGate(pattern, evidenceMode)) continue

    // Gate 6: Belief
    if (!meetsSeedBeliefGate(pattern, beliefState, evidenceMode)) continue

    // All gates passed — add to seeds
    seeds.push({
      pattern,
      cause_belief_id: pattern.cause_belief_id ?? null,
      effect_belief_id: pattern.effect_belief_id ?? null,
      cause_record_ids: [...pattern.cause_record_ids],
      effect_record_ids: [...pattern.effect_record_ids],
    })
  }

  return seeds
}

// ═══════════════════════════════════════════════════════════════════════════
// PolicyEngineImpl
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Policy Extraction Layer — extracts actionable hints from causal patterns.
 *
 * 策略提取层：从因果模式中提取可操作的策略提示。
 *
 * Fifth tier of the cognitive hierarchy:
 *   Record → Belief → Concept → Causal Pattern → Policy
 */
export class PolicyEngineImpl implements PolicyEngine.Interface {
  private state: PolicyEngineState = {
    version: 1 as const,
    hints: {},
    metadata: {},
    key_index: {}
  }

  /**
   * Full rebuild: discover policy hints from causal patterns, concepts, and beliefs.
   *
   * Algorithm (P1):
   *   A. Select policy-worthy causal seeds (6 gates)
   *   B. [P2] Classify outcome polarity
   *   C. [P2] Map to action kind
   *   D. [P2] Build hints with scoring
   *   E. [P2] Suppression + state classification
   *
   * Matches Rust PolicyEngine::discover (policy.rs lines 251-417).
   */
  discover(
    causal_engine: CausalEngine.Interface,
    concept_engine: ConceptEngine.Interface,
    belief_engine: BeliefEngine.Interface,
    records: ReadonlyMap<string, AuraRecord>
  ): Effect.Effect<PolicyReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined
      if (trace) yield* trace.event("policy.discover.start", {})

      self.state = {
        version: 1 as const,
        hints: {},
        metadata: {},
        key_index: {},
      }

      // ── Phase A: Select causal seeds (6 gates) ──
      const causalState = yield* causal_engine.stats()
      const beliefState = yield* belief_engine.stats()
      const evidenceMode = causalState.evidence_mode

      const seeds = selectSeeds(causalState, beliefState, evidenceMode)
      const seedsFound = seeds.length

      if (seedsFound === 0) {
        if (trace) {
          yield* trace.event("policy.discover.end", { hints_found: 0 })
        }
        return {
          hints_found: 0,
          hints_active: 0,
          hints_suppressed: 0,
          avg_confidence: 0,
          seeds_found: 0,
          stable_hints: 0,
          suppressed_hints: 0,
          rejected_hints: 0,
          avg_policy_strength: 0,
        }
      }

      // ── P2: Build hints from seeds (scoring + recommendation) ──
      const conceptState = yield* concept_engine.stats()
      const nowSecs = yield* Clock.nowSeconds()
      const hints = buildHints(seeds, conceptState, records, nowSecs, beliefState.beliefs)
      const hintsFound = hints.length

      // ── Store generated hints as candidates before suppression ──
      const newHints: Record<string, PolicyHint> = {}
      const newKeyIndex: Record<string, string> = {}
      let strengthSum = 0
      let confidenceSum = 0
      for (const hint of hints) {
        newHints[hint.id] = hint
        newKeyIndex[hint.cause_key] = hint.id
        strengthSum += hint.policyStrength
        confidenceSum += hint.confidence
      }

      // ── Phase E: Suppression (Rust lines 727-786) ──
      const hintValues = Object.values(newHints)
      const suppressed = applySuppression(hintValues)
      let finalStableHints = 0
      let finalCandidateHints = 0
      let finalSuppressed = 0
      let finalRejected = 0
      const finalHints: Record<string, PolicyHint> = {}
      for (const hint of suppressed) {
        let classified = hint
        if (hint.state === PolicyState.Suppressed) {
          finalSuppressed++
        } else {
          const nextState = hint.policyStrength >= STABLE_THRESHOLD
            ? PolicyState.Stable
            : hint.policyStrength >= CANDIDATE_THRESHOLD
              ? PolicyState.Candidate
              : PolicyState.Rejected
          classified = { ...hint, state: nextState }
          if (nextState === PolicyState.Stable) finalStableHints++
          else if (nextState === PolicyState.Candidate) finalCandidateHints++
          else if (nextState === PolicyState.Rejected) finalRejected++
        }
        finalHints[classified.id] = classified
      }
      self.state = { ...self.state, hints: finalHints, key_index: newKeyIndex }

      if (trace) {
        yield* trace.event("policy.discover.end", {
          seeds: seedsFound,
          hints: hintsFound,
        })
      }

      const avgPolicyStrength = hintsFound > 0 ? strengthSum / hintsFound : 0
      const avgConfidence = hintsFound > 0 ? confidenceSum / hintsFound : 0

      const report: PolicyReport = {
        hints_found: hintsFound,
        hints_active: finalStableHints + finalCandidateHints,
        hints_suppressed: finalSuppressed,
        avg_confidence: avgConfidence,
        seeds_found: seedsFound,
        stable_hints: finalStableHints,
        suppressed_hints: finalSuppressed,
        rejected_hints: finalRejected,
        avg_policy_strength: avgPolicyStrength,
      }

      return report
    })
  }

  retract_hint(id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const removed = self.state.hints[id]
      if (!removed) return
      const { [id]: _removed, ...remaining } = self.state.hints
      const { [removed.cause_key]: _removedKey, ...remainingKeyIndex } = self.state.key_index
      self.state = { ...self.state, hints: remaining, key_index: remainingKeyIndex }
    })
  }

  stats(): Effect.Effect<PolicyEngineState> {
    return Effect.succeed(this.state)
  }
}

export const PolicyEngineLive = Layer.succeed(PolicyEngine, new PolicyEngineImpl())

// ═══════════════════════════════════════════════════════════════════════════
// Polarity classification (Rust-aligned policy.rs lines 44-78, 421-496)
// ═══════════════════════════════════════════════════════════════════════════

/** Negative outcome keywords (Rust-aligned policy.rs lines 44-60). */
const NEGATIVE_KEYWORDS = [
  "error", "failure", "fail", "crash", "bug", "incident",
  "rollback", "revert", "risk", "vulnerability", "downtime",
  "outage", "regression", "contradiction", "conflict",
]

/** Positive outcome keywords (Rust-aligned policy.rs lines 63-78). */
const POSITIVE_KEYWORDS = [
  "success", "improvement", "improve", "faster", "reliable",
  "stable", "healthy", "secure", "optimized", "resolved",
  "fixed", "deployed", "completed", "approved",
]

/**
 * Count positive and negative outcome signals from effect-side records.
 *
 * Checks 4 dimensions per record:
 *   1. semantic_type === "contradiction" → negativeSignals += 2
 *   2. Tags against NEGATIVE_KEYWORDS (case-insensitive contains)
 *   3. Tags against POSITIVE_KEYWORDS (case-insensitive contains)
 *   4. Content against NEGATIVE_KEYWORDS
 *   5. Content against POSITIVE_KEYWORDS
 *
 * Matches Rust policy.rs polarity_signal_counts (lines 454-496).
 */
export function polaritySignalCounts(
  effectRecordIds: ReadonlyArray<string>,
  records: ReadonlyMap<string, AuraRecord>
): { positiveSignals: number; negativeSignals: number } {
  let positiveSignals = 0
  let negativeSignals = 0

  for (const eid of effectRecordIds) {
    const rec = records.get(eid)
    if (!rec) continue

    // Check semantic_type
    if (rec.semantic_type === "contradiction") {
      negativeSignals += 2
    }

    // Check tags
    for (const tag of rec.tags) {
      const tagLower = tag.toLowerCase()
      for (const kw of NEGATIVE_KEYWORDS) {
        if (tagLower.includes(kw)) {
          negativeSignals += 1
        }
      }
      for (const kw of POSITIVE_KEYWORDS) {
        if (tagLower.includes(kw)) {
          positiveSignals += 1
        }
      }
    }

    // Check content keywords
    const contentLower = (rec.content ?? "").toLowerCase()
    for (const kw of NEGATIVE_KEYWORDS) {
      if (contentLower.includes(kw)) {
        negativeSignals += 1
      }
    }
    for (const kw of POSITIVE_KEYWORDS) {
      if (contentLower.includes(kw)) {
        positiveSignals += 1
      }
    }
  }

  return { positiveSignals, negativeSignals }
}

/**
 * Classify outcome polarity of a pattern by examining effect-side records.
 *
 * Rules:
 *   - negativeSignals > positiveSignals AND negativeSignals >= 2 → Negative
 *   - positiveSignals > negativeSignals AND positiveSignals >= 2 → Positive
 *   - Otherwise → Neutral
 *
 * Matches Rust policy.rs classify_polarity (lines 423-437).
 */
export function classifyPolarity(
  effectRecordIds: ReadonlyArray<string>,
  records: ReadonlyMap<string, AuraRecord>
): Polarity {
  const { positiveSignals, negativeSignals } = polaritySignalCounts(effectRecordIds, records)

  if (negativeSignals > positiveSignals && negativeSignals >= 2) {
    return Polarity.Negative
  } else if (positiveSignals > negativeSignals && positiveSignals >= 2) {
    return Polarity.Positive
  } else {
    return Polarity.Neutral
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Action kind mapping (Rust-aligned policy.rs lines 500-508)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map polarity + causal_strength to a PolicyActionKind.
 *
 * | Polarity + Strength               | Action Kind      |
 * |-----------------------------------|------------------|
 * | Negative + strength >= 0.75       | Avoid            |
 * | Negative                          | VerifyFirst      |
 * | Positive + strength >= 0.75       | Prefer           |
 * | Positive                          | Recommend        |
 * | Neutral                           | Warn             |
 *
 * Matches Rust policy.rs map_action_kind (lines 500-508).
 */
export function mapActionKind(
  polarity: Polarity,
  causalStrength: number
): PolicyActionKind {
  switch (polarity) {
    case Polarity.Negative:
      return causalStrength >= 0.75
        ? PolicyActionKind.Avoid
        : PolicyActionKind.VerifyFirst
    case Polarity.Positive:
      return causalStrength >= 0.75
        ? PolicyActionKind.Prefer
        : PolicyActionKind.Recommend
    case Polarity.Neutral:
      return PolicyActionKind.Warn
  }
}

function hasMixedExplicitOutcomeAmbiguity(
  pattern: CausalPattern,
  records: ReadonlyMap<string, AuraRecord>
): boolean {
  if (
    pattern.explicit_support_count < MIN_CAUSAL_SUPPORT_FOR_SEED ||
    pattern.effect_record_signature_variants <= 1
  ) {
    return false
  }

  const { positiveSignals, negativeSignals } = polaritySignalCounts(pattern.effect_record_ids, records)
  return positiveSignals >= 2 && negativeSignals >= 2
}

/**
 * Rust policy action kind string used in stable policy hint keys.
 * Rust reference: `action_kind_str` (`../src/policy.rs`).
 */
function actionKindKey(kind: PolicyActionKind): string {
  switch (kind) {
    case PolicyActionKind.Avoid:
      return "avoid"
    case PolicyActionKind.VerifyFirst:
      return "verify"
    case PolicyActionKind.Prefer:
      return "prefer"
    case PolicyActionKind.Recommend:
      return "recommend"
    case PolicyActionKind.Warn:
      return "warn"
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Policy strength scoring (Rust-aligned policy.rs lines 33-37, 589-604)
// ═══════════════════════════════════════════════════════════════════════════

/// Scoring weights (Rust policy.rs lines 34-37).
const W_CAUSAL = 0.35
const W_CONFIDENCE = 0.25
const W_UTILITY = 0.20
const W_STABILITY = 0.20

/**
 * Compute 4-dimension policy strength score.
 *
 * Formula: 0.35*causal_strength + 0.25*confidence + 0.20*utilityScore + 0.20*stability
 * Clamped to [0, 1].
 *
 * Matches Rust policy.rs build_hint lines 601-604.
 */
export function computePolicyStrength(params: {
  causal_strength: number
  confidence: number
  utilityScore: number
  stability: number
}): number {
  const raw =
    W_CAUSAL * params.causal_strength +
    W_CONFIDENCE * params.confidence +
    W_UTILITY * params.utilityScore +
    W_STABILITY * params.stability
  return Math.max(0, Math.min(1.0, raw))
}

/// State thresholds (Rust policy.rs lines 40-41).
const STABLE_THRESHOLD = 0.75
const CANDIDATE_THRESHOLD = 0.50

/**
 * Generate deterministic recommendation text from template.
 *
 * 5 templates matching Rust policy.rs generate_recommendation (lines 694-719).
 */
export function generateRecommendation(
  actionKind: import("@aura/contract").PolicyActionKind,
  causeSummary: string,
  domain: string
): string {
  // Templates verified against Rust policy.rs generate_recommendation (lines 694-719)
  switch (actionKind) {
    case PolicyActionKind.Avoid:
      return `Avoid: '${causeSummary}' in domain [${domain}] has been associated with negative outcomes.`
    case PolicyActionKind.VerifyFirst:
      return `Verify first: '${causeSummary}' in domain [${domain}] has shown risk signals — check before proceeding.`
    case PolicyActionKind.Prefer:
      return `Prefer: '${causeSummary}' in domain [${domain}] has consistently led to positive outcomes.`
    case PolicyActionKind.Recommend:
      return `Recommend: '${causeSummary}' in domain [${domain}] has shown positive signals.`
    case PolicyActionKind.Warn:
      return `Warning: '${causeSummary}' in domain [${domain}] has a strong causal pattern but unclear polarity.`
    default:
      return `Warning: '${causeSummary}' in domain [${domain}] has a strong causal pattern but unclear polarity.`
  }
}

/**
 * Aggregate confidence from resolved beliefs.
 *
 * Averages confidence of Resolved/Singleton beliefs from the belief engine.
 * The caller applies Rust's record-level/neutral fallback when this returns 0.
 *
 * Matches Rust policy.rs aggregate_belief_confidence (lines 654-677).
 *
 * @param beliefIds - IDs of beliefs to aggregate confidence from.
 * @param beliefs - Pre-fetched belief state snapshot from BeliefEngine.
 */
function aggregateBeliefConfidence(
  beliefIds: string[],
  beliefs: Readonly<Record<string, { confidence: number; state: BeliefState }>>
): number {
  let sum = 0
  let count = 0
  for (const bid of beliefIds) {
    const belief = beliefs[bid]
    if (
      belief &&
      (belief.state === BeliefState.Resolved || belief.state === BeliefState.Singleton)
    ) {
      sum += belief.confidence
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

// ═══════════════════════════════════════════════════════════════════════════
// Hint building (Rust-aligned policy.rs build_hint lines 540-628)
// ═══════════════════════════════════════════════════════════════════════════

/** Truncate string to max chars, adding "..." if shortened. */
function truncate(s: string, maxChars: number): string {
  const chars = Array.from(s)
  if (chars.length <= maxChars) return s
  return `${chars.slice(0, maxChars).join("")}...`
}

/** Extract domain from the most common tags of cause records. */
function extractDomain(
  pattern: CausalPattern,
  records: ReadonlyMap<string, AuraRecord>
): string {
  const tagCounts = new Map<string, number>()
  for (const rid of pattern.cause_record_ids) {
    const rec = records.get(rid)
    if (rec) {
      for (const tag of rec.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
  }
  const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])
  return sorted.slice(0, 2).map(([tag]) => tag).join("/")
}

function buildBeliefToConcepts(conceptState: ConceptEngineState): Readonly<Record<string, ReadonlyArray<string>>> {
  const map: Record<string, string[]> = {}
  for (const [conceptId, concept] of Object.entries(conceptState.concepts)) {
    if (concept.state !== ConceptState.Stable) continue
    for (const beliefId of concept.belief_ids) {
      const ids = map[beliefId] ?? []
      if (!ids.includes(conceptId)) ids.push(conceptId)
      map[beliefId] = ids
    }
  }
  return map
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  const out: string[] = []
  for (const value of values) {
    if (!out.includes(value)) out.push(value)
  }
  return out
}

function averageRecordConfidence(
  recordIds: ReadonlyArray<string>,
  records: ReadonlyMap<string, AuraRecord>
): number {
  let sum = 0
  let count = 0
  for (const recordId of recordIds) {
    const record = records.get(recordId)
    if (!record) continue
    sum += record.confidence
    count++
  }
  return count > 0 ? sum / count : 0.50
}

/**
 * Build PolicyHints from selected seeds.
 *
 * Pure function: scoring + recommendation generation.
 * Matches Rust policy.rs build_hint.
 */
function buildHints(
  seeds: PolicySeed[],
  conceptState: ConceptEngineState,
  records: ReadonlyMap<string, AuraRecord>,
  nowSecs: number,
  beliefs: Readonly<Record<string, { confidence: number; state: BeliefState }>>
): PolicyHint[] {
  const hints: PolicyHint[] = []
  const beliefToConcepts = buildBeliefToConcepts(conceptState)

  for (const seed of seeds) {
    const pattern = seed.pattern
    if (hasMixedExplicitOutcomeAmbiguity(pattern, records)) continue

    // Extract domain from cause record tags
    const domain = extractDomain(pattern, records)

    // Get cause summary from first cause record (Rust: truncated to 80 chars)
    const firstCauseRid = pattern.cause_record_ids[0]
    const causeSummary = firstCauseRid
      ? truncate(records.get(firstCauseRid)?.content ?? "this action", 80)
      : "this action"

    // Classify polarity from effect records
    const polarity = classifyPolarity(pattern.effect_record_ids, records)

    // Map to action kind
    const actionKind = mapActionKind(polarity, pattern.causal_strength)

    // ── Scoring ──
    const causal_strength = pattern.causal_strength

    const allBeliefIds = uniqueStrings([
      pattern.cause_belief_id,
      pattern.effect_belief_id,
    ].filter((id) => id.length > 0))
    const allRecordIds = uniqueStrings([...pattern.cause_record_ids, ...pattern.effect_record_ids])
    const conceptIds: string[] = []
    for (const beliefId of allBeliefIds) {
      for (const conceptId of beliefToConcepts[beliefId] ?? []) {
        if (!conceptIds.includes(conceptId)) conceptIds.push(conceptId)
      }
    }

    const beliefConfidence = aggregateBeliefConfidence(allBeliefIds, beliefs)
    const confidence = beliefConfidence > 0
      ? beliefConfidence
      : averageRecordConfidence(allRecordIds, records)

    // Utility: outcome stability * temporal consistency (Rust line 589)
    const utilityScore = Math.min(1.0, pattern.outcome_stability * pattern.temporal_consistency)

    // Risk: polarity-based (Rust lines 592-596)
    const riskScore = polarity === Polarity.Negative ? causal_strength * 0.8
      : polarity === Polarity.Neutral ? causal_strength * 0.3
      : 0.0

    // Stability proxy: temporal_consistency (Rust line 599)
    const stability = pattern.temporal_consistency

    // Policy strength: 4-dim weighted sum
    const policyStrength = computePolicyStrength({
      causal_strength,
      confidence,
      utilityScore,
      stability,
    })

    // Recommendation text
    const recommendation = generateRecommendation(actionKind, causeSummary, domain)

    // ── Deterministic ID from key ──
    const key = `${pattern.namespace}:${actionKindKey(actionKind)}:${pattern.cause_key}`
    const id = `p-${xxh3_64(key).toString(16).padStart(12, "0")}`

    // ── Build PolicyHint ──
    const hint: PolicyHint = {
      id,
      pattern_id: pattern.id,
      condition: `${domain} ${polarity}`,
      action: actionKind,
      priority: Math.round(policyStrength * 10),
      confidence,
      state: PolicyState.Candidate, // classified later
      last_updated: nowSecs,
      actionKind,
      policyStrength,
      riskScore,
      namespace: pattern.namespace,
      domain,
      polarity,
      recommendation,
      utilityScore,
      cause_key: key,
      effect_keys: [...pattern.effect_record_ids],
      cause_record_ids: [...pattern.cause_record_ids],
      trigger_causal_ids: [pattern.id],
      trigger_concept_ids: conceptIds,
      trigger_belief_ids: allBeliefIds,
      supporting_record_ids: allRecordIds,
    }
    hints.push(hint)
  }

  return hints
}

// ═══════════════════════════════════════════════════════════════════════════
// Suppression (Rust-aligned policy.rs apply_suppression lines 727-786)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply suppression: detect conflicting hints in same namespace+domain
 * with opposite polarity + overlapping cause_record_ids, and suppress
 * the lower-strength hint; exact ties suppress the later pair member as in Rust.
 *
 * Matches Rust policy.rs apply_suppression.
 */
export function applySuppression(hints: PolicyHint[]): PolicyHint[] {
  const result = [...hints]
  const toSuppress = new Set<number>()

  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i]!
      const b = result[j]!

      // Same namespace + domain
      if (a.namespace !== b.namespace || a.domain !== b.domain) continue

      // Check opposite polarity: one positive (Prefer/Recommend), one negative (Avoid/VerifyFirst)
      const aPositive = a.actionKind === PolicyActionKind.Prefer || a.actionKind === PolicyActionKind.Recommend
      const bPositive = b.actionKind === PolicyActionKind.Prefer || b.actionKind === PolicyActionKind.Recommend

      if (aPositive === bPositive) continue // same direction — no conflict

      // Check overlapping cause_record_ids
      const aCauses = new Set(a.cause_record_ids)
      const overlap = b.cause_record_ids.filter(id => aCauses.has(id))
      if (overlap.length === 0) continue // no shared cause records — not a real conflict

      if (a.policyStrength < b.policyStrength) {
        toSuppress.add(i)
      } else {
        toSuppress.add(j)
      }
    }
  }

  // Apply suppression
  for (const idx of toSuppress) {
    result[idx] = { ...result[idx]!, state: PolicyState.Suppressed }
  }

  return result
}
