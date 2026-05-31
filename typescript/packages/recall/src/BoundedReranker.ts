import { Effect, Layer } from "effect"
import {
  BeliefEngine,
  BeliefRerankMode,
  BeliefState,
  BoundedReranker,
  CausalEngine,
  CausalRerankMode,
  CausalState,
  ConceptEngine,
  ConceptState,
  ConceptSurfaceMode,
  PolicyActionKind,
  PolicyEngine,
  PolicyRerankMode,
  PolicyState,
  RerankError,
  type BeliefEngineState,
  type BoundedRerankReport,
  type BoundedRerankContext,
  type BoundedRerankModes,
  type CausalEngineState,
  type ConceptEngineState,
  type LimitedCausalRerankReport,
  type LimitedConceptRerankReport,
  type LimitedPolicyRerankReport,
  type LimitedRerankReport,
  type PolicyEngineState,
  type RecallScored,
  type ShadowBeliefScore,
  type ShadowRecallReport,
} from "@aura/contract"
import type { Scored } from "./Types"

export type {
  BoundedRerankReport,
  LimitedCausalRerankReport,
  LimitedConceptRerankReport,
  LimitedPolicyRerankReport,
  LimitedRerankReport,
  ShadowBeliefScore,
  ShadowRecallReport,
} from "@aura/contract"

// ── Belief Reranking (Phase 4 — Limited Influence Activation) ──
//
// Tri-state mode: Off (default), Shadow (observe-only), Limited (bounded rerank).
// 三态模式：Off（默认）、Shadow（仅观察）、Limited（有界重排序）。
// Applied AFTER trust-aware recency scoring. Capped so baseline dominates.
// 在 trust-aware recency scoring 之后应用；有界限制确保 baseline 仍占主导。
// Rust reference: `../src/recall.rs` lines 919-2056 and
// `RecallService::apply_bounded_reranking` in `../src/recall_service.rs`.

export const RUST_DEFAULT_BOUNDED_RERANK_MODES: BoundedRerankModes = {
  beliefMode: BeliefRerankMode.Limited,
  conceptMode: ConceptSurfaceMode.Inspect,
  causalMode: CausalRerankMode.Limited,
  policyMode: PolicyRerankMode.Limited,
}

export const OFF_RERANK_MODES: BoundedRerankModes = {
  beliefMode: BeliefRerankMode.Off,
  conceptMode: ConceptSurfaceMode.Off,
  causalMode: CausalRerankMode.Off,
  policyMode: PolicyRerankMode.Off,
}

/** Maximum belief rerank score effect: +/-5% of original score. */
const BELIEF_RERANK_CAP = 0.05
/** Maximum positional shift allowed: +/-2 positions in the ranking. */
const BELIEF_RERANK_MAX_POS_SHIFT = 2
/** Minimum result count to apply limited reranking (avoid artificial movement). */
const BELIEF_RERANK_MIN_RESULTS = 4
/** Maximum top_k for which limited reranking is applied. */
const BELIEF_RERANK_MAX_TOP_K = 20
/** Phase 4 limited-influence multipliers. */
const BELIEF_RERANK_RESOLVED = 1.05
const BELIEF_RERANK_SINGLETON = 1.02
const BELIEF_RERANK_UNRESOLVED = 0.97

/**
 * Belief state -> score multiplier.
 *
 * Resolved beliefs boost: the system is confident about the claim.
 * Singleton beliefs get a smaller boost: unchallenged but unverified.
 * Unresolved beliefs are penalized: competing hypotheses, uncertain.
 * No belief membership: neutral (1.0).
 *
 * Belief 状态到 shadow score multiplier 的映射；Resolved boost，
 * Singleton 小幅 boost，Unresolved 降权，无 belief membership 时保持中性。
 *
 * Rust reference: shadow multiplier constants in `../src/recall.rs:1209`.
 */
const SHADOW_RESOLVED_MULTIPLIER = 1.10
const SHADOW_SINGLETON_MULTIPLIER = 1.05
const SHADOW_UNRESOLVED_MULTIPLIER = 0.95
const SHADOW_NO_BELIEF_MULTIPLIER = 1.00

