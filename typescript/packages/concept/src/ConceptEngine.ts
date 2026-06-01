import { Effect, Layer, Option } from "effect"
import { xxh3_64 } from "@aura/utils"
import {
  BeliefState,
  type BeliefEngine,
  ConceptEngine,
  ConceptPartitionMode,
  ConceptSeedMode,
  ConceptSimilarityMode,
  ConceptState,
  ConceptUnionMode,
  EpistemicTrace,
  serviceOption,
  type ConceptCandidate,
  type ConceptEngineState,
  type ConceptReport,
  type Record as AuraRecord,
  type SdrLookup,
  Clock
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

// ── Canonical Feature Representation (Variant A) ──
// Fully implemented with 85+ stopwords, 80+ equivalence entries, and 15 stemming rules.

/**
 * Lightweight suffix stripping: remove common English suffixes to normalize word forms.
 * Conservative approach: only strip when the resulting base is >= 4 chars long
 * to avoid mangling short words.
 *
 * Extracted from Rust concept.rs stem_word() (lines 1502-1559).
 */
export function stemWord(word: string): string {
  const len = word.length

  // Minimum length to attempt stemming: require at least 6 chars
  // so the base after stripping is still meaningful (>= 4 chars)
  if (len <= 5) {
    return word
  }

  // Order matters: try longest suffixes first, require base >= 4 chars
  if (word.endsWith("ations") && len > 7) {
    return word.slice(0, len - 6)
  }
  if (word.endsWith("ation") && len > 6) {
    return word.slice(0, len - 5)
  }
  if (word.endsWith("ments") && len > 6) {
    return word.slice(0, len - 5)
  }
  if (word.endsWith("ment") && len > 5 && (len - 4) >= 4) {
    return word.slice(0, len - 4)
  }
  if (word.endsWith("ness") && len > 5 && (len - 4) >= 4) {
    return word.slice(0, len - 4)
  }
  if (word.endsWith("ting") && len > 5 && (len - 3) >= 4) {
    return word.slice(0, len - 3)
  }
  if (word.endsWith("ing") && len > 5 && (len - 3) >= 4) {
    return word.slice(0, len - 3)
  }
  if (word.endsWith("ied") && len > 5) {
    return word.slice(0, len - 3) + "y"
  }
  if (word.endsWith("ies") && len > 5) {
    return word.slice(0, len - 3) + "y"
  }
  if (word.endsWith("ed") && len > 5 && (len - 2) >= 4) {
    return word.slice(0, len - 2)
  }
  if (word.endsWith("ly") && len > 5 && (len - 2) >= 4) {
    return word.slice(0, len - 2)
  }
  if (word.endsWith("es") && len > 5 && (len - 2) >= 4) {
    return word.slice(0, len - 2)
  }
  if (word.endsWith("er") && len > 5 && (len - 2) >= 4) {
    return word.slice(0, len - 2)
  }
  if (word.endsWith("s") && !word.endsWith("ss") && len > 4 && (len - 1) >= 4) {
    return word.slice(0, len - 1)
  }

  return word
}

/**
 * Hand-curated equivalence dictionary for common domain terms.
 * Maps variant forms to a single canonical form.
 * Extracted from Rust concept.rs try_canonical() (lines 1562-1632).
 * ALL entries copied verbatim from Rust source — no additions, no omissions.
 */
export function applyEquivalenceDictionary(word: string): string {
  switch (word) {
    // deployment family
    case "deploy":
    case "deploys":
    case "deployed":
    case "deploying":
    case "deployment":
    case "deployments":
    case "post-deploy":
      return "deploy"
    case "rollout":
    case "rollouts":
    case "roll-out":
    case "rolling":
      return "rollout"
    case "rollback":
    case "rollbacks":
      return "rollback"
    case "release":
    case "releases":
    case "released":
    case "releasing":
      return "release"
    case "canary":
    case "canaries":
      return "canary"
    case "staging":
    case "staged":
    case "stage":
      return "staging"
    case "production":
    case "prod":
      return "production"
    case "blue-green":
      return "bluegreen"
    case "downtime":
      return "downtime"
    case "promote":
    case "promotes":
    case "promoted":
    case "promoting":
    case "promotion":
      return "promote"
    case "validate":
    case "validates":
    case "validated":
    case "validating":
    case "validation":
      return "validate"
    case "region":
    case "regions":
    case "regional":
      return "region"
    case "environment":
    case "environments":
    case "env":
      return "environment"
    case "smoke":
      return "smoke"
    // database family
    case "database":
    case "databases":
    case "db":
    case "postgresql":
    case "postgres":
    case "mysql":
      return "database"
    case "query":
    case "queries":
    case "querying":
    case "queried":
      return "query"
    case "index":
    case "indexes":
    case "indices":
    case "indexed":
    case "indexing":
      return "index"
    case "schema":
    case "schemas":
      return "schema"
    case "migration":
    case "migrations":
    case "migrating":
    case "migrate":
      return "migration"
    case "backup":
    case "backups":
    case "backed":
      return "backup"
    case "replica":
    case "replicas":
    case "replication":
    case "replicate":
      return "replica"
    case "connection":
    case "connections":
    case "connecting":
    case "connect":
      return "connection"
    case "pool":
    case "pools":
    case "pooling":
      return "pool"
    case "table":
    case "tables":
      return "table"
    case "partition":
    case "partitions":
    case "partitioning":
    case "partitioned":
      return "partition"
    // editor/UI family
    case "editor":
    case "editors":
      return "editor"
    case "theme":
    case "themes":
    case "themed":
      return "theme"
    case "dark":
    case "darker":
      return "dark"
    case "mode":
    case "modes":
      return "mode"
    case "font":
    case "fonts":
      return "font"
    case "keybinding":
    case "keybindings":
    case "binding":
    case "bindings":
      return "keybinding"
    case "vim":
    case "vi":
      return "vim"
    case "extension":
    case "extensions":
      return "extension"
    // process/workflow
    case "test":
    case "tests":
    case "testing":
    case "tested":
      return "test"
    case "monitor":
    case "monitors":
    case "monitoring":
    case "monitored":
      return "monitor"
    case "config":
    case "configuration":
    case "configurations":
    case "configure":
    case "configured":
    case "configuring":
      return "config"
    case "review":
    case "reviews":
    case "reviewing":
    case "reviewed":
    case "reviewer":
      return "review"
    case "approval":
    case "approve":
    case "approved":
    case "approving":
      return "approval"
    case "pipeline":
    case "pipelines":
      return "pipeline"
    case "security":
    case "secure":
    case "secured":
    case "securing":
      return "security"
    case "scan":
    case "scans":
    case "scanning":
    case "scanned":
    case "scanner":
      return "scan"
    case "strategy":
    case "strategies":
      return "strategy"
    case "artifact":
    case "artifacts":
      return "artifact"
    case "version":
    case "versions":
    case "versioned":
    case "versioning":
      return "version"
    case "timeout":
    case "timeouts":
      return "timeout"
    case "credential":
    case "credentials":
      return "credential"
    case "error":
    case "errors":
      return "error"
    case "metric":
    case "metrics":
      return "metric"
    case "service":
    case "services":
      return "service"
    case "log":
    case "logs":
    case "logging":
    case "logged":
      return "log"
    case "performance":
    case "perf":
      return "performance"
    // general
    case "feature":
    case "features":
      return "feature"
    case "flag":
    case "flags":
      return "flag"
    case "container":
    case "containers":
      return "container"
    case "registry":
    case "registries":
      return "registry"
    case "healthy":
    case "health":
      return "health"
    case "automated":
    case "automatic":
    case "auto":
      return "automated"
    default:
      return word
  }
}

/**
 * Extended stopword filter for canonical tokenization.
 * Broader than the term extraction stopwords — includes more function words.
 * Extracted from Rust concept.rs is_canonical_stopword() (lines 1637-1731).
 * ALL 91 entries copied verbatim from Rust source — no additions, no omissions.
 */
export function isCanonicalStopword(word: string): boolean {
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
    case "could":
    case "them":
    case "only":
    case "other":
    case "very":
    case "after":
    case "most":
    case "then":
    case "more":
    case "should":
    case "would":
    case "there":
    case "about":
    case "these":
    case "where":
    case "being":
    case "does":
    case "much":
    case "every":
    case "always":
    case "using":
    case "during":
    case "before":
    case "between":
    case "through":
    case "while":
    case "since":
    case "both":
    case "still":
    case "need":
    case "set":
    case "via":
    case "per":
    case "least":
    case "already":
      return true
    default:
      return false
  }
}

