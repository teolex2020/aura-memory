import xxhash from "xxhash-wasm"
import { Effect, Layer, Option } from "effect"
import {
  type BeliefEngineImpl,
  ConceptEngine,
  EpistemicTrace,
  serviceOption,
  type ConceptCandidate,
  type ConceptEngineState,
  type ConceptPartitionMode,
  type ConceptReport,
  type ConceptSeedMode,
  type ConceptSimilarityMode,
  type ConceptState,
  type ConceptUnionMode,
  type Record as AuraRecord,
  type SdrLookup
} from "@aura/contract"

/**
 * Concept Discovery Layer — finds stable abstractions over beliefs.
 *
 * 概念发现层：在 belief 之上抽象出更稳定的 concept 候选。
 *
 * Third tier of the cognitive hierarchy:
 *   Record → Belief → Concept → Causal Pattern → Policy
 *
 * Phase 1 constraints (read-only candidate discovery):
 *   - Does NOT influence recall ranking or record merge
 *   - Full rebuild each maintenance cycle (no persistent trust)
 *   - Every concept traces back to source belief_ids + record_ids
 *   - Unresolved beliefs are excluded from concept formation
 *
 * 第 1 阶段约束（只读候选发现）：
 *   - 不影响召回排序或 record 合并
 *   - 每次维护周期全量重建（不累积持久信任）
 *   - 每个 concept 都必须保留 provenance：belief_ids + record_ids
 *   - Unresolved beliefs 不参与 concept 形成
 */

/**
 * Minimum belief stability to be considered as a concept seed.
 * concept seed 的最小 belief 稳定性阈值。
 */
const MIN_BELIEF_STABILITY = 2.0

/**
 * Minimum belief confidence to be considered as a concept seed.
 * concept seed 的最小 belief 置信度阈值。
 */
const MIN_BELIEF_CONFIDENCE = 0.55

/**
 * Core term frequency threshold.
 * core term 的文档频率阈值。
 */
const CORE_TERM_THRESHOLD = 0.7

/**
 * Shell term lower bound.
 * shell term 的文档频率下界。
 */
const SHELL_TERM_LOWER = 0.2

/**
 * Tanimoto threshold for clustering beliefs into concept groups.
 * belief centroid 的 Tanimoto 相似度达到阈值则认为属于同一 concept 簇。
 */
const CONCEPT_SIMILARITY_THRESHOLD = 0.1

/** Abstraction score weights. abstraction_score 权重。 */
const W_SUPPORT = 0.35
const W_CONFIDENCE = 0.25
const W_STABILITY = 0.2
const W_COHESION = 0.2

/** State thresholds for abstraction_score. 状态阈值。 */
const STABLE_THRESHOLD = 0.75
const CANDIDATE_THRESHOLD = 0.5

/**
 * Canonical token Jaccard similarity threshold.
 * canonical feature 模式下的 Jaccard 阈值。
 */
const CANONICAL_SIMILARITY_THRESHOLD = 0.12

/**
 * Maximum seeds per partition before capping.
 * 每个分区最大 seed 数，避免 O(n²) 比较过大。
 */
const MAX_PARTITION_SIZE = 80

type Hasher = Readonly<{
  h64: (input: string) => bigint
  h64Raw: (input: Uint8Array) => bigint
}>

let hasherPromise: Promise<Hasher> | undefined

function getHasher(): Promise<Hasher> {
  hasherPromise ??= xxhash().then((h) => ({ h64: h.h64, h64Raw: h.h64Raw }))
  return hasherPromise
}

function nowSecs(): number {
  return Date.now() / 1000
}

function tanimotoSorted(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length === 0 || b.length === 0) return 0
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

function dedupSorted(xs: number[]): number[] {
  if (xs.length <= 1) return xs
  xs.sort((a, b) => a - b)
  let w = 1
  for (let r = 1; r < xs.length; r++) {
    if (xs[r] !== xs[w - 1]) {
      xs[w] = xs[r]!
      w++
    }
  }
  xs.length = w
  return xs
}

/**
 * Parse namespace and semantic_type from a belief key.
 *
 * Belief key format: "namespace:sorted_tags:semantic_type" or
 * "namespace:sorted_tags:semantic_type#N" (subclustered).
 *
 * 从 belief key 中解析 namespace 与 semantic_type（并去除 `#N` 后缀）。
 */