/** Maximum concept rerank score effect: +/-4% of original score. */
const CONCEPT_RERANK_CAP = 0.04
/** Maximum positional shift allowed: +/-2 positions in the ranking. */
const CONCEPT_RERANK_MAX_POS_SHIFT = 2
/** Minimum result count to apply limited concept reranking. */
const CONCEPT_RERANK_MIN_RESULTS = 4
/** Maximum top_k for which concept reranking is applied. */
const CONCEPT_RERANK_MAX_TOP_K = 20
/** Multiplier for records inside a Stable concept cluster. */
const CONCEPT_RERANK_STABLE = 1.04
/** Multiplier for records inside a strong Candidate concept (score >= 0.70). */
const CONCEPT_RERANK_CANDIDATE = 1.02

/** Maximum causal rerank score effect: +/-3% of original score. */
const CAUSAL_RERANK_CAP = 0.03
/** Maximum positional shift allowed: +/-2 positions in the ranking. */
const CAUSAL_RERANK_MAX_POS_SHIFT = 2
/** Minimum result count to apply limited causal reranking. */
const CAUSAL_RERANK_MIN_RESULTS = 4
/** Maximum top_k for which limited causal reranking is applied. */
const CAUSAL_RERANK_MAX_TOP_K = 20
/** Multiplier for effect-side records in a Stable causal pattern. */
const CAUSAL_RERANK_EFFECT_STABLE = 1.03
/** Multiplier for effect-side records in a strong Candidate pattern (strength >= 0.65). */
const CAUSAL_RERANK_EFFECT_CANDIDATE = 1.015
/** Multiplier for cause-side records in a Stable causal pattern. */
const CAUSAL_RERANK_CAUSE_STABLE = 1.01

/** Maximum policy rerank score effect: +/-2% of original score. */
const POLICY_RERANK_CAP = 0.02
/** Maximum positional shift: +/-2 positions. */
const POLICY_RERANK_MAX_POS_SHIFT = 2
/** Minimum result count to apply policy reranking. */
const POLICY_RERANK_MIN_RESULTS = 4
/** Maximum top_k for which policy reranking is applied. */
const POLICY_RERANK_MAX_TOP_K = 20
/** Multiplier for records supporting a Stable Prefer/Recommend hint. */
const POLICY_RERANK_PREFER_STABLE = 1.02
/** Multiplier for records supporting a strong Candidate Prefer/Recommend hint. */
const POLICY_RERANK_PREFER_CANDIDATE = 1.01
/** Multiplier for records supporting a Stable Avoid hint (slight downrank). */
const POLICY_RERANK_AVOID_STABLE = 0.99

type LimitedRerankConstants = {
  readonly cap: number
  readonly maxPosShift: number
  readonly minResults: number
  readonly maxTopK: number
}

type InternalLimitedRerankReport = {
  readonly was_applied: boolean
  readonly skip_reason: string
  readonly records_moved: number
  readonly max_up_shift: number
  readonly max_down_shift: number
  readonly avg_multiplier: number
  readonly coverage: number
  readonly top_k_overlap: number
  readonly rerank_latency_us: number
}

export type BoundedRerankSnapshot = {
  readonly beliefState?: BeliefEngineState
  readonly conceptState?: ConceptEngineState
  readonly causalState?: CausalEngineState
  readonly policyState?: PolicyEngineState
  readonly modes?: Partial<BoundedRerankModes>
  readonly shadowReportSink?: (report: ShadowRecallReport) => void
}

export type BoundedRerankerSnapshots = {
  readonly belief?: BeliefEngineState
  readonly concept?: ConceptEngineState
  readonly causal?: CausalEngineState
  readonly policy?: PolicyEngineState
}

export const RUST_RUNTIME_RERANK_MODES = RUST_DEFAULT_BOUNDED_RERANK_MODES

type BoundedRerankSnapshotLoader = () => Effect.Effect<BoundedRerankSnapshot, RerankError>