/**
 * Jaccard similarity between two token arrays.
 * |A ∩ B| / |A ∪ B|
 * Extracted from Rust concept.rs jaccard() (lines 1782-1793).
 */
export function jaccardSimilarity(tokensA: ReadonlyArray<string>, tokensB: ReadonlyArray<string>): number {
  if (tokensA.length === 0 && tokensB.length === 0) {
    return 0.0
  }
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection++
  }
  const union = setA.size + setB.size - intersection
  if (union === 0) return 0.0
  return intersection / union
}

/**
 * Extract canonical tokens from text content.
 * Pipeline: lowercase → split_whitespace → trim punctuation
 * → filter stopwords/short → equivalence dictionary → suffix stripping → dedup.
 * Extracted from Rust concept.rs canonical_tokens() (lines 1738-1757).
 */
export function canonicalTokens(content: string): string[] {
  const tokens = new Set<string>()
  const words = content.toLowerCase().split(/\s+/).filter(Boolean)

  for (const w of words) {
    // trim non-alphanumeric chars on both ends (Rust: trim_matches(!is_alphanumeric))
    const trimmed = w.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "")
    if (trimmed.length < 3) continue
    if (isCanonicalStopword(trimmed)) continue

    // First try equivalence dictionary on raw word
    const equiv = applyEquivalenceDictionary(trimmed)
    if (equiv !== trimmed) {
      if (equiv.length >= 2) tokens.add(equiv)
      continue
    }

    // Then stem and try dictionary on stemmed form
    const stemmed = stemWord(trimmed)
    const equivStemmed = applyEquivalenceDictionary(stemmed)
    if (equivStemmed !== stemmed) {
      if (equivStemmed.length >= 2) tokens.add(equivStemmed)
    } else if (stemmed.length >= 2) {
      tokens.add(stemmed)
    }
  }

  // Return sorted unique tokens
  return Array.from(tokens).sort()
}