function parseBeliefKeyNsSt(key: string): readonly [string, string] {
  const parts = key.split(":")
  const ns = parts[0] && parts[0].length > 0 ? parts[0] : "default"
  const rawSt = parts.length > 0 ? parts[parts.length - 1]! : "fact"
  const st = rawSt.split("#")[0] ?? rawSt
  return [ns, st]
}

/**
 * Extract tags that appear in a majority of beliefs in a cluster.
 *
 * 提取在一个 cluster 的多数 beliefs 中出现的 tags。
 */
function extractStableTags(allTags: ReadonlyArray<string>, beliefCount: number): string[] {
  if (beliefCount <= 0) return []
  const freq = new Map<string, number>()
  for (const t of allTags) freq.set(t, (freq.get(t) ?? 0) + 1)
  const threshold = Math.ceil(beliefCount * 0.5)
  const out: string[] = []
  for (const [t, c] of freq.entries()) if (c >= threshold) out.push(t)
  out.sort()
  return out
}

/**
 * Simple English stopword filter.
 * 简单英文停用词过滤。
 */
function isStopword(word: string): boolean {
  switch (word) {
    case "the":
    case "and":
    case "for":
    case "are":
    case "but":
    case "not":
    case "you":
    case "all":
    case "can":
    case "had":
    case "her":
    case "was":
    case "one":
    case "our":
    case "out":
    case "has":
    case "his":
    case "how":
    case "its":
    case "may":
    case "new":
    case "now":
    case "old":
    case "see":
    case "way":
    case "who":
    case "did":
    case "get":
    case "let":
    case "say":
    case "she":
    case "too":
    case "use":
    case "with":
    case "this":
    case "that":
    case "have":
    case "from":
    case "they":
    case "been":
    case "will":
    case "into":
    case "when":
    case "what":
    case "which":
    case "their":
    case "than":
    case "each":
    case "make":
    case "like":
    case "just":
    case "over":
    case "such":
    case "take":
    case "also":
    case "some":
      return true
    default:
      return false
  }
}

/**
 * Extract core and shell terms from a set of records.
 *
 * Core: terms appearing in >= CORE_TERM_THRESHOLD fraction of records.
 * Shell: terms appearing in [SHELL_TERM_LOWER, CORE_TERM_THRESHOLD).
 *
 * 从 records 内容中提取 core/shell terms。
 */
function extractTerms(records: ReadonlyArray<AuraRecord>): readonly [string[], string[]] {
  const n = records.length
  if (n === 0) return [[], []]

  const docFreq = new Map<string, number>()
  for (const rec of records) {
    const terms = new Set<string>()
    for (const raw of rec.content.toLowerCase().split(/\s+/g)) {
      if (raw.length < 3) continue
      const w = raw.replace(/[^a-z0-9]+/gi, "")
      if (!w) continue
      if (isStopword(w)) continue
      terms.add(w)
    }
    for (const t of terms) docFreq.set(t, (docFreq.get(t) ?? 0) + 1)
  }

  const core: string[] = []
  const shell: string[] = []
  for (const [t, c] of docFreq.entries()) {
    const f = c / n
    if (f >= CORE_TERM_THRESHOLD) core.push(t)
    else if (f >= SHELL_TERM_LOWER) shell.push(t)
  }
  core.sort()
  shell.sort()
  return [core, shell]
}

/**
 * Average pairwise Tanimoto within a cluster of beliefs.
 *
 * 计算一个 belief cluster 内 centroids 的平均两两 Tanimoto（作为 cohesion）。
 */
function computeCohesion(beliefIds: ReadonlyArray<string>, centroids: ReadonlyMap<string, ReadonlyArray<number>>): number {
  const n = beliefIds.length
  if (n < 2) return 1.0
  let sum = 0
  let pairs = 0
  for (let i = 0; i < n; i++) {
    const a = centroids.get(beliefIds[i]!)
    if (!a || a.length === 0) continue
    for (let j = i + 1; j < n; j++) {
      const b = centroids.get(beliefIds[j]!)
      if (!b || b.length === 0) continue
      sum += tanimotoSorted(a, b)
      pairs++
    }
  }
  return pairs === 0 ? 0 : sum / pairs
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[idx]!
}

function conceptKey(
  namespace: string,
  semanticType: string,
  tags: ReadonlyArray<string>,
  coreTerms: ReadonlyArray<string>,
  centroidSigU32Hex: string
): string {
  const keyTerms = [...coreTerms].slice(0, 5)
  return `${namespace}:${tags.join(",")}:${semanticType}:${keyTerms.join(",")}:${centroidSigU32Hex}`
}