function skipped(reason: string): InternalLimitedRerankReport {
  return {
    was_applied: false,
    skip_reason: reason,
    records_moved: 0,
    max_up_shift: 0,
    max_down_shift: 0,
    avg_multiplier: 1.0,
    coverage: 0.0,
    top_k_overlap: 1.0,
    rerank_latency_us: 0,
  }
}

function asBeliefReport(report: InternalLimitedRerankReport): LimitedRerankReport {
  return {
    was_applied: report.was_applied,
    skip_reason: report.skip_reason,
    records_moved: report.records_moved,
    max_up_shift: report.max_up_shift,
    max_down_shift: report.max_down_shift,
    avg_belief_multiplier: report.avg_multiplier,
    belief_coverage: report.coverage,
    top_k_overlap: report.top_k_overlap,
    rerank_latency_us: report.rerank_latency_us,
  }
}

function asConceptReport(report: InternalLimitedRerankReport): LimitedConceptRerankReport {
  return {
    was_applied: report.was_applied,
    skip_reason: report.skip_reason,
    records_moved: report.records_moved,
    max_up_shift: report.max_up_shift,
    max_down_shift: report.max_down_shift,
    avg_concept_multiplier: report.avg_multiplier,
    concept_coverage: report.coverage,
    top_k_overlap: report.top_k_overlap,
    rerank_latency_us: report.rerank_latency_us,
  }
}

function asCausalReport(report: InternalLimitedRerankReport): LimitedCausalRerankReport {
  return {
    was_applied: report.was_applied,
    skip_reason: report.skip_reason,
    records_moved: report.records_moved,
    max_up_shift: report.max_up_shift,
    max_down_shift: report.max_down_shift,
    avg_causal_multiplier: report.avg_multiplier,
    causal_coverage: report.coverage,
    top_k_overlap: report.top_k_overlap,
    rerank_latency_us: report.rerank_latency_us,
  }
}

function asPolicyReport(report: InternalLimitedRerankReport): LimitedPolicyRerankReport {
  return {
    was_applied: report.was_applied,
    skip_reason: report.skip_reason,
    records_moved: report.records_moved,
    max_up_shift: report.max_up_shift,
    max_down_shift: report.max_down_shift,
    avg_policy_multiplier: report.avg_multiplier,
    policy_coverage: report.coverage,
    top_k_overlap: report.top_k_overlap,
    rerank_latency_us: report.rerank_latency_us,
  }
}

function emitReport(
  sink: ((report: BoundedRerankReport) => void) | undefined,
  report: BoundedRerankReport
): void {
  if (sink !== undefined) sink(report)
}

export function mergeBoundedRerankModes(modes?: Partial<BoundedRerankModes>): BoundedRerankModes {
  return {
    beliefMode: modes?.beliefMode ?? RUST_DEFAULT_BOUNDED_RERANK_MODES.beliefMode,
    conceptMode: modes?.conceptMode ?? RUST_DEFAULT_BOUNDED_RERANK_MODES.conceptMode,
    causalMode: modes?.causalMode ?? RUST_DEFAULT_BOUNDED_RERANK_MODES.causalMode,
    policyMode: modes?.policyMode ?? RUST_DEFAULT_BOUNDED_RERANK_MODES.policyMode,
  }
}