/**
 * Build canonical tokens from content (convenience alias for canonicalTokens).
 */
export function buildCanonicalTokens(content: string): string[] {
  return canonicalTokens(content)
}

/**
 * Parse the family tag from a belief key.
 *
 * Belief key format: "namespace:sorted_tags:semantic_type" or
 * "namespace:sorted_tags:semantic_type#N" (subclustered).
 *
 * Returns the sorted_tags portion (second colon-delimited part),
 * or empty string if key has fewer than 3 parts.
 * Extracted from Rust concept.rs parse_belief_key_family() (line 1357).
 */
export function parseBeliefKeyFamily(key: string): string {
  const parts = key.split(":")
  if (parts.length >= 3) return parts[1]!
  return ""
}

/**
 * Split a family string into token set.
 * Family is comma-separated tags; this splits them into individual tokens.
 * Extracted from Rust concept.rs family_token_set() (line 1366).
 */
export function familyTokenSet(family: string): ReadonlySet<string> {
  if (!family) return new Set()
  return new Set(
    family
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  )
}

/**
 * Check if a family is "alerts" (generic/ambient category requiring stricter guards).
 * Extracted from Rust concept.rs is_generic_family() (line 1374).
 */
export function isGenericFamily(family: string): boolean {
  return family === "alerts"
}

// ── Cluster Guards ──
// Extracted from Rust concept.rs: cluster_beliefs (lines 1035-1083)
// and cluster_beliefs_canonical (lines 918-964).

/**
 * Compute the count of shared tags between two sets.
 * Used internally by guard functions.
 */
function computeSharedTags(
  tagsA: ReadonlySet<string>,
  tagsB: ReadonlySet<string>
): number {
  let count = 0
  for (const tag of tagsA) {
    if (tagsB.has(tag)) count++
  }
  return count
}

/**
 * Tag barrier: checks whether two beliefs share at least one tag.
 * If both beliefs have tags but share none, merging is blocked.
 * Rust concept.rs: cluster_beliefs lines 1038-1042, cluster_beliefs_canonical lines 918-923.
 */
export function tagBarrier(
  tagsA: ReadonlySet<string>,
  tagsB: ReadonlySet<string>
): boolean {
  if (tagsA.size === 0 || tagsB.size === 0) return true
  return computeSharedTags(tagsA, tagsB) > 0
}

