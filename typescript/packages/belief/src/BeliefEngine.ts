import { Effect, Layer, Option } from "effect"
import {
  BeliefEngine,
  BeliefState,
  EpistemicTrace,
  serviceOption,
  type Belief,
  type BeliefEngineState,
  type BeliefReport,
  type Hypothesis,
  type Record as AuraRecord,
  type SdrLookup,
  Clock
} from "@aura/contract"
import { id12 } from "@aura/utils"

/**
 * The belief engine — maintains the full belief state.
 *
 * Belief 引擎——维护完整的信念层状态（Belief/Hypothesis/索引），用于在 maintenance 周期中从 records
 * 构建更稳定的"主张层"。
 */
export enum CoarseKeyMode {
  Standard = "Standard",
  TopOneTag = "TopOneTag",
  SemanticOnly = "SemanticOnly",
  TagFamily = "TagFamily",
  TagFamilyAdaptive = "TagFamilyAdaptive",
  TagFamilyBackoff = "TagFamilyBackoff",
  TagFamilyPairBackoff = "TagFamilyPairBackoff",
  TagFamilyDenseBackoff = "TagFamilyDenseBackoff",
  DualKey = "DualKey",
  NeighborhoodPool = "NeighborhoodPool",
  BridgeKey = "BridgeKey",
  SdrTagPool = "SdrTagPool"
}

/**
 * Conflict penalty weight in hypothesis scoring.
 *
 * 假设评分中的冲突惩罚权重。
 */
const LAMBDA = 0.35

/**
 * Belief revision threshold — opposing must exceed current by this factor.
 *
 * 信念修正阈值——如果对立假设必须至少强到该倍率，才会推翻/压制当前领先假设。
 */
const REVISION_THRESHOLD = 1.15

/**
 * Uncertainty band — if top two scores are within this range, belief is unresolved.
 *
 * 不确定带——如果前两名假设的分数差在该范围内，则 belief 进入 Unresolved（不产生 winner）。
 */
const UNCERTAINTY_BAND = 0.1

/**
 * Maximum SDR Tanimoto distance to split records within a coarse tag-group into separate beliefs.
 *
 * 在同一 coarse 分桶内用 SDR Tanimoto/Jaccard 相似度进一步拆分子簇；
 * 相似度 ≥ 阈值视为在讨论同一个 claim（合并为同簇）。
 */
const SDR_TANIMOTO_THRESHOLD = 0.6

/**
 * Minimum token count for a record to be considered "non-trivial content".
 * For CJK, segmenter token count; for Latin, word count ≈ content.length / 6 heuristic.
 *
 * 最小有效 token 数——低于此阈值视为 trivial content（跳过不参与 belief 构建）。
 */
const MIN_CONTENT_TOKENS = 5

/**
 * Record source-type → default confidence map.
 *
 * Rust 侧 `Record::default_confidence_for_source` 按 source_type 给默认值；
 * TS 侧对齐该行为，提供 recorded/observed/inferred/manual/feedback 五类默认置信度。
 */
const DEFAULT_CONFIDENCE_BY_SOURCE: Record<string, number> = {
  recorded: 0.9,
  observed: 0.85,
  inferred: 0.7,
  manual: 1.0,
  feedback: 0.8
}

/**
 * Exponential-decay half-life for recency (7 days in seconds).
 *
 * 新近度指数衰减半衰期（7 天，秒数）。
 */
const RECENCY_HALF_LIFE_SECS = 7 * 24 * 3600

/**
 * Estimate token count — uses Intl.Segmenter when available, falls back to heuristic.
 *
 * SIMPLE IMPLEMENTATION: Intl.Segmenter 可能在某些运行时不可用（如旧版 Bun）；
 * 此时回退为字符长度启发式：CJK 约 1.5 字符/token，拉丁语系约 6 字符/词。
 * Rust 侧使用 unicode-segmentation crate 做 grapheme/word 切分。
 *
 * 估算内容 token 数：优先使用 Intl.Segmenter 分词，不可用时回退到字符长度启发式估算。
 */