function applyLimitedRerank(
  matched: Scored,
  topK: number,
  constants: LimitedRerankConstants,
  membership: ReadonlyMap<string, number>,
  noCoverageReason: string
): InternalLimitedRerankReport {
  const start = performance.now()
  const n = matched.length

  // ── Scope guards ──
  if (n < constants.minResults) return skipped("too few results")
  if (topK > constants.maxTopK) return skipped("top_k exceeds limit")

  const covered = matched.filter(([, recordId]) => membership.has(recordId)).length
  if (covered === 0) return skipped(noCoverageReason)
  const coverage = covered / n

  // ── Phase 1: Score adjustment (capped) ──
  const baselineIds = matched.map(([, recordId]) => recordId)
  let multiplierSum = 0

  for (let index = 0; index < matched.length; index++) {
    const [original, recordId] = matched[index]!
    const multiplier = membership.get(recordId) ?? 1.0
    multiplierSum += multiplier
    const adjusted = original * multiplier
    const maxDelta = original * constants.cap
    matched[index] = [
      Math.min(Math.max(adjusted, original - maxDelta), original + maxDelta),
      recordId,
    ]
  }

  // ── Phase 2: Sort, then enforce positional shift cap ──
  matched.sort((a, b) => b[0] - a[0])

  let needsFixup = true
  let fixupRounds = 0
  while (needsFixup && fixupRounds < n) {
    needsFixup = false
    fixupRounds += 1

    for (let index = 0; index < matched.length; index++) {
      const recordId = matched[index]![1]
      const originalPosition = baselineIds.indexOf(recordId)
      if (originalPosition < 0) continue

      const shift = Math.abs(index - originalPosition)
      if (shift > constants.maxPosShift) {
        const target = index > originalPosition
          ? Math.max(index - 1, originalPosition)
          : Math.min(index + 1, originalPosition)
        const current = matched[index]!
        matched[index] = matched[target]!
        matched[target] = current
        needsFixup = true
        break
      }
    }
  }

  // ── Phase 3: Compute report ──
  const finalIds = matched.map(([, recordId]) => recordId)
  let recordsMoved = 0
  let maxUp = 0
  let maxDown = 0

  for (let originalPosition = 0; originalPosition < baselineIds.length; originalPosition++) {
    const recordId = baselineIds[originalPosition]!
    const newPosition = finalIds.indexOf(recordId)
    if (newPosition < 0 || newPosition === originalPosition) continue
    recordsMoved += 1
    if (newPosition < originalPosition) {
      maxUp = Math.max(maxUp, originalPosition - newPosition)
    } else {
      maxDown = Math.max(maxDown, newPosition - originalPosition)
    }
  }

  const effectiveK = Math.min(n, topK)
  const baselineTop = new Set(baselineIds.slice(0, effectiveK))
  const finalTop = finalIds.slice(0, effectiveK)
  const overlap = effectiveK > 0
    ? finalTop.filter((recordId) => baselineTop.has(recordId)).length / effectiveK
    : 1.0

  return {
    was_applied: true,
    skip_reason: "",
    records_moved: recordsMoved,
    max_up_shift: maxUp,
    max_down_shift: maxDown,
    avg_multiplier: n > 0 ? multiplierSum / n : 1.0,
    coverage,
    top_k_overlap: overlap,
    rerank_latency_us: Math.round((performance.now() - start) * 1000),
  }
}

function buildBeliefMembershipIndex(beliefState: BeliefEngineState): Map<string, number> {
  const index = new Map<string, number>()
  const recordIndex = beliefState.record_index
  const legacyRecordIndex = beliefState.record_to_belief

  for (const [recordId, beliefId] of Object.entries({ ...legacyRecordIndex, ...recordIndex })) {
    const belief = beliefState.beliefs[beliefId]
    if (!belief) continue
    const multiplier = belief.state === BeliefState.Resolved ? BELIEF_RERANK_RESOLVED
      : belief.state === BeliefState.Singleton ? BELIEF_RERANK_SINGLETON
      : belief.state === BeliefState.Unresolved ? BELIEF_RERANK_UNRESOLVED
      : 1.0
    index.set(recordId, multiplier)
  }

  return index
}

function beliefForRecord(
  beliefState: BeliefEngineState,
  recordId: string
): BeliefEngineState["beliefs"][string] | undefined {
  const beliefId = beliefState.record_index[recordId] ?? beliefState.record_to_belief[recordId]
  return beliefId === undefined ? undefined : beliefState.beliefs[beliefId]
}

function shadowMultiplier(state: BeliefState): number {
  switch (state) {
    case BeliefState.Resolved:
      return SHADOW_RESOLVED_MULTIPLIER
    case BeliefState.Singleton:
      return SHADOW_SINGLETON_MULTIPLIER
    case BeliefState.Unresolved:
      return SHADOW_UNRESOLVED_MULTIPLIER
    case BeliefState.Empty:
      return SHADOW_NO_BELIEF_MULTIPLIER
  }
}

