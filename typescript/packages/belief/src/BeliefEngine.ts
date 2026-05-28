import xxhash from "xxhash-wasm"
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
import { SDRInterpreter } from "@aura/recall"

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
 *
 * Rust: CLAIM_SIMILARITY_THRESHOLD = 0.15 (belief.rs:53)
 */
export const SDR_TANIMOTO_THRESHOLD = 0.15

/**
 * SDR tag guard threshold — used in DualKey/NeighborhoodPool modes.
 *
 * Rust: DualKey uses 0.10 (belief.rs:1053)
 */
export const SDR_TAG_GUARD_THRESHOLD = 0.10

/**
 * SDR tag fingerprint threshold — used in SdrTagPool mode.
 *
 * Rust: TAG_FINGERPRINT_SIMILARITY_THRESHOLD = 0.08 (belief.rs:56)
 */
export const TAG_SDR_FINGERPRINT_THRESHOLD = 0.08

/**
 * NeighborhoodPool relaxed SDR threshold.
 *
 * Rust: NeighborhoodPool => self.claim_similarity_override.unwrap_or(0.08) (belief.rs:1045)
 */
export const NEIGHBORHOOD_POOL_THRESHOLD = 0.08

/**
 * Exponential-decay half-life for recency (14 days in seconds).
 *
 * 新近度指数衰减半衰期（14 天，秒数）。
 * Rust: TAU_DAYS = 14.0 (belief.rs:34) → RECENCY_HALF_LIFE_SECS = 14 * 24 * 3600
 */
export const RECENCY_HALF_LIFE_SECS = 14 * 24 * 3600

/**
 * Maximum records per hypothesis before pruning weakest.
 * Reserved for large-scale belief groups.
 * Rust: MAX_RECORDS_PER_HYPOTHESIS = 50 (belief.rs:66)
 */
const MAX_RECORDS_PER_HYPOTHESIS = 50

/**
 * Bounded top-down feedback damping/boost caps.
 * Rust: MAX_TOTAL_FEEDBACK_BOOST = 0.08, MAX_TOTAL_FEEDBACK_DAMPING = 0.18 (belief.rs:57-58)
 */
const MAX_TOTAL_FEEDBACK_BOOST = 0.08
const MAX_TOTAL_FEEDBACK_DAMPING = 0.18
const MIN_FEEDBACK_CONFIDENCE = 0.05
const MAX_TOTAL_VOLATILITY_INCREASE = 0.20
const MAX_TOTAL_VOLATILITY_RELIEF = 0.06

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
 * Get byte length of a string (UTF-8 encoded), matching Rust's content.len().
 * Required because JavaScript string.length counts UTF-16 code units,
 * not bytes. Rust uses byte length for content filtering.
 *
 * 获取字符串的 UTF-8 字节长度，对齐 Rust 的 content.len()。
 */
function byteLength(s: string): number {
  // TextEncoder encodes to UTF-8 by default
  return new TextEncoder().encode(s).length
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
 * Minimal deterministic tag bridge table for safe densification experiments.
 *
 * Mirrors Rust normalize_bridge_tag at belief.rs:526-533.
 *
 * 最小确定性标签桥接表，用于安全的高密度实验。
 */
function normalizeBridgeTag(tag: string): string {
  const lower = tag.trim().toLowerCase()
  switch (lower) {
    case "ui":
    case "frontend":
      return "frontend"
    case "auth":
    case "authentication":
      return "authentication"
    case "deploy":
    case "release":
      return "release"
    default:
      return lower
  }
}

/**
 * Compute normalized bridge tags for a record.
 *
 * Mirrors Rust normalized_bridge_tags at belief.rs:536-546.
 */
function normalizedBridgeTags(record: AuraRecord): string[] {
  const tags = record.tags
    .map((t) => normalizeBridgeTag(t))
    .sort()
  // dedup
  return tags.filter((t, i) => i === 0 || t !== tags[i - 1]).slice(0, 3)
}

/**
 * Canonical tag text: sorted, deduped, lowercased tags joined by space.
 *
 * Mirrors Rust canonical_tag_text at belief.rs:548-558.
 */
function canonicalTagText(record: AuraRecord): string {
  const tags = record.tags
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0)
    .sort()
  // dedup
  const deduped = tags.filter((t, i) => i === 0 || t !== tags[i - 1])
  return deduped.join(" ")
}

