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
  type SdrLookup
} from "@aura/contract"
import { id12, nowSecs } from "@aura/utils"

/**
 * The belief engine — maintains the full belief state.
 *
 * Belief 引擎——维护完整的信念层状态（Belief/Hypothesis/索引），用于在 maintenance 周期中从 records
 * 构建更稳定的“主张层”。
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
 * Records with Tanimoto ≥ this threshold are considered to address the same claim.
 *
 * 在同一 coarse 分桶内，用 SDR 的 Tanimoto/Jaccard 相似度进一步拆分子簇；
 * 相似度 ≥ 阈值视为在讨论同一个 claim（合并为同簇）。
 */
const SDR_TANIMOTO_THRESHOLD = 0.6

/**
 * 取 record 的置信度（缺省为 0.9）。
 *
 * Rust 侧 `Record::default_confidence_for_source` 会按 source_type 给默认值；
 * TS 维护流程后续会进一步对齐该行为。
 */
function confidenceOf(rec: AuraRecord): number {
  const v = (rec as unknown as { confidence?: unknown }).confidence
  return typeof v === "number" && Number.isFinite(v) ? v : 0.9
}

/**
 * 取 record 的支持质量（缺省为 strength）。
 *
 * Rust 侧 belief 引擎会用 record.support_mass 做聚合；TS 目前向后兼容，
 * 若缺失则回退到 strength。
 */
function supportMassOf(rec: AuraRecord): number {
  const v = (rec as unknown as { support_mass?: unknown }).support_mass
  return typeof v === "number" && Number.isFinite(v) ? v : rec.strength
}

/**
 * 取 record 的冲突质量（缺省为 0）。
 *
 * Rust 侧冲突质量来自矛盾/反证路径的聚合；TS 目前先保留字段并允许外部写入。
 */