function shadowStateLabel(state: BeliefState): string {
  switch (state) {
    case BeliefState.Resolved:
      return "resolved"
    case BeliefState.Singleton:
      return "singleton"
    case BeliefState.Unresolved:
      return "unresolved"
    case BeliefState.Empty:
      return "empty"
  }
}

/**
 * Compute shadow belief scores for a set of recall results.
 *
 * 计算一组召回结果的 shadow belief scores。
 *
 * `requestedTopK` is the caller's top-k so the overlap metric aligns
 * with the actual recall surface (capped to result count).
 *
 * `requestedTopK` 是调用方 top-k，用于让 overlap 指标对齐实际召回表面
 *（同时按结果数量截断）。
 *
 * Returns the shadow report with per-record scores and aggregate metrics.
 * 返回包含逐 record score 与聚合指标的 shadow report。
 *
 * Does NOT modify the input — purely observational.
 * 不修改输入，仅用于观察对比。
 *
 * Rust reference: `compute_shadow_belief_scores` in `../src/recall.rs:1227`.
 */
export function computeShadowBeliefScores(
  baseline: RecallScored,
  beliefState: BeliefEngineState,
  requestedTopK: number
): ShadowRecallReport {
  const start = performance.now()
  let beliefMemberCount = 0
  let multiplierSum = 0

  // Phase 1: compute shadow scores
  const scores: ShadowBeliefScore[] = baseline.map(([baselineScore, recordId], baselineRank) => {
    const belief = beliefForRecord(beliefState, recordId)
    const multiplier = belief ? shadowMultiplier(belief.state) : SHADOW_NO_BELIEF_MULTIPLIER
    const beliefStateLabel = belief ? shadowStateLabel(belief.state) : null
    const beliefConfidence = belief?.confidence ?? 0
    if (belief) beliefMemberCount += 1
    multiplierSum += multiplier

    return {
      record_id: recordId,
      baseline_score: baselineScore,
      shadow_score: baselineScore * multiplier,
      belief_multiplier: multiplier,
      belief_state: beliefStateLabel,
      belief_confidence: beliefConfidence,
      baseline_rank: baselineRank,
      shadow_rank: 0,
      rank_delta: 0,
    }
  })

  // Phase 2: compute shadow ranking (sort by shadow_score descending, stable)
  const shadowOrder = scores.map((_, index) => index)
  shadowOrder.sort((a, b) => {
    const diff = scores[b]!.shadow_score - scores[a]!.shadow_score
    return Number.isNaN(diff) ? 0 : diff
  })

  // Assign shadow ranks
  for (let shadowRank = 0; shadowRank < shadowOrder.length; shadowRank++) {
    const originalIndex = shadowOrder[shadowRank]!
    const score = scores[originalIndex]!
    scores[originalIndex] = {
      ...score,
      shadow_rank: shadowRank,
      rank_delta: score.baseline_rank - shadowRank,
    }
  }

  // Phase 3: compute aggregate metrics
  const n = scores.length
  const topK = Math.min(n, requestedTopK)
  const baselineTop = new Set(
    scores.filter((score) => score.baseline_rank < topK).map((score) => score.record_id)
  )
  const shadowTop = scores
    .filter((score) => score.shadow_rank < topK)
    .map((score) => score.record_id)
  const overlap = topK > 0
    ? shadowTop.filter((recordId) => baselineTop.has(recordId)).length / topK
    : 1.0

  return {
    scores,
    top_k_overlap: overlap,
    promoted_count: scores.filter((score) => score.rank_delta > 0).length,
    demoted_count: scores.filter((score) => score.rank_delta < 0).length,
    unchanged_count: scores.filter((score) => score.rank_delta === 0).length,
    belief_coverage: n > 0 ? beliefMemberCount / n : 0.0,
    avg_belief_multiplier: n > 0 ? multiplierSum / n : 1.0,
    shadow_latency_us: Math.round((performance.now() - start) * 1000),
  }
}