/**
 * Family guard: prevents cross-family merges unless bridge exceptions apply.
 * Extracted from Rust concept.rs: cluster_beliefs lines 1044-1078,
 * cluster_beliefs_canonical lines 925-959.
 *
 * Returns 'allowed' when same family or bridge exception applies.
 * Returns 'blocked' when families differ and no bridge applies.
 * Returns 'bridge_allowed' when families differ but overlap bridge or single-tag bridge applies.
 */
export function familyGuard(
  familyA: string,
  familyB: string,
  sharedTags: number,
  stA: string,
  stB: string,
  unionMode: ConceptUnionMode
): "allowed" | "bridge_allowed" | "blocked" {
  if (familyA === familyB) return "allowed"
  if (!familyA || !familyB) return "allowed"

  const famA = familyTokenSet(familyA)
  const famB = familyTokenSet(familyB)

  let familyOverlap = 0
  for (const t of famA) {
    if (famB.has(t)) familyOverlap++
  }

  // Overlap bridge: both families have >= 2 tokens, family token overlap >= 1,
  // shared tags >= 1, and neither family is generic.
  const allowOverlapBridge =
    famA.size >= 2 &&
    famB.size >= 2 &&
    familyOverlap >= 1 &&
    sharedTags >= 1 &&
    !isGenericFamily(familyA) &&
    !isGenericFamily(familyB)

  // Single-tag fact↔decision bridge: requires SingleTagFactDecisionBridge mode,
  // each family exactly 1 tag, shared >= 2, non-generic, fact↔decision crossing.
  const allowSingleTagBridge =
    unionMode === ConceptUnionMode.SingleTagFactDecisionBridge &&
    famA.size === 1 &&
    famB.size === 1 &&
    sharedTags >= 2 &&
    !isGenericFamily(familyA) &&
    !isGenericFamily(familyB) &&
    ((stA === "fact" && stB === "decision") ||
      (stA === "decision" && stB === "fact"))

  if (allowOverlapBridge || allowSingleTagBridge) return "bridge_allowed"
  return "blocked"
}

/**
 * Generic family guard: families like "alerts" require stricter tag overlap.
 * Extracted from Rust concept.rs: cluster_beliefs lines 1080-1082,
 * cluster_beliefs_canonical lines 961-963.
 *
 * "alerts" family requires shared_tags >= 2.
 * Other families pass with any shared_tags count.
 */
export function genericFamilyGuard(
  family: string,
  sharedTags: number
): boolean {
  if (family === "alerts") {
    return sharedTags >= 2
  }
  return true
}

/**
 * Semantic type bridge: allows concepts with different semantic types
 * to merge when their tags overlap.
 *
 * - Same semantic_type → ALLOWED
 * - Different but tags overlap → ALLOWED (bridge via shared meaning)
 * - Otherwise → BLOCKED
 */