function estimateTokens(content: string): number {
  try {
    if (typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function") {
      const seg = new (Intl as any).Segmenter(["zh", "ja", "ko"], { granularity: "word" })
      let count = 0
      for (const _ of seg.segment(content)) count++
      if (count > 0) return count
    }
  } catch { /* Intl.Segmenter unavailable — fall through to heuristic */ }
  /**
   * Heuristic fallback: ~6 chars per word for Latin, ~1.5 chars per token for CJK.
   *
   * 启发式回退：CJK 约 1.5 字符/token，拉丁语系约 6 字符/词。
   */
  const cjkCount = (content.match(/[一-鿿㐀-䶿]/g) || []).length
  const latinLen = content.length - cjkCount
  return Math.floor(cjkCount / 1.5 + latinLen / 6)
}

/**
 * Get record confidence — explicit value or source-type default.
 *
 * 取 record 的置信度：优先取显式值，缺失时按 source_type 查默认置信度表。
 */
function confidenceOf(rec: AuraRecord): number {
  const v = (rec as unknown as { confidence?: unknown }).confidence
  if (typeof v === "number" && Number.isFinite(v)) return v
  return DEFAULT_CONFIDENCE_BY_SOURCE[rec.source_type] ?? 0.9
}

/**
 * Get record support mass — explicit value or fallback to strength.
 *
 * 取 record 的支持质量：优先取显式 support_mass，缺失时回退到 strength。
 */
function supportMassOf(rec: AuraRecord): number {
  const v = (rec as unknown as { support_mass?: unknown }).support_mass
  return typeof v === "number" && Number.isFinite(v) ? v : rec.strength
}

/**
 * Get record conflict mass — explicit value or default 0.
 *
 * 取 record 的冲突质量：优先取显式 conflict_mass，缺失时默认为 0。
 */