/**
 * Apply belief-aware reranking with Phase 4 guardrails.
 *
 * Phase 4 guardrail 下执行 belief-aware 重排序。
 *
 * Rust reference: `apply_belief_rerank` in `../src/recall.rs`.
 */
export function applyBeliefRerank(
  matched: Scored,
  beliefState: BeliefEngineState,
  topK: number
): LimitedRerankReport {
  return asBeliefReport(
    applyLimitedRerank(
      matched,
      topK,
      {
        cap: BELIEF_RERANK_CAP,
        maxPosShift: BELIEF_RERANK_MAX_POS_SHIFT,
        minResults: BELIEF_RERANK_MIN_RESULTS,
        maxTopK: BELIEF_RERANK_MAX_TOP_K,
      },
      buildBeliefMembershipIndex(beliefState),
      "no belief coverage"
    )
  )
}

/**
 * Build an index: record_id -> (best_multiplier, concept_state_label).
 *
 * 构建 record_id -> 最佳 concept multiplier 的索引。
 *
 * Rust reference: `build_concept_membership_index` in `../src/recall.rs`.
 */
export function buildConceptMembershipIndex(conceptState: ConceptEngineState): Map<string, number> {
  const index = new Map<string, number>()

  for (const concept of Object.values(conceptState.concepts)) {
    const multiplier = concept.state === ConceptState.Stable ? CONCEPT_RERANK_STABLE
      : concept.state === ConceptState.Candidate && concept.abstraction_score >= 0.70 ? CONCEPT_RERANK_CANDIDATE
      : undefined
    if (multiplier === undefined) continue

    for (const recordId of concept.record_ids) {
      const current = index.get(recordId) ?? 1.0
      if (multiplier > current) index.set(recordId, multiplier)
    }
  }

  return index
}

/**
 * Apply concept-aware reranking with guardrails.
 *
 * 使用 guardrail 执行 concept-aware 重排序。
 *
 * Rust reference: `apply_concept_rerank` in `../src/recall.rs`.
 */
export function applyConceptRerank(
  matched: Scored,
  conceptState: ConceptEngineState,
  topK: number
): LimitedConceptRerankReport {
  return asConceptReport(
    applyLimitedRerank(
      matched,
      topK,
      {
        cap: CONCEPT_RERANK_CAP,
        maxPosShift: CONCEPT_RERANK_MAX_POS_SHIFT,
        minResults: CONCEPT_RERANK_MIN_RESULTS,
        maxTopK: CONCEPT_RERANK_MAX_TOP_K,
      },
      buildConceptMembershipIndex(conceptState),
      "no concept coverage"
    )
  )
}

/**
 * Build an index: record_id -> best causal multiplier.
 *
 * 构建 record_id -> 最佳 causal multiplier 的索引。
 *
 * Rust reference: `build_causal_membership_index` in `../src/recall.rs`.
 */
export function buildCausalMembershipIndex(causalState: CausalEngineState): Map<string, number> {
  const index = new Map<string, number>()

  for (const pattern of Object.values(causalState.patterns)) {
    const effectMultiplier = pattern.state === CausalState.Stable ? CAUSAL_RERANK_EFFECT_STABLE
      : pattern.state === CausalState.Candidate && pattern.causal_strength >= 0.65
        ? CAUSAL_RERANK_EFFECT_CANDIDATE
        : undefined
    if (effectMultiplier === undefined) continue

    const causeMultiplier = pattern.state === CausalState.Stable ? CAUSAL_RERANK_CAUSE_STABLE : undefined
    // Rust currently computes the strong-Candidate effect multiplier above, then
    // continues before applying effect-side records when cause-side multiplier is absent.
    // TS mirrors that control flow for semantic parity.
    if (causeMultiplier === undefined) continue

    for (const recordId of pattern.effect_record_ids) {
      const current = index.get(recordId) ?? 1.0
      if (effectMultiplier > current) index.set(recordId, effectMultiplier)
    }

    for (const recordId of pattern.cause_record_ids) {
      const current = index.get(recordId) ?? 1.0
      if (causeMultiplier > current) index.set(recordId, causeMultiplier)
    }
  }

  return index
}