async function deterministicId(hasher: Hasher, key: string): Promise<string> {
  // NON-PARITY IMPLEMENTATION: Rust uses xxh3_64; TS uses xxh64 for determinism until xxh3 is available.
  // 差异说明：Rust 使用 xxh3_64；TS 先用 xxh64 保证可复现，后续补齐 xxh3 后可进一步对齐。
  const h = hasher.h64(key) & ((1n << 64n) - 1n)
  const hex = h.toString(16).padStart(16, "0")
  return `c-${hex.slice(-12)}`
}

async function centroidSignatureU32Hex(hasher: Hasher, centroids: ReadonlyArray<ReadonlyArray<number>>): Promise<string> {
  const all: number[] = []
  for (const c of centroids) all.push(...c)
  dedupSorted(all)
  const bytes = new Uint8Array(all.length * 2)
  for (let i = 0; i < all.length; i++) {
    const v = all[i]!
    bytes[i * 2] = v & 0xff
    bytes[i * 2 + 1] = (v >>> 8) & 0xff
  }
  const h = hasher.h64Raw(bytes) & ((1n << 64n) - 1n)
  const u32 = Number(h & 0xffffffffn) >>> 0
  return u32.toString(16).padStart(8, "0")
}

export class ConceptEngineImpl {
  private state: ConceptEngineState = {
    version: 1,
    concepts: {},
    key_index: {},
    seed_mode: "Standard",
    similarity_mode: "SdrTanimoto",
    partition_mode: "Standard",
    union_mode: "Standard"
  }

  /** 设置 seed 选择模式。 */
  with_seed_mode(mode: ConceptSeedMode): Effect.Effect<void> {
    this.state = { ...this.state, seed_mode: mode }
    return Effect.void
  }

  private selectSeeds(beliefs: ReadonlyArray<import("@aura/contract").Belief>, mode: ConceptSeedMode): string[] {
    const [minStability, minConfidence] =
      mode === "Warmup" ? [1.0, MIN_BELIEF_CONFIDENCE] : mode === "Relaxed" ? [1.0, 0.4] : [MIN_BELIEF_STABILITY, MIN_BELIEF_CONFIDENCE]
    return beliefs
      .filter((b) => (b.state === "Resolved" || b.state === "Singleton") && b.stability >= minStability && b.confidence >= minConfidence)
      .map((b) => b.id)
  }