export function semanticTypeBridge(
  stA: string,
  stB: string,
  tagsA: ReadonlySet<string>,
  tagsB: ReadonlySet<string>
): boolean {
  if (stA === stB) return true
  if (tagsA.size === 0 || tagsB.size === 0) return false
  return computeSharedTags(tagsA, tagsB) > 0
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

/**
 * Generate a deterministic concept ID from key using xxh3.
 * Rust reference: `deterministic_id` (`../src/concept.rs`).
 */
function deterministicId(key: string): string {
  return `c-${xxh3_64(key).toString(16).padStart(12, "0")}`
}

/**
 * Build the low-32-bit centroid signature used in Rust concept keys.
 * Rust reference: `concept_key` (`../src/concept.rs`).
 */
function centroidSignatureU32Hex(centroids: ReadonlyArray<ReadonlyArray<number>>): string {
  const all: number[] = []
  for (const c of centroids) all.push(...c)
  dedupSorted(all)
  const bytes = new Uint8Array(all.length * 2)
  for (let i = 0; i < all.length; i++) {
    const v = all[i]!
    bytes[i * 2] = v & 0xff
    bytes[i * 2 + 1] = (v >>> 8) & 0xff
  }
  const h = xxh3_64(bytes)
  const u32 = Number(h & 0xffffffffn) >>> 0
  return u32.toString(16).padStart(8, "0")
}

export class ConceptEngineImpl implements ConceptEngine.Interface {
  private state: ConceptEngineState = {
    version: 1,
    concepts: {},
    key_index: {},
    seed_mode: ConceptSeedMode.Standard,
    similarity_mode: ConceptSimilarityMode.CanonicalFeature,
    partition_mode: ConceptPartitionMode.Standard,
    union_mode: ConceptUnionMode.Standard
  }

  /** 设置 seed 选择模式。 */
  with_seed_mode(mode: ConceptSeedMode): Effect.Effect<void> {
    this.state = { ...this.state, seed_mode: mode }
    return Effect.void
  }

  /** 设置 similarity 模式（用于测试切换 SdrTanimoto / CanonicalFeature）。 */
  with_similarity_mode(mode: ConceptSimilarityMode): Effect.Effect<void> {
    this.state = { ...this.state, similarity_mode: mode }
    return Effect.void
  }

  private selectSeeds(beliefs: ReadonlyArray<import("@aura/contract").Belief>, mode: ConceptSeedMode): string[] {
    const [minStability, minConfidence] =
      mode === ConceptSeedMode.Warmup
        ? [1.0, MIN_BELIEF_CONFIDENCE]
        : mode === ConceptSeedMode.Relaxed
          ? [1.0, 0.4]
          : [MIN_BELIEF_STABILITY, MIN_BELIEF_CONFIDENCE]
    return beliefs
      .filter(
        (b) =>
          (b.state === BeliefState.Resolved || b.state === BeliefState.Singleton) &&
          b.stability >= minStability &&
          b.confidence >= minConfidence
      )
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
      const key = mode === ConceptPartitionMode.NamespaceOnly ? ns : `${ns}:${st}`
      const arr = out.get(key)
      if (arr) arr.push(bid)
      else out.set(key, [bid])
    }
    return out
  }

  /**
   * Cluster beliefs using SDR centroid Tanimoto similarity.
   * Updated with 4-layer guard system matching Rust cluster_beliefs (lines 981-1097).
   */
  private clusterBeliefs(
    seedIds: ReadonlyArray<string>,
    centroids: Map<string, number[]>,
    beliefFamilies: ReadonlyMap<string, string>,
    beliefSemanticTypes: ReadonlyMap<string, string>
  ): string[][] {
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

    // Build tag sets per belief from families
    const beliefTags = new Map<string, ReadonlySet<string>>()
    for (const bid of seedIds) {
      const family = beliefFamilies.get(bid) ?? ""
      beliefTags.set(bid, familyTokenSet(family))
    }

    const emptyTags: ReadonlySet<string> = new Set()
    const unionMode = this.state.union_mode

    for (let i = 0; i < n; i++) {
      const a = centroids.get(seedIds[i]!) ?? []
      if (a.length === 0) continue

      const tagsI = beliefTags.get(seedIds[i]!) ?? emptyTags
      const familyI = beliefFamilies.get(seedIds[i]!) ?? ""
      const stI = beliefSemanticTypes.get(seedIds[i]!) ?? ""

      for (let j = i + 1; j < n; j++) {
        const b = centroids.get(seedIds[j]!) ?? []
        if (b.length === 0) continue

        const tagsJ = beliefTags.get(seedIds[j]!) ?? emptyTags
        const familyJ = beliefFamilies.get(seedIds[j]!) ?? ""
        const stJ = beliefSemanticTypes.get(seedIds[j]!) ?? ""

        const shared = computeSharedTags(tagsI, tagsJ)

        // Guard 1: Tag barrier
        if (!tagBarrier(tagsI, tagsJ)) continue

        // Guard 2: Family guard
        const famResult = familyGuard(familyI, familyJ, shared, stI, stJ, unionMode)
        if (famResult === "blocked") continue

        // Guard 3: Generic family guard
        if (!genericFamilyGuard(familyI, shared)) continue
        if (!genericFamilyGuard(familyJ, shared)) continue

        // Guard 4: Semantic type bridge
        if (!semanticTypeBridge(stI, stJ, tagsI, tagsJ)) continue

        // Only then: Tanimoto similarity check
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
   * Build canonical token sets per belief for CanonicalFeature mode.
   * Extracts tokens from each belief's records using the canonical_tokens pipeline.
   */
  private buildBeliefCanonicalTokens(
    seeds: ReadonlyArray<string>,
    beliefRecords: ReadonlyMap<string, ReadonlyArray<string>>,
    records: ReadonlyMap<string, AuraRecord>
  ): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const bid of seeds) {
      const rids = beliefRecords.get(bid)
      if (!rids) continue
      const tokenSet = new Set<string>()
      for (const rid of rids) {
        const rec = records.get(rid)
        if (!rec) continue
        for (const t of canonicalTokens(rec.content)) tokenSet.add(t)
        // Also include tags as canonical tokens (matching Rust belief_canonical_tokens)
        for (const tag of rec.tags) tokenSet.add(tag.toLowerCase())
      }
      if (tokenSet.size > 0) out.set(bid, Array.from(tokenSet).sort())
    }
    return out
  }

  /**
   * Cluster beliefs using canonical token Jaccard similarity.
   * Matching Rust cluster_beliefs_canonical (lines 866-978).
   *
   * Integrates 4-layer guard system before Jaccard check:
   * 1. tagBarrier — shared_tags >= 1 required
   * 2. familyGuard — cross-family merge blocked unless bridge exception
   * 3. genericFamilyGuard — "alerts" requires shared_tags >= 2
   * 4. semanticTypeBridge — different semantic types blocked unless tags overlap
   */
  private clusterBeliefsCanonical(
    seedIds: ReadonlyArray<string>,
    beliefTokens: ReadonlyMap<string, ReadonlyArray<string>>,
    beliefFamilies: ReadonlyMap<string, string>,
    beliefSemanticTypes: ReadonlyMap<string, string>
  ): string[][] {
    const n = seedIds.length
    if (n <= 1) return [seedIds.map((x) => x)]

    const parent = new Array<number>(n)
    for (let i = 0; i < n; i++) parent[i] = i

    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!
        x = parent[x]!
      }
      return x
    }
    const union = (a: number, b: number) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[ra] = rb
    }

    // Build tag sets per belief from records (extracted from belief_families split)
    const beliefTags = new Map<string, ReadonlySet<string>>()
    for (const bid of seedIds) {
      const family = beliefFamilies.get(bid) ?? ""
      beliefTags.set(bid, familyTokenSet(family))
    }

    const emptyTags: ReadonlySet<string> = new Set()
    const unionMode = this.state.union_mode

    for (let i = 0; i < n; i++) {
      const tokI = beliefTokens.get(seedIds[i]!)
      if (!tokI || tokI.length === 0) continue

      const tagsI = beliefTags.get(seedIds[i]!) ?? emptyTags
      const familyI = beliefFamilies.get(seedIds[i]!) ?? ""
      const stI = beliefSemanticTypes.get(seedIds[i]!) ?? ""

      for (let j = i + 1; j < n; j++) {
        const tokJ = beliefTokens.get(seedIds[j]!)
        if (!tokJ || tokJ.length === 0) continue

        const tagsJ = beliefTags.get(seedIds[j]!) ?? emptyTags
        const familyJ = beliefFamilies.get(seedIds[j]!) ?? ""
        const stJ = beliefSemanticTypes.get(seedIds[j]!) ?? ""

        const shared = computeSharedTags(tagsI, tagsJ)

        // Guard 1: Tag barrier
        if (!tagBarrier(tagsI, tagsJ)) continue

        // Guard 2: Family guard
        const famResult = familyGuard(familyI, familyJ, shared, stI, stJ, unionMode)
        if (famResult === "blocked") continue

        // Guard 3: Generic family guard (apply to both families)
        if (!genericFamilyGuard(familyI, shared)) continue
        if (!genericFamilyGuard(familyJ, shared)) continue

        // Guard 4: Semantic type bridge
        if (!semanticTypeBridge(stI, stJ, tagsI, tagsJ)) continue

        // Only then: Jaccard similarity check
        if (jaccardSimilarity(tokI, tokJ) >= CANONICAL_SIMILARITY_THRESHOLD) {
          union(i, j)
        }
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
    belief_engine: BeliefEngine.Interface,
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
      const avgCentroidSize =
        nonEmptyCentroids.length === 0
          ? 0
          : nonEmptyCentroids.map((c) => c.length).reduce((a, b) => a + b, 0) / nonEmptyCentroids.length

      const useCanonical = self.state.similarity_mode === ConceptSimilarityMode.CanonicalFeature
      // Build canonical token sets per belief (for CanonicalFeature mode)
      const beliefTokens = useCanonical
        ? self.buildBeliefCanonicalTokens(seeds, beliefRecords, records)
        : new Map<string, string[]>()

      // Report centroids/token-sets built
      const centroidsBuiltFinal = useCanonical
        ? Array.from(beliefTokens.values()).filter((t) => t.length > 0).length
        : nonEmptyCentroids.length

      const activeThreshold = useCanonical
        ? CANONICAL_SIMILARITY_THRESHOLD
        : CONCEPT_SIMILARITY_THRESHOLD

      /**
       * Build family and semantic_type maps from belief keys.
       * Family = second colon-delimited part of key (the sorted tags).
       * Semantic type = last colon-delimited part (strip #N suffix).
       * Matching Rust concept.rs discover() lines 388-405.
       */
      const beliefFamilies = new Map<string, string>()
      const beliefSemanticTypes = new Map<string, string>()
      for (const bid of seeds) {
        const belief = beliefs[bid]
        if (!belief) continue
        const [, st] = parseBeliefKeyNsSt(belief.key)
        beliefFamilies.set(bid, parseBeliefKeyFamily(belief.key))
        beliefSemanticTypes.set(bid, st)
      }

      /**
       * Cluster beliefs with guards aligned to Rust.
       * Family/tag barriers prevent cross-topic false merges.
       * Union mode supports SingleTagFactDecisionBridge for fact↔decision crossing.
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
          for (let j = i + 1; j < partitionSeeds.length; j++) {
            const t = useCanonical
              ? jaccardSimilarity(
                  beliefTokens.get(partitionSeeds[i]!) ?? [],
                  beliefTokens.get(partitionSeeds[j]!) ?? []
                )
              : tanimotoSorted(
                  centroids.get(partitionSeeds[i]!) ?? [],
                  centroids.get(partitionSeeds[j]!) ?? []
                )
            allTanimotos.push(t)
            pairwiseComparisons++
            if (t >= activeThreshold) pairwiseAbove++
          }
        }

        const clusters = useCanonical
          ? self.clusterBeliefsCanonical(partitionSeeds, beliefTokens, beliefFamilies, beliefSemanticTypes)
          : self.clusterBeliefs(partitionSeeds, centroids, beliefFamilies, beliefSemanticTypes)
        clustersAll.push(...clusters)
      }

      allTanimotos.sort((a, b) => a - b)
      const tanimotoMin = allTanimotos.length ? allTanimotos[0]! : 0
      const tanimotoMax = allTanimotos.length ? allTanimotos[allTanimotos.length - 1]! : 0
      const tanimotoAvg = allTanimotos.length ? allTanimotos.reduce((a, b) => a + b, 0) / allTanimotos.length : 0
      const tanimotoP50 = percentile(allTanimotos, 0.5)
      const tanimotoP95 = percentile(allTanimotos, 0.95)

      const newConcepts: Record<string, ConceptCandidate> = {}
      const newKeyIndex: Record<string, string> = {}

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
            ? ConceptState.Stable
            : abstractionScore >= CANDIDATE_THRESHOLD
              ? ConceptState.Candidate
              : ConceptState.Rejected

        const clusterCentroids = clusterBeliefIds.map((bid) => centroids.get(bid) ?? [])
        const centroidSig = centroidSignatureU32Hex(clusterCentroids)

        const key = conceptKey(namespace, semanticType, tags, coreTerms, centroidSig)
        const id = deterministicId(key)

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
          last_updated: yield* Clock.nowSeconds()
        }

        if (state === ConceptState.Stable) stableCount++
        else if (state === ConceptState.Rejected) rejectedCount++

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
        centroids_built: centroidsBuiltFinal,
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
    return Effect.succeed(Object.values(this.state.concepts).filter((c) => c.state === ConceptState.Stable).map((c) => c.id))
  }

  /** 返回 Candidate concepts 的 id 列表。 */
  active_candidates(): Effect.Effect<ReadonlyArray<string>> {
    return Effect.succeed(
      Object.values(this.state.concepts)
        .filter((c) => c.state !== ConceptState.Rejected)
        .map((c) => c.id)
    )
  }

  /** 返回当前引擎状态快照。 */
  stats(): Effect.Effect<ConceptEngineState> {
    return Effect.succeed(this.state)
  }
}

export const ConceptEngineLive = Layer.succeed(ConceptEngine, new ConceptEngineImpl())