/**
 * Apply causal-pattern-aware reranking with guardrails.
 *
 * 使用 guardrail 执行 causal-pattern-aware 重排序。
 *
 * Rust reference: `apply_causal_rerank` in `../src/recall.rs`.
 */
export function applyCausalRerank(
  matched: Scored,
  causalState: CausalEngineState,
  topK: number
): LimitedCausalRerankReport {
  return asCausalReport(
    applyLimitedRerank(
      matched,
      topK,
      {
        cap: CAUSAL_RERANK_CAP,
        maxPosShift: CAUSAL_RERANK_MAX_POS_SHIFT,
        minResults: CAUSAL_RERANK_MIN_RESULTS,
        maxTopK: CAUSAL_RERANK_MAX_TOP_K,
      },
      buildCausalMembershipIndex(causalState),
      "no causal coverage"
    )
  )
}

/**
 * Build an index: record_id -> best policy multiplier.
 *
 * 构建 record_id -> 最佳 policy multiplier 的索引。
 *
 * Rust reference: `build_policy_membership_index` in `../src/recall.rs`.
 */
export function buildPolicyMembershipIndex(policyState: PolicyEngineState): Map<string, number> {
  const index = new Map<string, number>()

  for (const hint of Object.values(policyState.hints)) {
    const isPrefer = hint.actionKind === PolicyActionKind.Prefer || hint.actionKind === PolicyActionKind.Recommend
    const multiplier = isPrefer && hint.state === PolicyState.Stable ? POLICY_RERANK_PREFER_STABLE
      : isPrefer && hint.state === PolicyState.Candidate && hint.policyStrength >= 0.70
        ? POLICY_RERANK_PREFER_CANDIDATE
        : hint.actionKind === PolicyActionKind.Avoid && hint.state === PolicyState.Stable
          ? POLICY_RERANK_AVOID_STABLE
          : undefined
    if (multiplier === undefined) continue

    const supportingRecordIds = new Set([...hint.cause_record_ids, ...hint.effect_keys])
    for (const recordId of supportingRecordIds) {
      const current = index.get(recordId) ?? 1.0
      // For boosts, take the best (highest) multiplier.
      // 对 boost 取最高 multiplier。
      // For downranks (< 1.0), take the most aggressive (lowest).
      // 对 downrank（<1.0）取最激进的最低 multiplier。
      if (multiplier >= 1.0 && multiplier > current) {
        index.set(recordId, multiplier)
      } else if (multiplier < 1.0 && multiplier < current) {
        index.set(recordId, multiplier)
      }
    }
  }

  return index
}

/**
 * Apply policy-hint-aware reranking with guardrails.
 *
 * 使用 guardrail 执行 policy-hint-aware 重排序。
 *
 * Rust reference: `apply_policy_rerank` in `../src/recall.rs`.
 */
export function applyPolicyRerank(
  matched: Scored,
  policyState: PolicyEngineState,
  topK: number
): LimitedPolicyRerankReport {
  return asPolicyReport(
    applyLimitedRerank(
      matched,
      topK,
      {
        cap: POLICY_RERANK_CAP,
        maxPosShift: POLICY_RERANK_MAX_POS_SHIFT,
        minResults: POLICY_RERANK_MIN_RESULTS,
        maxTopK: POLICY_RERANK_MAX_TOP_K,
      },
      buildPolicyMembershipIndex(policyState),
      "no policy coverage"
    )
  )
}

