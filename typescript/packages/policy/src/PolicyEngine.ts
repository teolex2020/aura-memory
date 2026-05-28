import { Effect, Layer, Option } from "effect"
import {
  PolicyEngine,
  PolicyActionKind,
  PolicyState,
  EpistemicTrace,
  serviceOption,
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
  type BeliefState,
} from "@aura/contract"
import { EvidenceMode, CausalState } from "@aura/contract"
import {
  meetsSupportGate,
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
      (belief.state === "Resolved" as string || belief.state === "Singleton" as string)) {
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
export class PolicyEngineImpl {
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

      // ── P2: Polarity classification, action mapping, hint building ──
      // Deferred to Task 2 (polarity classification + action mapping + MaintenanceService update)
      let hintsFound = 0
      let stableHints = 0
      let suppressedHints = 0
      let rejectedHints = 0
      let strengthSum = 0

      // For now (P1), we count seeds but don't build hints yet
      // Full hint construction will be added in Task 2

      if (trace) {
        yield* trace.event("policy.discover.end", {
          seeds: seedsFound,
          hints: hintsFound,
        })
      }

      const avgPolicyStrength = hintsFound > 0 ? strengthSum / hintsFound : 0

      const report: PolicyReport = {
        hints_found: hintsFound,
        hints_active: stableHints,
        hints_suppressed: suppressedHints,
        avg_confidence: 0,
        seeds_found: seedsFound,
        stable_hints: stableHints,
        suppressed_hints: suppressedHints,
        rejected_hints: rejectedHints,
        avg_policy_strength: avgPolicyStrength,
      }

      return report
    })
  }

  retract_hint(id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const { [id]: _removed, ...remaining } = self.state.hints
      self.state = { ...self.state, hints: remaining }
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
  effectRecordIds: string[],
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
  effectRecordIds: string[],
  records: ReadonlyMap<string, AuraRecord>
): "Positive" | "Negative" | "Neutral" {
  const { positiveSignals, negativeSignals } = polaritySignalCounts(effectRecordIds, records)

  if (negativeSignals > positiveSignals && negativeSignals >= 2) {
    return "Negative"
  } else if (positiveSignals > negativeSignals && positiveSignals >= 2) {
    return "Positive"
  } else {
    return "Neutral"
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
  polarity: "Positive" | "Negative" | "Neutral",
  causalStrength: number
): typeof PolicyActionKind {
  switch (polarity) {
    case "Negative":
      return causalStrength >= 0.75
        ? PolicyActionKind.Avoid
        : PolicyActionKind.VerifyFirst
    case "Positive":
      return causalStrength >= 0.75
        ? PolicyActionKind.Prefer
        : PolicyActionKind.Recommend
    case "Neutral":
      return PolicyActionKind.Warn
  }
}