/**
 * Interface for generating tag SDR fingerprints.
 * SDRInterpreter from @aura/recall satisfies this interface.
 */
export interface TagSdrGenerator {
  textToSdrLowered(text: string, isIdentity: boolean): number[]
}

/**
 * Split records into SDR sub-clusters using Union-Find (disjoint set).
 *
 * Mirrors Rust sdr_subcluster at belief.rs:678-733.
 *
 * 使用并查集按 SDR 相似度把同一 coarse group 里的 records 进一步拆成子簇。
 */
function unionFindClusters(
  records: ReadonlyArray<AuraRecord>,
  lookup: SdrLookup,
  threshold: number = SDR_TANIMOTO_THRESHOLD
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
      if (tanimoto(sdrI, sdrJ) >= threshold) union(i, j)
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
 * Exported alias for sdr_subcluster — plain Union-Find SDR subclustering.
 *
 * Mirrors Rust sdr_subcluster at belief.rs:678-733.
 */
export const sdrSubcluster = unionFindClusters

/**
 * Tag-guarded SDR subclustering for DualKey/NeighborhoodPool modes.
 *
 * Like sdr_subcluster, but additionally requires that two records share
 * at least 1 tag before they can be merged. Exception: if either side
 * has no tags, skip the tag barrier.
 *
 * Mirrors Rust sdr_subcluster_tag_guarded at belief.rs:741-803.
 */
export function sdrSubclusterTagGuarded(
  records: ReadonlyArray<AuraRecord>,
  lookup: SdrLookup,
  threshold: number
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

    const tagsI = new Set(records[i]!.tags)

    for (let j = i + 1; j < n; j++) {
      // Tag barrier: require shared tags >= 1
      // Exception: if either side has no tags, skip the barrier (Rust belief.rs:781)
      const tagsJ = records[j]!.tags
      const shared = tagsJ.some((t) => tagsI.has(t))
      if (!shared && tagsI.size > 0 && tagsJ.length > 0) {
        continue
      }

      const sdrJ = lookup.get(records[j]!.id)
      if (!sdrJ) continue

      if (tanimoto(sdrI, sdrJ) >= threshold) {
        union(i, j)
      }
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
 * Bridge-tag-guarded SDR subclustering for BridgeKey mode.
 *
 * Records may merge only if they share at least one normalized bridge tag
 * family and pass the SDR threshold.
 *
 * Mirrors Rust sdr_subcluster_bridge_guarded at belief.rs:810-875.
 */
export function sdrSubclusterBridgeGuarded(
  records: ReadonlyArray<AuraRecord>,
  lookup: SdrLookup,
  threshold: number
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

  const bridgeSets = records.map((rec) => new Set(normalizedBridgeTags(rec)))

  for (let i = 0; i < n; i++) {
    const sdrI = lookup.get(records[i]!.id)
    if (!sdrI) continue

    for (let j = i + 1; j < n; j++) {
      // Bridge guard: require shared normalized bridge tag
      const sharedBridge = [...bridgeSets[i]!].some((tag) => bridgeSets[j]!.has(tag))
      if (!sharedBridge) {
        continue
      }

      const sdrJ = lookup.get(records[j]!.id)
      if (!sdrJ) continue

      if (tanimoto(sdrI, sdrJ) >= threshold) {
        union(i, j)
      }
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
 * SDR-tag-guarded subclustering for SdrTagPool mode.
 *
 * Uses two deterministic guards:
 * 1. tag fingerprint overlap must exceed TAG_FINGERPRINT_SIMILARITY_THRESHOLD
 * 2. content SDR overlap must exceed the claim threshold
 *
 * Mirrors Rust sdr_subcluster_tag_sdr_guarded at belief.rs:882-957.
 */
export function sdrSubclusterTagSdrGuarded(
  records: ReadonlyArray<AuraRecord>,
  lookup: SdrLookup,
  threshold: number,
  tagSdrGen: TagSdrGenerator
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

  // Pre-compute tag SDR fingerprints
  const tagFingerprints: (number[] | null)[] = records.map((rec) => {
    const tagText = canonicalTagText(rec)
    if (tagText.length === 0) return null
    return tagSdrGen.textToSdrLowered(tagText, false)
  })

  for (let i = 0; i < n; i++) {
    const sdrI = lookup.get(records[i]!.id)
    if (!sdrI) continue

    for (let j = i + 1; j < n; j++) {
      // Guard 1: tag fingerprint similarity
      const fpI = tagFingerprints[i]
      const fpJ = tagFingerprints[j]
      if (!fpI || !fpJ || fpI.length === 0 || fpJ.length === 0) {
        continue
      }

      const tagSimilarity = tanimoto(fpI, fpJ)
      if (tagSimilarity < TAG_SDR_FINGERPRINT_THRESHOLD) {
        continue
      }

      // Guard 2: content SDR similarity
      const sdrJ = lookup.get(records[j]!.id)
      if (!sdrJ) continue

      if (tanimoto(sdrI, sdrJ) >= threshold) {
        union(i, j)
      }
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
 *
 * Mirrors Rust Hypothesis::compute_score at belief.rs:254-259.
 */
function computeHypothesisScore(h: Omit<Hypothesis, "score">): number {
  const supportScore = 1.0 + Math.log(1.0 + h.support_mass)
  const conflictPenalty = Math.log(1.0 + h.conflict_mass)
  const beliefScore = supportScore * h.confidence * h.recency * h.consistency
  return Math.max(beliefScore - LAMBDA * conflictPenalty, 0.0)
}

/**
 * Exponential-decay recency factor from record timestamps.
 * Decays from 1.0 with configurable half-life (default 14 days).
 *
 * 指数衰减新近度因子：基于 record 时间戳计算，以半衰期衰减（默认 14 天）。
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
 * Uses sample variance (divisor n-1) matching Rust's belief.rs:225-226.
 *
 * 内部一致性：1/(1+置信度标准差)，方差越大一致性越低、假设越弱。
 */
export function computeConsistency(confidences: ReadonlyArray<number>): number {
  if (confidences.length <= 1) return 1.0
  const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length
  // Sample variance: divide by (n-1), matching Rust's `/(confidences.len() - 1)`
  const variance = confidences.reduce((sum, c) => sum + (c - mean) ** 2, 0) / (confidences.length - 1)
  return 1.0 / (1.0 + Math.sqrt(variance))
}

/**
 * Split records into (supporting, opposing) based on contradiction markers.
 *
 * Mirrors Rust split_by_contradiction at belief.rs:1238-1251.
 *
 * Records with semantic_type="contradiction" or conflict_mass > support_mass
 * go into the opposing group.
 *
 * 将 records 按矛盾标记分为 supporting（支持）和 opposing（反对）两组。
 */
export function splitByContradiction(
  records: ReadonlyArray<AuraRecord>
): [AuraRecord[], AuraRecord[]] {
  const supporting: AuraRecord[] = []
  const opposing: AuraRecord[] = []

  for (const rec of records) {
    if (rec.semantic_type === "contradiction" || conflictMassOf(rec) > supportMassOf(rec)) {
      opposing.push(rec)
    } else {
      supporting.push(rec)
    }
  }

  return [supporting, opposing]
}

/**
 * Compute a deterministic hypothesis ID from belief_id + sorted record IDs.
 *
 * NON-PARITY: uses xxh64 (bridge) not xxh3_64 (Rust) — IDs are deterministic
 * (same input → same output across TS runs) but do NOT match Rust values
 * byte-for-byte. This is a tracked non-parity marker until `xxh3-wasm` is available.
 *
 * Mirrors Rust Hypothesis::deterministic_id at belief.rs:179-189.
 *
 * 确定性假设 ID：基于 belief_id + 排序后的 record IDs 通过 xxh64 哈希生成。
 * 注意：使用 xxh64 而非 Rust 的 xxh3_64，输出值不同但保持确定性。
 */
export function deterministicHypothesisId(
  hasher: { h64: (input: string) => bigint },
  beliefId: string,
  records: ReadonlyArray<AuraRecord>
): string {
  const ids = records.map((r) => r.id).sort()
  const buf = [beliefId, ...ids].join("\0")
  const hash = hasher.h64(buf) & ((1n << 64n) - 1n)
  return hash.toString(16).padStart(12, "0")
}

// Lazy-initialized xxhash hasher instance (shared across engine impls)
let _xxhashHasher: { h64: (input: string) => bigint } | null = null

async function getXxhashHasher(): Promise<{ h64: (input: string) => bigint }> {
  if (!_xxhashHasher) {
    const hasher = await xxhash()
    _xxhashHasher = { h64: (input: string) => hasher.h64(input) }
  }
  return _xxhashHasher!
}

/**
 * Build one hypothesis from a record cluster using deterministic IDs.
 *
 * 从一个 record 簇构建一个 hypothesis（使用确定性 ID）。
 *
 * Mirrors Rust Hypothesis::from_records at belief.rs:193-245.
 */
async function hypothesisFromRecords(
  beliefId: string,
  records: ReadonlyArray<AuraRecord>,
  now: number
): Promise<Hypothesis> {
  const hasher = await getXxhashHasher()
  const id = deterministicHypothesisId(hasher, beliefId, records)

  const confidences = records.map(confidenceOf)
  const confidence = confidences.reduce((a, b) => a + b, 0) / Math.max(1, records.length)
  const supportMass = records.map(supportMassOf).reduce((a, b) => a + b, 0)
  const conflictMass = records.map(conflictMassOf).reduce((a, b) => a + b, 0)
  const timestamps = records.map((r) => r.created_at)
  const recency = computeRecency(timestamps, now)
  const consistency = computeConsistency(confidences)
  const base = {
    id,
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
 *
 * Mirrors Rust Belief::resolve at belief.rs:326-393.
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
  private state: BeliefEngineState = {
    version: 1,
    beliefs: {},
    hypotheses: {},
    record_to_belief: {},
    key_index: {},
    record_index: {}
  }

  // In-memory index structures for incremental update
  private keyIndex: Map<string, string> = new Map()
  private recordIndex: Map<string, string> = new Map()

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
        activeTags.splice(1) // truncate to top 1
        return Effect.succeed(`${ns}:${activeTags[0] ?? "none"}:${st}`)
      case CoarseKeyMode.TagFamily:
      case CoarseKeyMode.TagFamilyAdaptive:
      case CoarseKeyMode.TagFamilyBackoff:
      case CoarseKeyMode.TagFamilyDenseBackoff: {
        // Rust: alphabetically first tag is the family tag
        const family = activeTags[0] ?? "none"
        return Effect.succeed(`${ns}:${family}:${st}`)
      }
      case CoarseKeyMode.TagFamilyPairBackoff:
        activeTags.splice(2) // truncate to top 2
        return Effect.succeed(`${ns}:${activeTags.join(",")}:${st}`)
      case CoarseKeyMode.DualKey:
      case CoarseKeyMode.NeighborhoodPool:
        // Rust: broad corridor = namespace:semantic_type, fine grouping by tag-guarded SDR
        return Effect.succeed(`${ns}:${st}`)
      case CoarseKeyMode.BridgeKey:
        return Effect.succeed(`${ns}:${activeTags[0] ?? "none"}:bridge:${st}`)
      case CoarseKeyMode.SdrTagPool:
        // Rust: broad corridor = namespace:semantic_type, fine grouping by tag-SDR guard
        return Effect.succeed(`${ns}:${st}`)
      default:
        // Standard: namespace:sorted_tags(top3):semantic_type
        activeTags.splice(3) // truncate to top 3
        return Effect.succeed(`${ns}:${activeTags.join(",")}:${st}`)
    }
  }

  update(records: ReadonlyMap<string, AuraRecord>): Effect.Effect<BeliefReport, never, EpistemicTrace> {
    return this.update_with_sdr(records, new Map())
  }

  /**
   * Full belief update cycle with SDR-backed claim grouping.
   *
   * Mirrors Rust update_with_sdr at belief.rs:976-1232.
   *
   * Flow: coarse grouping → subcluster dispatch → split_by_contradiction
   * → build hypotheses → resolve beliefs → prune stale.
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

      const hasSdr = sdr_lookup.size > 0

      // Step 1: Coarse grouping by tag key
      // Rust: belief.rs:985-1011 — filters by content.len() < 10, builds coarse_groups
      const coarseGroups = new Map<string, AuraRecord[]>()
      for (const rec of records.values()) {
        // Rust: content.len() < 10 → skip (byte-length, not token estimate)
        if (byteLength(rec.content) < 10) continue
        const key = yield* self.claim_key(rec.namespace, rec.tags, rec.semantic_type)
        const arr = coarseGroups.get(key)
        if (arr) arr.push(rec)
        else coarseGroups.set(key, [rec])
      }

      // Step 2: Fine grouping — for each coarse group, dispatch to subcluster strategy
      // Rust: belief.rs:1034-1119 — mode-specific subcluster dispatch
      const groups = new Map<string, readonly AuraRecord[]>()
      for (const [coarseKey, groupRecords] of coarseGroups.entries()) {
        if (!hasSdr || groupRecords.length < 2) {
          groups.set(coarseKey, groupRecords)
          continue
        }

        const threshold = self.effectiveThreshold()
        const isTagGuard = self.coarseKeyMode === CoarseKeyMode.DualKey ||
          self.coarseKeyMode === CoarseKeyMode.NeighborhoodPool
        const isBridgeGuard = self.coarseKeyMode === CoarseKeyMode.BridgeKey
        const isTagSdrGuard = self.coarseKeyMode === CoarseKeyMode.SdrTagPool

        let subclusters: ReadonlyArray<ReadonlyArray<AuraRecord>>
        if (isTagGuard) {
          subclusters = sdrSubclusterTagGuarded(groupRecords, sdr_lookup, threshold)
        } else if (isBridgeGuard) {
          subclusters = sdrSubclusterBridgeGuarded(groupRecords, sdr_lookup, threshold)
        } else if (isTagSdrGuard) {
          const sdrInterpreter = yield* Effect.promise(() => self.getSdrInterpreter())
          subclusters = sdrSubclusterTagSdrGuarded(groupRecords, sdr_lookup, threshold, sdrInterpreter)
        } else {
          subclusters = sdrSubcluster(groupRecords, sdr_lookup, threshold)
        }

        if (subclusters.length === 1) {
          groups.set(coarseKey, groupRecords)
        } else {
          for (let idx = 0; idx < subclusters.length; idx++) {
            const subKey = `${coarseKey}#${idx}`
            groups.set(subKey, subclusters[idx]!)
          }
        }
      }

      // Step 3: For each group, use splitByContradiction to build hypotheses
      // Rust: belief.rs:1122-1197 — split_by_contradiction, build hypotheses, resolve
      const newKeyIndex = new Map<string, string>()
      const newRecordIndex = new Map<string, string>()
      let beliefsCreated = 0
      let revisions = 0
      let resolvedCount = 0
      let unresolvedCount = 0

      for (const [key, groupRecords] of groups.entries()) {
        if (groupRecords.length < 2) continue

        // Look up existing belief by key_index (incremental)
        let beliefId: string
        const existingBid = self.keyIndex.get(key)
        if (existingBid && self.state.beliefs[existingBid]) {
          beliefId = existingBid
        } else {
          // New belief — create
          beliefId = yield* Effect.promise(() => getXxhashHasher().then((h) => deterministicHypothesisId(h, key, groupRecords)))
          beliefsCreated++
        }
        newKeyIndex.set(key, beliefId)

        // Split into supporting and opposing groups
        const [supporting, opposing] = splitByContradiction(groupRecords)

        const hypRefs: string[] = []

        // Build supporting hypothesis
        if (supporting.length > 0) {
          const h = yield* Effect.promise(() => hypothesisFromRecords(beliefId, supporting, now))
          for (const rid of h.prototype_record_ids) {
            newRecordIndex.set(rid, h.id)
          }
          self.state = {
            ...self.state,
            hypotheses: { ...self.state.hypotheses, [h.id]: h }
          }
          hypRefs.push(h.id)
        }

        // Build opposing hypothesis (if any contradictions)
        if (opposing.length > 0) {
          const h = yield* Effect.promise(() => hypothesisFromRecords(beliefId, opposing, now))
          for (const rid of h.prototype_record_ids) {
            newRecordIndex.set(rid, h.id)
          }
          self.state = {
            ...self.state,
            hypotheses: { ...self.state.hypotheses, [h.id]: h }
          }
          hypRefs.push(h.id)
        }

        // Get or create belief
        let belief = self.state.beliefs[beliefId] ?? {
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

        // Clean up old hypothesis IDs that are NOT reused this cycle
        for (const oldHid of belief.hypothesis_ids) {
          if (!hypRefs.includes(oldHid)) {
            const { [oldHid]: _removed, ...rest } = self.state.hypotheses
            self.state = { ...self.state, hypotheses: rest }
          }
        }
        belief = { ...belief, hypothesis_ids: hypRefs }

        const hyps = hypRefs
          .map((hid) => self.state.hypotheses[hid])
          .filter((h): h is Hypothesis => h !== undefined)

        const prevWinner = belief.winner_id
        belief = resolveBelief(belief, hyps, now)

        // Track revisions
        if (prevWinner && belief.winner_id !== prevWinner) {
          revisions++
        }

        if (belief.state === BeliefState.Resolved || belief.state === BeliefState.Singleton) {
          resolvedCount++
        } else if (belief.state === BeliefState.Unresolved) {
          unresolvedCount++
        }

        self.state = {
          ...self.state,
          beliefs: { ...self.state.beliefs, [beliefId]: belief }
        }
      }

      // Step 4: Prune stale beliefs for keys that no longer exist
      // Rust: belief.rs:1199-1216
      let beliefsPruned = 0
      for (const [oldKey, oldBid] of self.keyIndex.entries()) {
        if (!newKeyIndex.has(oldKey)) {
          self.keyIndex.delete(oldKey)
          const belief = self.state.beliefs[oldBid]
          if (belief) {
            // Soft-deprecate: halve confidence, set to Unresolved
            const newConfidence = Math.max(belief.confidence * 0.5, MIN_FEEDBACK_CONFIDENCE)
            const newScore = belief.confidence > 0
              ? belief.score * (newConfidence / belief.confidence)
              : newConfidence
            self.state = {
              ...self.state,
              beliefs: {
                ...self.state.beliefs,
                [oldBid]: {
                  ...belief,
                  confidence: newConfidence,
                  score: newScore,
                  state: BeliefState.Unresolved,
                  winner_id: null,
                  stability: 0,
                  last_updated: now
                }
              }
            }
            beliefsPruned++
          }
        }
      }

      // Update in-memory indices
      self.keyIndex = newKeyIndex
      self.recordIndex = new Map<string, string>()
      for (const [rid, hid] of newRecordIndex.entries()) {
        if (self.state.hypotheses[hid]) {
          self.recordIndex.set(rid, hid)
        }
      }

      // Build key_index and record_index for state
      const keyIndexRecord: Record<string, string> = {}
      for (const [key, bid] of newKeyIndex.entries()) {
        keyIndexRecord[key] = bid
      }
      const recordIndexRecord: Record<string, string> = {}
      for (const [rid, hid] of self.recordIndex.entries()) {
        recordIndexRecord[rid] = hid
      }

      self.state = {
        ...self.state,
        key_index: keyIndexRecord,
        record_index: recordIndexRecord,
        record_to_belief: recordIndexRecord
      }

      const totalBeliefs = Object.keys(self.state.beliefs).length
      const totalHypotheses = Object.keys(self.state.hypotheses).length

      const report: BeliefReport = {
        coarse_groups: coarseGroups.size,
        beliefs_built: beliefsCreated,
        hypotheses_built: totalHypotheses,
        beliefs_created: beliefsCreated,
        beliefs_pruned: beliefsPruned,
        revisions,
        resolved: resolvedCount,
        unresolved: unresolvedCount,
        total_beliefs: totalBeliefs,
        total_hypotheses: totalHypotheses,
        // Rust: churn_rate = revisions / max(total_beliefs, 1)
        churn_rate: totalBeliefs > 0 ? revisions / totalBeliefs : 0
      }

      if (Option.isSome(traceOpt)) {
        yield* traceOpt.value.event("belief.update_with_sdr.end", report)
      }

      return report
    })
  }

  // Lazy-initialized SDRInterpreter for tag fingerprint generation
  private sdrInterpreterPromise: Promise<SDRInterpreter> | null = null

  getSdrInterpreter(): Promise<SDRInterpreter> {
    if (!this.sdrInterpreterPromise) {
      this.sdrInterpreterPromise = SDRInterpreter.default()
    }
    return this.sdrInterpreterPromise
  }

  private effectiveThreshold(): number {
    switch (this.coarseKeyMode) {
      case CoarseKeyMode.NeighborhoodPool:
        return NEIGHBORHOOD_POOL_THRESHOLD // 0.08 (Rust belief.rs:1045)
      case CoarseKeyMode.DualKey:
        return SDR_TAG_GUARD_THRESHOLD // 0.10
      case CoarseKeyMode.SdrTagPool:
        return SDR_TAG_GUARD_THRESHOLD // 0.10
      default:
        return SDR_TANIMOTO_THRESHOLD // 0.15
    }
  }

  belief_for_record(record_id: string): Effect.Effect<string | null> {
    return Effect.succeed(this.state.record_to_belief[record_id] ?? null)
  }

  /**
   * Soft-deprecate a belief: halve confidence, set to Unresolved, clear winner.
   *
   * Mirrors Rust deprecate_belief at belief.rs:1264-1281.
   * Does NOT delete the belief — only downgrades it.
   */
  deprecate_belief(belief_id: string): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const belief = self.state.beliefs[belief_id]
      if (!belief) return

      const newConfidence = Math.max(belief.confidence * 0.5, MIN_FEEDBACK_CONFIDENCE)
      const newScore = belief.confidence > 0
        ? belief.score * (newConfidence / belief.confidence)
        : newConfidence

      self.state = {
        ...self.state,
        beliefs: {
          ...self.state.beliefs,
          [belief_id]: {
            ...belief,
            confidence: newConfidence,
            score: newScore,
            state: BeliefState.Unresolved,
            winner_id: null,
            stability: 0,
            last_updated: Date.now() / 1000
          }
        }
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
          const b = self.state.beliefs[fb.belief_id]
          if (!b) continue
          const newConfidence = Math.max(b.confidence * 0.5, MIN_FEEDBACK_CONFIDENCE)
          const newScore = b.confidence > 0 ? b.score * (newConfidence / b.confidence) : newConfidence
          self.state = {
            ...self.state,
            beliefs: {
              ...self.state.beliefs,
              [fb.belief_id]: {
                ...b,
                confidence: newConfidence,
                score: newScore,
                state: BeliefState.Unresolved,
                winner_id: null,
                stability: 0,
                last_updated: Date.now() / 1000
              }
            }
          }
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
    // Sync in-memory indices back to state before returning
    const keyIndexRecord: Record<string, string> = {}
    for (const [key, bid] of this.keyIndex.entries()) {
      keyIndexRecord[key] = bid
    }
    const recordIndexRecord: Record<string, string> = {}
    for (const [rid, hid] of this.recordIndex.entries()) {
      recordIndexRecord[rid] = hid
    }
    return Effect.succeed({
      ...this.state,
      key_index: keyIndexRecord,
      record_index: recordIndexRecord,
      record_to_belief: recordIndexRecord
    })
  }
}

export const BeliefEngineLive = Layer.succeed(BeliefEngine, new BeliefEngineImpl())