export function rerankWithSnapshots(
  scored: RecallScored,
  topK: number,
  snapshots: BoundedRerankerSnapshots,
  modes: BoundedRerankModes,
  reportSink?: (report: BoundedRerankReport) => void,
  shadow?: ShadowRecallReport
): RecallScored {
  let matched: Scored | undefined
  let wasApplied = false
  let beliefReport: LimitedRerankReport | undefined
  let conceptReport: LimitedConceptRerankReport | undefined
  let causalReport: LimitedCausalRerankReport | undefined
  let policyReport: LimitedPolicyRerankReport | undefined
  const ensureMatched = (): Scored => {
    matched ??= Array.from(scored)
    return matched
  }

  if (modes.beliefMode === BeliefRerankMode.Limited && snapshots.belief) {
    beliefReport = applyBeliefRerank(ensureMatched(), snapshots.belief, topK)
    wasApplied = beliefReport.was_applied || wasApplied
  }

  if (modes.conceptMode === ConceptSurfaceMode.Limited && snapshots.concept) {
    conceptReport = applyConceptRerank(ensureMatched(), snapshots.concept, topK)
    wasApplied = conceptReport.was_applied || wasApplied
  }

  if (modes.causalMode === CausalRerankMode.Limited && snapshots.causal) {
    causalReport = applyCausalRerank(ensureMatched(), snapshots.causal, topK)
    wasApplied = causalReport.was_applied || wasApplied
  }

  if (modes.policyMode === PolicyRerankMode.Limited && snapshots.policy) {
    policyReport = applyPolicyRerank(ensureMatched(), snapshots.policy, topK)
    wasApplied = policyReport.was_applied || wasApplied
  }

  if (reportSink !== undefined) {
    emitReport(
      reportSink,
      {
        modes,
        ...(beliefReport !== undefined ? { belief: beliefReport } : {}),
        ...(conceptReport !== undefined ? { concept: conceptReport } : {}),
        ...(causalReport !== undefined ? { causal: causalReport } : {}),
        ...(policyReport !== undefined ? { policy: policyReport } : {}),
        ...(shadow !== undefined ? { shadow } : {}),
      } as BoundedRerankReport
    )
  }

  return wasApplied ? matched! : scored
}

export class BoundedRerankerImpl implements BoundedReranker.Interface {
  constructor(
    private readonly loadSnapshot: BoundedRerankSnapshotLoader = () => Effect.succeed({})
  ) {}

  rerank(
    scored: RecallScored,
    _query: string,
    context?: BoundedRerankContext
  ): Effect.Effect<RecallScored, RerankError> {
    const self = this
    return Effect.gen(function* () {
      const snapshot = yield* self.loadSnapshot()
      const modes = mergeBoundedRerankModes({
        ...(snapshot.modes ?? {}),
        ...(context?.modes ?? {}),
      })
      const topK = context?.topK ?? scored.length
      let shadowReport: ShadowRecallReport | undefined
      if (
        modes.beliefMode === BeliefRerankMode.Shadow &&
        snapshot.beliefState
      ) {
        shadowReport = computeShadowBeliefScores(scored, snapshot.beliefState, topK)
        snapshot.shadowReportSink?.(shadowReport)
      }
      return rerankWithSnapshots(
        scored,
        topK,
        {
          belief: snapshot.beliefState,
          concept: snapshot.conceptState,
          causal: snapshot.causalState,
          policy: snapshot.policyState,
        },
        modes,
        context?.reportSink,
        shadowReport
      )
    })
  }
}

export const BoundedRerankerLive = Layer.effect(
  BoundedReranker,
  Effect.gen(function* () {
    const beliefEngine = yield* Effect.service(BeliefEngine)
    const conceptEngine = yield* Effect.service(ConceptEngine)
    const causalEngine = yield* Effect.service(CausalEngine)
    const policyEngine = yield* Effect.service(PolicyEngine)

    return new BoundedRerankerImpl(() =>
      Effect.gen(function* () {
        const beliefState = yield* beliefEngine.stats()
        const conceptState = yield* conceptEngine.stats()
        const causalState = yield* causalEngine.stats()
        const policyState = yield* policyEngine.stats()
        return {
          beliefState,
          conceptState,
          causalState,
          policyState,
          modes: RUST_DEFAULT_BOUNDED_RERANK_MODES,
        }
      })
    )
  })
)