function conflictMassOf(rec: AuraRecord): number {
  const v = (rec as unknown as { conflict_mass?: unknown }).conflict_mass
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/**
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
 * 使用并查集（Union-Find）按 SDR 相似度把同一 coarse group 里的 records 进一步拆成子簇。
 */
function unionFindClusters(records: ReadonlyArray<AuraRecord>, lookup: SdrLookup): ReadonlyArray<ReadonlyArray<AuraRecord>> {
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
 * 假设综合评分（越高越强）。
 */
function computeHypothesisScore(h: Omit<Hypothesis, "score">): number {
  const supportScore = 1.0 + Math.log(1.0 + h.support_mass)
  const conflictPenalty = Math.log(1.0 + h.conflict_mass)
  const beliefScore = supportScore * h.confidence * h.recency * h.consistency
  return Math.max(beliefScore - LAMBDA * conflictPenalty, 0.0)
}

/**
 * Build one hypothesis from a record cluster.
 *
 * 从一个 record 簇构建一个 hypothesis（原型 record ids、置信度/支持度/冲突度等聚合后计算 score）。
 */
function hypothesisFromRecords(beliefId: string, records: ReadonlyArray<AuraRecord>): Hypothesis {
  const confidence = records.map(confidenceOf).reduce((a, b) => a + b, 0) / Math.max(1, records.length)
  const supportMass = records.map(supportMassOf).reduce((a, b) => a + b, 0)
  const conflictMass = records.map(conflictMassOf).reduce((a, b) => a + b, 0)
  const recency = 1.0
  const consistency = 1.0
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
 * 从多个 hypotheses 中决出 winner（或在证据接近时进入 Unresolved），并更新 belief 聚合字段
 *（score/confidence/support/conflict/stability）。
 */
function resolveBelief(prev: Belief, hypotheses: ReadonlyArray<Hypothesis>): Belief {
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
      last_updated: nowSecs()
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
      last_updated: nowSecs()
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
    last_updated: nowSecs()
  }
}

export class BeliefEngineImpl {
  private coarseKeyMode: CoarseKeyMode = CoarseKeyMode.Standard
  private state: BeliefEngineState = { version: 1, beliefs: {}, hypotheses: {}, record_to_belief: {} }

  /**
   * Controls how the coarse belief key is constructed before SDR subclustering.
   *
   * 设置 coarse key 的构造模式（在 SDR 子聚类前，先按 key 分桶）。
   */
  with_coarse_key_mode(mode: unknown): Effect.Effect<void> {
    this.coarseKeyMode = typeof mode === "string" ? (mode as CoarseKeyMode) : CoarseKeyMode.Standard
    return Effect.void
  }

  /**
   * Canonical claim key for a record (using current coarseKeyMode).
   *
   * 生成 claim key（使用当前 coarseKeyMode）。
   */
  claim_key(
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string
  ): Effect.Effect<string> {
    return this.claim_key_with_mode(namespace, tags, semantic_type, this.coarseKeyMode)
  }

  /**
   * Canonical claim key for a record (explicit mode).
   *
   * 生成 claim key（显式传入 mode）。
   */
  claim_key_with_mode(
    namespace: string,
    tags: ReadonlyArray<string>,
    semantic_type: string,
    mode: unknown
  ): Effect.Effect<string> {
    const ns = namespace.length > 0 ? namespace : "default"
    const st = semantic_type.length > 0 ? semantic_type : "unknown"
    const m = typeof mode === "string" ? (mode as CoarseKeyMode) : CoarseKeyMode.Standard
    if (m === CoarseKeyMode.SemanticOnly) return Effect.succeed(`${ns}:${st}`)
    const t = [...tags].filter((x) => x.length > 0).sort().join(",")
    return Effect.succeed(`${ns}:${t}:${st}`)
  }

  /**
   * Run a full belief update cycle over all records (without SDR data).
   *
   * 跑一轮 belief 全量更新（无 SDR 时的 fallback 路径）。
   */
  update(records: ReadonlyMap<string, AuraRecord>): Effect.Effect<BeliefReport, never, EpistemicTrace> {
    return this.update_with_sdr(records, new Map())
  }

  /**
   * Run a full belief update cycle with SDR-backed claim grouping.
   *
   * 跑一轮 belief 全量更新（带 SDR 分组）：
   * 1) 先按 claim key 分桶（namespace + tags + semantic_type）
   * 2) 在桶内按 SDR Tanimoto ≥ threshold 合并成子簇（Union-Find）
   * 3) 每个子簇构建 hypothesis，并在同一 belief 内 resolve winner / unresolved
   */
  update_with_sdr(
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ): Effect.Effect<BeliefReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      if (Option.isSome(traceOpt)) {
        yield* traceOpt.value.event("belief.update_with_sdr.start", {
          records: records.size,
          has_sdr: sdr_lookup.size > 0
        })
      }

      const coarseGroups = new Map<string, AuraRecord[]>()
      for (const rec of records.values()) {
        /**
         * TODO: NON-PARITY IMPLEMENTATION: content.length is a poor proxy for "trivial content" across languages (e.g., Chinese vs English).
         *
         * 待办：用 Intl.Segmenter 的 token/词数（或等价实现）替代字符长度阈值，
         * 以更稳健地表达 Rust “跳过 trivial content” 的意图。
         */
        if (rec.content.length < 10) continue
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
          last_updated: nowSecs()
        }

        const clusters =
          sdr_lookup.size > 0 ? unionFindClusters(groupRecords, sdr_lookup) : ([groupRecords] as const)
        const hyps: Hypothesis[] = []
        for (const cluster of clusters) {
          const hyp = hypothesisFromRecords(beliefId, cluster)
          hypothesesBuilt++
          nextHyps[hyp.id] = hyp
          hyps.push(hyp)
          belief = { ...belief, hypothesis_ids: [...belief.hypothesis_ids, hyp.id] }
          for (const rid of hyp.prototype_record_ids) recToBelief[rid] = beliefId
        }

        belief = resolveBelief(belief, hyps)
        nextBeliefs[beliefId] = belief
      }

      self.state = {
        version: 1,
        beliefs: nextBeliefs,
        hypotheses: nextHyps,
        record_to_belief: recToBelief
      }

      const report: BeliefReport = {
        coarse_groups: coarseGroups.size,
        beliefs_built: Object.keys(nextBeliefs).length,
        hypotheses_built: hypothesesBuilt
      }

      if (Option.isSome(traceOpt)) {
        yield* traceOpt.value.event("belief.update_with_sdr.end", report)
      }

      return report
    })
  }

  /**
   * Lookup belief id for a given record id.
   *
   * 查询 record 属于哪个 belief（用于下游索引/解释/rerank）。
   */
  belief_for_record(record_id: string): Effect.Effect<string | null> {
    return Effect.succeed(this.state.record_to_belief[record_id] ?? null)
  }

  /**
   * Deprecate a belief (tombstone / lifecycle control).
   *
   * 标记某个 belief 过期（当前实现为 no-op；后续 parity 会引入 tombstone/invalidated 状态）。
   */
  deprecate_belief(_belief_id: string): Effect.Effect<void> {
    return Effect.void
  }

  /**
   * Apply higher-layer feedback (corrections/policy pressure).
   *
   * 应用来自更高层的反馈（纠错/策略压力）。当前实现为占位 no-op，用于保持方法面与 Rust 对齐。
   */
  apply_layer_feedback(..._args: unknown[]): Effect.Effect<unknown> {
    return Effect.succeed(undefined)
  }

  /**
   * List belief ids currently in Unresolved state.
   *
   * 返回当前所有 Unresolved beliefs（用于提示“证据不足/冲突未解”的区域）。
   */
  unresolved_beliefs(): Effect.Effect<ReadonlyArray<string>> {
    return Effect.succeed(
      Object.values(this.state.beliefs)
        .filter((b) => b.state === BeliefState.Unresolved)
        .map((b) => b.id)
    )
  }

  /**
   * Return current engine state snapshot.
   *
   * 返回引擎当前状态快照（用于持久化与下游层）。
   */
  stats(): Effect.Effect<BeliefEngineState> {
    return Effect.succeed(this.state)
  }
}

export const BeliefEngineLive = Layer.succeed(BeliefEngine, new BeliefEngineImpl())