  private collectBeliefRecords(
    beliefIds: ReadonlyArray<string>,
    beliefs: Readonly<Record<string, import("@aura/contract").Belief>>,
    hypotheses: Readonly<Record<string, import("@aura/contract").Hypothesis>>
  ): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const bid of beliefIds) {
      const belief = beliefs[bid]
      if (!belief) continue
      const rids: string[] = []
      for (const hid of belief.hypothesis_ids) {
        const h = hypotheses[hid]
        if (!h) continue
        rids.push(...h.prototype_record_ids)
      }
      rids.sort()
      const dedup: string[] = []
      for (const rid of rids) if (dedup.length === 0 || dedup[dedup.length - 1] !== rid) dedup.push(rid)
      out.set(bid, dedup)
    }
    return out
  }

  private buildCentroids(
    beliefIds: ReadonlyArray<string>,
    beliefs: Readonly<Record<string, import("@aura/contract").Belief>>,
    hypotheses: Readonly<Record<string, import("@aura/contract").Hypothesis>>,
    sdrLookup: SdrLookup
  ): Map<string, number[]> {
    const out = new Map<string, number[]>()
    for (const bid of beliefIds) {
      const belief = beliefs[bid]
      if (!belief) continue
      const bits: number[] = []
      for (const hid of belief.hypothesis_ids) {
        const hyp = hypotheses[hid]
        if (!hyp) continue
        for (const rid of hyp.prototype_record_ids) {
          const sdr = sdrLookup.get(rid)
          if (sdr) bits.push(...sdr)
        }
      }
      out.set(bid, dedupSorted(bits))
    }
    return out
  }

  private partitionSeeds(
    seedIds: ReadonlyArray<string>,
    beliefs: Readonly<Record<string, import("@aura/contract").Belief>>,
    mode: ConceptPartitionMode
  ): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const bid of seedIds) {
      const b = beliefs[bid]
      if (!b) continue
      const [ns, st] = parseBeliefKeyNsSt(b.key)
      const key = mode === "NamespaceOnly" ? ns : `${ns}:${st}`
      const arr = out.get(key)
      if (arr) arr.push(bid)
      else out.set(key, [bid])
    }
    return out
  }

  private clusterBeliefs(seedIds: ReadonlyArray<string>, centroids: Map<string, number[]>): string[][] {
    const n = seedIds.length
    if (n === 0) return []
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
      const a = centroids.get(seedIds[i]!) ?? []
      for (let j = i + 1; j < n; j++) {
        const b = centroids.get(seedIds[j]!) ?? []
        if (tanimotoSorted(a, b) >= CONCEPT_SIMILARITY_THRESHOLD) union(i, j)
      }
    }

    const clusters = new Map<number, string[]>()
    for (let i = 0; i < n; i++) {
      const root = find(i)
      const arr = clusters.get(root)
      if (arr) arr.push(seedIds[i]!)
      else clusters.set(root, [seedIds[i]!])
    }
    return Array.from(clusters.values())
  }

  /**
   * Run a full concept discovery cycle.
   *
   * Rebuilds all concepts from scratch using current belief engine state.
   * This is the primary entry point called from maintenance.
   *
   * 跑一轮 concept 全量发现：基于 belief 状态全量重建 concepts。
   */
  discover(
    belief_engine: BeliefEngineImpl,
    records: ReadonlyMap<string, AuraRecord>,
    sdr_lookup: SdrLookup
  ): Effect.Effect<ConceptReport, never, EpistemicTrace> {
    const self = this
    return Effect.gen(function* () {
      const traceOpt = yield* serviceOption(EpistemicTrace)
      const trace = Option.isSome(traceOpt) ? traceOpt.value : undefined
      if (trace) yield* trace.event("concept.discover.start", { records: records.size })

      const beliefState = yield* belief_engine.stats()
      const beliefs = beliefState.beliefs
      const hypotheses = beliefState.hypotheses
      const beliefList = Object.values(beliefs)

      const seeds = self.selectSeeds(beliefList, self.state.seed_mode)
      const seedsFound = seeds.length
      if (seeds.length < 2) {
        self.state = { ...self.state, concepts: {}, key_index: {} }
        const report: ConceptReport = {
          seeds_found: seedsFound,
          candidates_found: 0,
          stable_count: 0,
          rejected_count: 0,
          avg_abstraction_score: 0,
          centroids_built: 0,
          partitions_with_multiple_seeds: 0,
          multi_seed_partition_sizes: [],
          cluster_sizes: [],
          clusters_with_multiple_beliefs: 0,
          largest_cluster_size: 0,
          pairwise_comparisons: 0,
          pairwise_above_threshold: 0,
          tanimoto_min: 0,
          tanimoto_max: 0,
          tanimoto_avg: 0,
          tanimoto_p50: 0,
          tanimoto_p95: 0,
          avg_centroid_size: 0,
          seeds_capped: 0
        }
        if (trace) {
          yield* trace.event("concept.discover.end", {
            seeds_found: report.seeds_found,
            candidates_found: report.candidates_found,
            stable_count: report.stable_count,
            rejected_count: report.rejected_count,
            avg_abstraction_score: report.avg_abstraction_score
          })
        }
        return report
      }

      const beliefRecords = self.collectBeliefRecords(seeds, beliefs, hypotheses)
      const centroids = self.buildCentroids(seeds, beliefs, hypotheses, sdr_lookup)

      const nonEmptyCentroids = Array.from(centroids.values()).filter((c) => c.length > 0)
      const centroidsBuilt = nonEmptyCentroids.length
      const avgCentroidSize =
        nonEmptyCentroids.length === 0
          ? 0
          : nonEmptyCentroids.map((c) => c.length).reduce((a, b) => a + b, 0) / nonEmptyCentroids.length

      /**
       * TODO: NON-PARITY IMPLEMENTATION: Rust supports `CanonicalFeature` similarity mode and `union_mode` family bridging.
       *
       * 待办：Rust concept 引擎支持 CanonicalFeature 相似度与 union_mode 的 family bridge；
       * TS 当前仅实现 SdrTanimoto + 固定阈值聚类（保持主链路可跑通）。
       */
      const partitions = self.partitionSeeds(seeds, beliefs, self.state.partition_mode)
      const clustersAll: string[][] = []
      const allTanimotos: number[] = []
      let pairwiseComparisons = 0
      let pairwiseAbove = 0
      let seedsCapped = 0
      let partitionsWithMultipleSeeds = 0
      const multiSeedPartitionSizes: number[] = []

      for (const partitionSeedsRaw of partitions.values()) {
        if (partitionSeedsRaw.length < 2) continue
        partitionsWithMultipleSeeds++
        multiSeedPartitionSizes.push(partitionSeedsRaw.length)

        let partitionSeeds = partitionSeedsRaw
        if (partitionSeedsRaw.length > MAX_PARTITION_SIZE) {
          const dropped = partitionSeedsRaw.length - MAX_PARTITION_SIZE
          seedsCapped += dropped
          partitionSeeds = [...partitionSeedsRaw].sort((a, b) => {
            const ba = beliefs[a]
            const bb = beliefs[b]
            const sa = ba ? ba.stability : 0
            const sb = bb ? bb.stability : 0
            if (sb !== sa) return sb - sa
            return a < b ? -1 : a > b ? 1 : 0
          })
          partitionSeeds = partitionSeeds.slice(0, MAX_PARTITION_SIZE)
        }

        for (let i = 0; i < partitionSeeds.length; i++) {
          const a = centroids.get(partitionSeeds[i]!) ?? []
          for (let j = i + 1; j < partitionSeeds.length; j++) {
            const b = centroids.get(partitionSeeds[j]!) ?? []
            const t = tanimotoSorted(a, b)
            allTanimotos.push(t)
            pairwiseComparisons++
            if (t >= CONCEPT_SIMILARITY_THRESHOLD) pairwiseAbove++
          }
        }

        clustersAll.push(...self.clusterBeliefs(partitionSeeds, centroids))
      }

      allTanimotos.sort((a, b) => a - b)
      const tanimotoMin = allTanimotos.length ? allTanimotos[0]! : 0
      const tanimotoMax = allTanimotos.length ? allTanimotos[allTanimotos.length - 1]! : 0
      const tanimotoAvg = allTanimotos.length ? allTanimotos.reduce((a, b) => a + b, 0) / allTanimotos.length : 0
      const tanimotoP50 = percentile(allTanimotos, 0.5)
      const tanimotoP95 = percentile(allTanimotos, 0.95)

      const newConcepts: Record<string, ConceptCandidate> = {}
      const newKeyIndex: Record<string, string> = {}

      const hasher = yield* Effect.tryPromise(() => getHasher()).pipe(Effect.orDie)

      const clusterSizes: number[] = []
      let clustersWithMultipleBeliefs = 0
      let largestClusterSize = 0
      let stableCount = 0
      let rejectedCount = 0

      for (const clusterBeliefIds of clustersAll) {
        const clusterBeliefs = clusterBeliefIds
          .map((bid) => beliefs[bid])
          .filter((b): b is import("@aura/contract").Belief => b !== undefined)
        if (clusterBeliefs.length === 0) continue

        clusterSizes.push(clusterBeliefs.length)
        if (clusterBeliefs.length >= 2) clustersWithMultipleBeliefs++
        largestClusterSize = Math.max(largestClusterSize, clusterBeliefs.length)

        const allRecordIds: string[] = []
        for (const bid of clusterBeliefIds) {
          const rids = beliefRecords.get(bid)
          if (rids) allRecordIds.push(...rids)
        }
        allRecordIds.sort()
        const recordIds: string[] = []
        for (const rid of allRecordIds) if (recordIds.length === 0 || recordIds[recordIds.length - 1] !== rid) recordIds.push(rid)

        const clusterRecords: AuraRecord[] = []
        for (const rid of recordIds) {
          const r = records.get(rid)
          if (r) clusterRecords.push(r)
        }
        if (clusterRecords.length === 0) continue

        const [coreTerms, shellTerms] = extractTerms(clusterRecords)

        const allTags: string[] = []
        for (const b of clusterBeliefs) {
          const parts = b.key.split(":")
          if (parts.length >= 2) allTags.push(...parts[1]!.split(",").filter((x) => x.length > 0))
        }
        const tags = extractStableTags(allTags, clusterBeliefs.length)

        const firstKey = clusterBeliefs.map((b) => b.key).sort()[0]!
        const [namespace, semanticType] = parseBeliefKeyNsSt(firstKey)

        const supportMass = clusterBeliefs.map((b) => b.support_mass).reduce((a, b) => a + b, 0)
        const supportNorm = Math.log(1 + supportMass)
        const confidence = clusterBeliefs.map((b) => b.confidence).reduce((a, b) => a + b, 0) / clusterBeliefs.length
        const stability = clusterBeliefs.map((b) => b.stability).reduce((a, b) => a + b, 0) / clusterBeliefs.length
        const cohesion = computeCohesion(clusterBeliefIds, centroids)

        const abstractionScore =
          W_SUPPORT * Math.min(supportNorm, 1.0) +
          W_CONFIDENCE * confidence +
          W_STABILITY * (stability / (stability + 3.0)) +
          W_COHESION * cohesion

        const state: ConceptState =
          abstractionScore >= STABLE_THRESHOLD
            ? "Stable"
            : abstractionScore >= CANDIDATE_THRESHOLD
              ? "Candidate"
              : "Rejected"

        const clusterCentroids = clusterBeliefIds.map((bid) => centroids.get(bid) ?? [])
        const centroidSig = yield* Effect.tryPromise(() => centroidSignatureU32Hex(hasher, clusterCentroids)).pipe(Effect.orDie)

        const key = conceptKey(namespace, semanticType, tags, coreTerms, centroidSig)
        const id = yield* Effect.tryPromise(() => deterministicId(hasher, key)).pipe(Effect.orDie)

        const candidate: ConceptCandidate = {
          id,
          key,
          namespace,
          semantic_type: semanticType,
          belief_ids: [...clusterBeliefIds].sort(),
          record_ids: recordIds,
          core_terms: coreTerms,
          shell_terms: shellTerms,
          tags,
          support_mass: supportMass,
          confidence,
          stability,
          cohesion,
          abstraction_score: abstractionScore,
          state,
          last_updated: nowSecs()
        }

        if (state === "Stable") stableCount++
        else if (state === "Rejected") rejectedCount++

        newKeyIndex[key] = id
        newConcepts[id] = candidate
      }

      const candidatesFound = Object.keys(newConcepts).length
      const avgAbstractionScore =
        candidatesFound === 0
          ? 0
          : Object.values(newConcepts).map((c) => c.abstraction_score).reduce((a, b) => a + b, 0) / candidatesFound

      self.state = { ...self.state, concepts: newConcepts, key_index: newKeyIndex }

      const report: ConceptReport = {
        seeds_found: seedsFound,
        candidates_found: candidatesFound,
        stable_count: stableCount,
        rejected_count: rejectedCount,
        avg_abstraction_score: avgAbstractionScore,
        centroids_built: centroidsBuilt,
        partitions_with_multiple_seeds: partitionsWithMultipleSeeds,
        multi_seed_partition_sizes: multiSeedPartitionSizes,
        cluster_sizes: clusterSizes,
        clusters_with_multiple_beliefs: clustersWithMultipleBeliefs,
        largest_cluster_size: largestClusterSize,
        pairwise_comparisons: pairwiseComparisons,
        pairwise_above_threshold: pairwiseAbove,
        tanimoto_min: tanimotoMin,
        tanimoto_max: tanimotoMax,
        tanimoto_avg: tanimotoAvg,
        tanimoto_p50: tanimotoP50,
        tanimoto_p95: tanimotoP95,
        avg_centroid_size: avgCentroidSize,
        seeds_capped: seedsCapped
      }

      if (trace) {
        yield* trace.event("concept.discover.end", {
          seeds_found: report.seeds_found,
          candidates_found: report.candidates_found,
          stable_count: report.stable_count,
          rejected_count: report.rejected_count,
          avg_abstraction_score: report.avg_abstraction_score
        })
      }
      return report
    })
  }

  /** 返回 Stable concepts 的 id 列表。 */
  stable_concepts(): Effect.Effect<ReadonlyArray<string>> {
    return Effect.succeed(Object.values(this.state.concepts).filter((c) => c.state === "Stable").map((c) => c.id))
  }

  /** 返回 Candidate concepts 的 id 列表。 */
  active_candidates(): Effect.Effect<ReadonlyArray<string>> {
    return Effect.succeed(Object.values(this.state.concepts).filter((c) => c.state !== "Rejected").map((c) => c.id))
  }

  /** 返回当前引擎状态快照。 */
  stats(): Effect.Effect<ConceptEngineState> {
    return Effect.succeed(this.state)
  }
}

export const ConceptEngineLive = Layer.succeed(ConceptEngine, new ConceptEngineImpl())