function conflictMassOf(rec: AuraRecord): number {
  const v = (rec as unknown as { conflict_mass?: unknown }).conflict_mass
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/**
 * Tanimoto/Jaccard similarity for sparse sets.
 * `|A∩B| / |A∪B|`, suitable for SDR (sparse discrete feature) comparison.
 *
 * Tanimoto/Jaccard 相似度（稀疏集合）：
 * `|A∩B| / |A∪B|`，适合 SDR（稀疏离散特征）对比。
 */
function tanimoto(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let i = 0
  let j = 0
  let inter = 0
  while (i < a.length && j < b.length) {
    const av = a[i]!
    const bv = b[j]!
    if (av === bv) {
      inter++
      i++
      j++
    } else if (av < bv) {
      i++
    } else {
      j++
    }
  }
  const union = a.length + b.length - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Split records into SDR sub-clusters using Union-Find (disjoint set).
 *
 * 使用并查集按 SDR 相似度把同一 coarse group 里的 records 进一步拆成子簇。
 */
function unionFindClusters(
  records: ReadonlyArray<AuraRecord>,
  lookup: SdrLookup
): ReadonlyArray<ReadonlyArray<AuraRecord>> {
  const n = records.length
  if (n <= 1) return records.map((r) => [r])
  const parent = new Array<number>(n)
  for (let i = 0; i < n; i++) parent[i] = i

  const find = (x: number): number => {
    let v = x
    while (parent[v] !== v) v = parent[v]!
    let p = x
    while (parent[p] !== p) {
      const next = parent[p]!
      parent[p] = v
      p = next
    }
    return v
  }

  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < n; i++) {
    const sdrI = lookup.get(records[i]!.id)
    if (!sdrI) continue
    for (let j = i + 1; j < n; j++) {
      const sdrJ = lookup.get(records[j]!.id)
      if (!sdrJ) continue
      if (tanimoto(sdrI, sdrJ) >= SDR_TANIMOTO_THRESHOLD) union(i, j)
    }
  }

  const clusters = new Map<number, AuraRecord[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const arr = clusters.get(root)
    if (arr) arr.push(records[i]!)
    else clusters.set(root, [records[i]!])
  }
  return Array.from(clusters.values())
}

/**
 * Composite hypothesis score (higher = stronger hypothesis).
 *
 * 假设综合评分（越高越强）：综合支持度对数、置信度、新近度、一致性，
 * 减去带权重的冲突惩罚项。
 */
function computeHypothesisScore(h: Omit<Hypothesis, "score">): number {
  const supportScore = 1.0 + Math.log(1.0 + h.support_mass)
  const conflictPenalty = Math.log(1.0 + h.conflict_mass)
  const beliefScore = supportScore * h.confidence * h.recency * h.consistency
  return Math.max(beliefScore - LAMBDA * conflictPenalty, 0.0)
}

/**
 * Exponential-decay recency factor from record timestamps.
 * Decays from 1.0 with configurable half-life (default 7 days).
 *
 * 指数衰减新近度因子：基于 record 时间戳计算，以半衰期衰减（默认 7 天）。
 */
function computeRecency(recordTimestamps: ReadonlyArray<number>, now: number): number {
  if (recordTimestamps.length === 0) return 1.0
  const maxTs = Math.max(...recordTimestamps)
  const age = Math.max(0, now - maxTs)
  return Math.pow(0.5, age / RECENCY_HALF_LIFE_SECS)
}

/**
 * Internal consistency: 1/(1+stddev of confidences). Higher variance → weaker hypothesis.
 *
 * 内部一致性：1/(1+置信度标准差)，方差越大一致性越低、假设越弱。
 */
function computeConsistency(confidences: ReadonlyArray<number>): number {
  if (confidences.length <= 1) return 1.0
  const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length
  const variance = confidences.reduce((sum, c) => sum + (c - mean) ** 2, 0) / confidences.length
  return 1.0 / (1.0 + Math.sqrt(variance))
}

/**
 * Build one hypothesis from a record cluster.
 *
 * 从一个 record 簇构建一个 hypothesis。
 */
function hypothesisFromRecords(
  beliefId: string,
  records: ReadonlyArray<AuraRecord>,
  now: number
): Hypothesis {
  const confidences = records.map(confidenceOf)
  const confidence = confidences.reduce((a, b) => a + b, 0) / Math.max(1, records.length)
  const supportMass = records.map(supportMassOf).reduce((a, b) => a + b, 0)
  const conflictMass = records.map(conflictMassOf).reduce((a, b) => a + b, 0)
  const timestamps = records.map((r) => r.created_at)
  const recency = computeRecency(timestamps, now)
  const consistency = computeConsistency(confidences)
  const base = {
    id: id12(),
    belief_id: beliefId,
    prototype_record_ids: records.map((r) => r.id),
    confidence,
    support_mass: supportMass,
    conflict_mass: conflictMass,
    recency,
    consistency
  } as const
  return { ...base, score: computeHypothesisScore(base) }
}

/**
 * Resolve winner from a set of hypotheses.
 *
 * 从多个 hypotheses 中决出 winner（或在证据接近时进入 Unresolved）。
 */
function resolveBelief(
  prev: Belief,
  hypotheses: ReadonlyArray<Hypothesis>,
  now: number
): Belief {
  if (hypotheses.length === 0) {
    return {
      ...prev,
      winner_id: null,
      state: BeliefState.Empty,
      score: 0,
      confidence: 0,
      support_mass: 0,
      conflict_mass: 0,
      stability: 0,
      last_updated: now
    }
  }

  if (hypotheses.length === 1) {
    const h = hypotheses[0]!
    const stability = prev.winner_id === h.id ? prev.stability + 1 : 1
    return {
      ...prev,
      winner_id: h.id,
      state: BeliefState.Singleton,
      score: h.score,
      confidence: h.confidence,
      support_mass: h.support_mass,
      conflict_mass: h.conflict_mass,
      stability,
      last_updated: now
    }
  }

  const sorted = [...hypotheses].sort((a, b) => b.score - a.score)
  const top1 = sorted[0]!
  const top2 = sorted[1]!
  const eps = 1e-6
  const ratio = top1.score / (top2.score + eps)

  let state: BeliefState
  let winnerId: string | null
  let stability: number

  if (ratio < REVISION_THRESHOLD && Math.abs(top1.score - top2.score) < UNCERTAINTY_BAND) {
    state = BeliefState.Unresolved
    winnerId = null
    stability = 0
  } else {
    state = BeliefState.Resolved
    winnerId = top1.id
    stability = prev.winner_id === top1.id ? prev.stability + 1 : 1
  }

  return {
    ...prev,
    winner_id: winnerId,
    state,
    score: top1.score,
    confidence: top1.confidence,
    support_mass: hypotheses.map((h) => h.support_mass).reduce((a, b) => a + b, 0),
    conflict_mass: hypotheses.map((h) => h.conflict_mass).reduce((a, b) => a + b, 0),
    stability,
    last_updated: now
  }
}

export class BeliefEngineImpl implements BeliefEngine.Interface {
  private coarseKeyMode: CoarseKeyMode = CoarseKeyMode.Standard
  private state: BeliefEngineState = { version: 1, beliefs: {}, hypotheses: {}, record_to_belief: {}, key_index: {}, record_index: {} }

  with_coarse_key_mode(mode: unknown): Effect.Effect<void> {
    this.coarseKeyMode = typeof mode === "string" ? (mode as CoarseKeyMode) : CoarseKeyMode.Standard
    return Effect.void
  }

  claim_key(
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string
  ): Effect.Effect<string> {
    return this.claim_key_with_mode(namespace, tags, semantic_type, this.coarseKeyMode)
  }

  claim_key_with_mode(
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string,
    mode: unknown
  ): Effect.Effect<string> {
    const ns = namespace.length > 0 ? namespace : "default"
    const st = semantic_type.length > 0 ? semantic_type : "unknown"
    const m = typeof mode === "string" ? (mode as CoarseKeyMode) : CoarseKeyMode.Standard
    const activeTags = [...tags].filter((x) => x.length > 0).sort()

    switch (m) {
      case CoarseKeyMode.SemanticOnly:
        return Effect.succeed(`${ns}:${st}`)
      case CoarseKeyMode.TopOneTag:
        return Effect.succeed(`${ns}:${activeTags[0] ?? "none"}:${st}`)
      case CoarseKeyMode.TagFamily:
      case CoarseKeyMode.TagFamilyAdaptive:
      case CoarseKeyMode.TagFamilyBackoff:
      case CoarseKeyMode.TagFamilyPairBackoff:
      case CoarseKeyMode.TagFamilyDenseBackoff: {
        const families = activeTags.map((t) => {
          const slash = t.indexOf("/")
          if (slash > 0) return t.slice(0, slash)
          const us = t.indexOf("_")
          return us > 0 ? t.slice(0, us) : t
        })
        const deduped = [...new Set(families)].sort()
        return Effect.succeed(`${ns}:${deduped.join("+")}:${st}`)
      }
      case CoarseKeyMode.DualKey:
        return Effect.succeed(`${ns}:${activeTags.join(",")}:${st}`)
      case CoarseKeyMode.NeighborhoodPool:
        return Effect.succeed(`${ns}:${activeTags.slice(0, 3).join("|")}:${st}`)
      case CoarseKeyMode.BridgeKey:
        return Effect.succeed(`${ns}:${activeTags[0] ?? "none"}:bridge:${st}`)
      case CoarseKeyMode.SdrTagPool:
        return Effect.succeed(`${activeTags.join(",")}:${st}`)
      default:
        return Effect.succeed(`${ns}:${activeTags.join(",")}:${st}`)
    }
  }

  update(records: ReadonlyMap<string, AuraRecord>): Effect.Effect<BeliefReport, never, EpistemicTrace> {
    return this.update_with_sdr(records, new Map())
  }

  /**
   * Full belief update cycle with SDR-backed claim grouping.
   */
  update_with_sdr(
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ): Effect.Effect<BeliefReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const now = yield* Clock.nowSeconds()
      const traceOpt = yield* serviceOption(EpistemicTrace)
      if (Option.isSome(traceOpt)) {
        yield* traceOpt.value.event("belief.update_with_sdr.start", {
          records: records.size,
          has_sdr: sdr_lookup.size > 0
        })
      }

      const coarseGroups = new Map<string, AuraRecord[]>()
      for (const rec of records.values()) {
        if (estimateTokens(rec.content) < MIN_CONTENT_TOKENS) continue
        const key = yield* self.claim_key(rec.namespace, rec.tags, rec.semantic_type)
        const arr = coarseGroups.get(key)
        if (arr) arr.push(rec)
        else coarseGroups.set(key, [rec])
      }

      const nextBeliefs: Record<string, Belief> = {}
      const nextHyps: Record<string, Hypothesis> = {}
      const recToBelief: Record<string, string> = {}

      let hypothesesBuilt = 0
      for (const [key, groupRecords] of coarseGroups.entries()) {
        const beliefId = id12()
        let belief: Belief = {
          id: beliefId,
          key,
          hypothesis_ids: [],
          winner_id: null,
          state: BeliefState.Empty,
          score: 0,
          confidence: 0,
          support_mass: 0,
          conflict_mass: 0,
          stability: 0,
          volatility: 0,
          last_updated: now
        }

        const clusters =
          sdr_lookup.size > 0
            ? unionFindClusters(groupRecords, sdr_lookup)
            : ([groupRecords] as const)
        const hyps: Hypothesis[] = []
        for (const cluster of clusters) {
          const hyp = hypothesisFromRecords(beliefId, cluster, now)
          hypothesesBuilt++
          nextHyps[hyp.id] = hyp
          hyps.push(hyp)
          belief = { ...belief, hypothesis_ids: [...belief.hypothesis_ids, hyp.id] }
          for (const rid of hyp.prototype_record_ids) recToBelief[rid] = beliefId
        }

        belief = resolveBelief(belief, hyps, now)
        nextBeliefs[beliefId] = belief
      }

      self.state = {
        version: 1,
        beliefs: nextBeliefs,
        hypotheses: nextHyps,
        record_to_belief: recToBelief,
        key_index: {},
        record_index: recToBelief
      }

      const beliefCount = Object.keys(nextBeliefs).length
      const report: BeliefReport = {
        coarse_groups: coarseGroups.size,
        beliefs_built: beliefCount,
        hypotheses_built: hypothesesBuilt,
        beliefs_created: beliefCount,
        beliefs_pruned: 0,
        revisions: 0,
        resolved: Object.values(nextBeliefs).filter(b => b.state === "Resolved").length,
        unresolved: Object.values(nextBeliefs).filter(b => b.state === "Unresolved").length,
        total_beliefs: beliefCount,
        total_hypotheses: hypothesesBuilt,
        churn_rate: 0
      }

      if (Option.isSome(traceOpt)) {
        yield* traceOpt.value.event("belief.update_with_sdr.end", report)
      }

      return report
    })
  }

  belief_for_record(record_id: string): Effect.Effect<string | null> {
    return Effect.succeed(this.state.record_to_belief[record_id] ?? null)
  }

  deprecate_belief(belief_id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const belief = self.state.beliefs[belief_id]
      if (!belief) return
      const { [belief_id]: _removed, ...remainingBeliefs } = self.state.beliefs
      const remainingHyps = { ...self.state.hypotheses }
      for (const hid of belief.hypothesis_ids) delete remainingHyps[hid]
      self.state = {
        ...self.state,
        beliefs: remainingBeliefs,
        hypotheses: remainingHyps
      }
    })
  }

  apply_layer_feedback(...args: unknown[]): Effect.Effect<unknown> {
    const self = this
    return Effect.sync(() => {
      if (args.length === 0) return { applied: 0 }
      let applied = 0
      for (const arg of args) {
        const fb = arg as { belief_id?: string; action?: string; factor?: number }
        if (!fb.belief_id || !fb.action) continue
        if (fb.action === "deprecate") {
          const { [fb.belief_id]: _r, ...rest } = self.state.beliefs
          const b = self.state.beliefs[fb.belief_id]
          const hyps = { ...self.state.hypotheses }
          if (b) for (const hid of b.hypothesis_ids) delete hyps[hid]
          self.state = { ...self.state, beliefs: rest, hypotheses: hyps }
          applied++
          continue
        }
        const belief = self.state.beliefs[fb.belief_id]
        if (!belief) continue
        const factor = typeof fb.factor === "number" ? fb.factor : 1.0
        if (fb.action === "suppress") {
          self.state = {
            ...self.state,
            beliefs: {
              ...self.state.beliefs,
              [fb.belief_id]: { ...belief, volatility: belief.volatility + factor }
            }
          }
          applied++
        } else if (fb.action === "boost") {
          self.state = {
            ...self.state,
            beliefs: {
              ...self.state.beliefs,
              [fb.belief_id]: { ...belief, stability: belief.stability + Math.round(factor) }
            }
          }
          applied++
        }
      }
      return { applied }
    })
  }

  unresolved_beliefs(): Effect.Effect<ReadonlyArray<string>> {
    return Effect.succeed(
      Object.values(this.state.beliefs)
        .filter((b) => b.state === BeliefState.Unresolved)
        .map((b) => b.id)
    )
  }

  stats(): Effect.Effect<BeliefEngineState> {
    return Effect.succeed(this.state)
  }
}

export const BeliefEngineLive = Layer.succeed(BeliefEngine, new BeliefEngineImpl())
