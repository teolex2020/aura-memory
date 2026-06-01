import { Effect } from "effect"
import {
  DEFAULT_NAMESPACE,
  Level,
  Record as AuraRecord,
  RecallViewTag,
  type BeliefEngineState,
  type LimitedRerankReport,
  type RecallScored,
  type ShadowRecallReport,
} from "@aura/contract"
import {
  applyBeliefRerank,
  computeShadowBeliefScores,
  recallPipeline,
  recallPipelineWithTrace,
  type RecallPipelineOptions,
  type RecallTraceResult,
} from "@aura/recall"

import type { RecallHit } from "./Recall"

const IDENTITY_BUDGET_RATIO = 0.25
const TOKENS_PER_WORD = 1.3
const DEFAULT_CACHE_TTL_SECS = 300
const DEFAULT_CACHE_MAX_ENTRIES = 50

type CacheEntry<T> = {
  readonly result: T
  readonly insertedAtMs: number
}

/**
 * In-memory recall cache entry map with Rust default TTL/capacity.
 * @zh 内存 formatted recall cache；TTL 与容量默认值对齐 Rust `RecallCache`。
 *
 * Rust reference: `RecallCache` (`../src/cache.rs`).
 */
export type RecallCache = {
  readonly ttlSecs: number
  readonly maxEntries: number
  readonly entries: Map<string, CacheEntry<string>>
}

/**
 * In-memory structured recall cache for raw scored record results.
 * @zh structured recall 结果缓存，key 语义对齐 Rust `StructuredRecallCache::make_key`。
 *
 * Rust reference: `StructuredRecallCache` (`../src/cache.rs`).
 */
export type StructuredRecallCache<TRecord> = {
  readonly ttlSecs: number
  readonly maxEntries: number
  readonly entries: Map<string, CacheEntry<ReadonlyArray<RecallHit<TRecord>>>>
}

/**
 * Create a RecallCache with Rust default settings.
 * @zh 创建 formatted recall cache；默认 300 秒 TTL、50 条容量。
 *
 * Rust reference: `RecallCache::new` / `Default` (`../src/cache.rs`).
 */
export function createRecallCache(
  ttlSecs = DEFAULT_CACHE_TTL_SECS,
  maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
): RecallCache {
  return { ttlSecs, maxEntries, entries: new Map() }
}

/**
 * Create a StructuredRecallCache with Rust default settings.
 * @zh 创建 structured recall cache；默认 300 秒 TTL、50 条容量。
 *
 * Rust reference: `StructuredRecallCache::new` / `Default` (`../src/cache.rs`).
 */
export function createStructuredRecallCache<TRecord>(
  ttlSecs = DEFAULT_CACHE_TTL_SECS,
  maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
): StructuredRecallCache<TRecord> {
  return { ttlSecs, maxEntries, entries: new Map() }
}

/**
 * Clear formatted recall cache entries after write-affecting operations.
 * @zh 在写入影响召回结果后清空 formatted recall cache。
 *
 * Rust reference: `RecallCache::clear` (`../src/cache.rs`).
 */
export function clearRecallCache(cache: RecallCache): void {
  cache.entries.clear()
}

/**
 * Clear structured recall cache entries after write-affecting operations.
 * @zh 在写入影响召回结果后清空 structured recall cache。
 *
 * Rust reference: `StructuredRecallCache::clear` (`../src/cache.rs`).
 */
export function clearStructuredRecallCache<TRecord>(cache: StructuredRecallCache<TRecord>): void {
  cache.entries.clear()
}

/**
 * Return formatted recall cache size.
 * @zh 返回 formatted recall cache 当前条目数。
 *
 * Rust reference: `RecallCache::len` (`../src/cache.rs`).
 */
export function recallCacheSize(cache: RecallCache): number {
  return cache.entries.size
}

/**
 * Return whether the formatted recall cache is empty.
 * @zh 判断 formatted recall cache 是否为空。
 *
 * Rust reference: `RecallCache::is_empty` (`../src/cache.rs`).
 */
export function isRecallCacheEmpty(cache: RecallCache): boolean {
  return cache.entries.size === 0
}

/**
 * Remove expired formatted recall cache entries.
 * @zh 移除已经超过 TTL 的 formatted recall cache 条目。
 *
 * Rust reference: `RecallCache::evict_expired` (`../src/cache.rs`).
 */
export function evictExpiredRecallCache(cache: RecallCache): void {
  evictExpired(cache.entries, cache.ttlSecs)
}

/**
 * Build the text recall cache key used before RecallCache normalization.
 * @zh 构造传入 RecallCache 归一化前的 text recall cache key。
 *
 * Rust reference: `RecallService::text_cache_key` (`../src/recall_service.rs`).
 */
export function textCacheKey(query: string, namespaces?: ReadonlyArray<string>): string {
  const nsList = [...(namespaces ?? [DEFAULT_NAMESPACE])].sort()
  const debugNs = `[${nsList.map((namespace) => `"${namespace}"`).join(", ")}]`
  return `${query}|ns=${debugNs}`
}

/**
 * Run the raw recall pipeline through the Rust-shaped RecallService boundary.
 * @zh 通过 RecallService 边界运行 raw recall pipeline。
 *
 * Rust reference: `RecallService::raw` (`../src/recall_service.rs`).
 */
export function raw(
  query: string,
  options?: Partial<RecallPipelineOptions>,
): ReturnType<typeof recallPipeline> {
  return recallPipeline(query, options)
}

/**
 * Run the trace-producing raw recall pipeline through RecallService.
 * @zh 通过 RecallService 边界运行带 trace 的 raw recall pipeline。
 *
 * Rust reference: `RecallService::raw_with_trace` (`../src/recall_service.rs`).
 */
export function rawWithTrace(
  query: string,
  options?: Partial<RecallPipelineOptions>,
): Effect.Effect<
  RecallTraceResult,
  | import("@aura/recall").SdrInterpreterError
  | import("@aura/contract").EmbeddingQueryError
  | import("@aura/contract").RerankError
  | import("@aura/contract").FinalizeError,
  RecallViewTag
> {
  return recallPipelineWithTrace(query, options)
}

/**
 * Apply shadow belief scoring without changing baseline ordering.
 * @zh 计算 shadow belief scoring 报告，不改变 baseline 排序。
 *
 * Rust reference: `RecallService::shadow_report` (`../src/recall_service.rs`).
 */
export function shadowReport(
  scored: RecallScored,
  beliefState: BeliefEngineState,
  topK: number,
): ShadowRecallReport {
  return computeShadowBeliefScores(scored, beliefState, topK)
}

/**
 * Apply the diagnostic limited belief rerank report pass.
 * @zh 执行 diagnostic limited belief rerank report pass。
 *
 * Rust reference: `RecallService::rerank_report` (`../src/recall_service.rs`).
 */
export function rerankReport(
  scored: Array<readonly [score: number, recordId: string]>,
  beliefState: BeliefEngineState,
  topK: number,
): LimitedRerankReport {
  return applyBeliefRerank(scored, beliefState, topK)
}

/**
 * Recall memories as a formatted preamble, backed by the text cache.
 * @zh 带 text cache 的 formatted recall；cache hit 时不执行 core pipeline。
 *
 * Rust reference: `RecallService::recall_formatted` (`../src/recall_service.rs`).
 */
export function recallFormatted<E, R>(
  cache: RecallCache,
  query: string,
  tokenBudget: number,
  namespaces: ReadonlyArray<string> | undefined,
  runCore: () => Effect.Effect<ReadonlyArray<RecallHit<AuraRecord>>, E, R>,
  formatPreamble: (scored: ReadonlyArray<RecallHit<AuraRecord>>) => string,
): Effect.Effect<string, E, R> {
  const cacheKey = textCacheKey(query, namespaces)
  const cached = recallCacheGet(cache, cacheKey)
  if (cached !== undefined) return Effect.succeed(cached)

  return Effect.gen(function* () {
    const scored = yield* runCore()
    void tokenBudget
    const preamble = formatPreamble(scored)
    recallCachePut(cache, cacheKey, preamble)
    return preamble
  })
}

/**
 * Recall structured scored records, backed by the structured recall cache.
 * @zh 带 structured cache 的 scored record recall；cache hit 时不执行 core pipeline。
 *
 * Rust reference: `RecallService::recall_structured_cached` (`../src/recall_service.rs`).
 */
export function recallStructuredCached<TRecord, E, R>(
  cache: StructuredRecallCache<TRecord>,
  query: string,
  topK: number,
  minStrength: number,
  namespaces: ReadonlyArray<string> | undefined,
  runCore: () => Effect.Effect<ReadonlyArray<RecallHit<TRecord>>, E, R>,
): Effect.Effect<ReadonlyArray<RecallHit<TRecord>>, E, R> {
  const cached = structuredCacheGet(cache, query, topK, minStrength, namespaces)
  if (cached !== undefined) return Effect.succeed(cached)

  return Effect.gen(function* () {
    const scored = yield* runCore()
    structuredCachePut(cache, query, topK, minStrength, namespaces, scored)
    return scored
  })
}

/**
 * Format scored records into a token-budgeted LLM context preamble.
 * @zh 将 scored records 格式化为受 token budget 限制的 LLM context preamble。
 *
 * Rust reference: `format_preamble` (`../src/recall.rs`).
 */
export function formatPreamble(
  scored: ReadonlyArray<RecallHit<AuraRecord>>,
  tokenBudget: number,
  records: ReadonlyMap<string, AuraRecord>,
): string {
  if (scored.length === 0) return ""

  const byLevel = new Map<Level, Array<RecallHit<AuraRecord>>>()
  for (const item of scored) {
    const level = item[1].level
    const items = byLevel.get(level) ?? []
    items.push(item)
    byLevel.set(level, items)
  }

  let output = "=== COGNITIVE CONTEXT ===\n"
  const identityBudget = Math.max(Math.trunc(tokenBudget * IDENTITY_BUDGET_RATIO), 128)
  const remainingBudget = Math.max(0, tokenBudget - identityBudget)
  const levelOrder = [Level.Identity, Level.Domain, Level.Decisions, Level.Working]

  for (const level of levelOrder) {
    const budget = level === Level.Identity ? identityBudget : Math.trunc(remainingBudget / 3)
    const items = byLevel.get(level)
    if (items === undefined) continue

    output += `[${Level.displayName(level)}]\n`
    let levelTokens = 0
    for (const [, record] of items) {
      const formatted = formatRecord(record, records)
      const estimatedTokens = estimateTokens(formatted)
      if (levelTokens + estimatedTokens > budget) break
      output += formatted
      output += "\n"
      levelTokens += estimatedTokens
    }
    output += "\n"
  }

  output += "=== END CONTEXT ==="
  return output
}

function recallCacheGet(cache: RecallCache, query: string): string | undefined {
  const key = normalizeRecallCacheKey(query)
  const entry = cache.entries.get(key)
  if (entry === undefined) return undefined
  if (isFresh(entry, cache.ttlSecs)) return entry.result
  cache.entries.delete(key)
  return undefined
}

function recallCachePut(cache: RecallCache, query: string, result: string): void {
  const key = normalizeRecallCacheKey(query)
  evictOldestIfFull(cache.entries, cache.maxEntries)
  cache.entries.set(key, { result, insertedAtMs: Date.now() })
}

function structuredCacheGet<TRecord>(
  cache: StructuredRecallCache<TRecord>,
  query: string,
  topK: number,
  minStrength: number,
  namespaces: ReadonlyArray<string> | undefined,
): ReadonlyArray<RecallHit<TRecord>> | undefined {
  const key = structuredCacheKey(query, topK, minStrength, namespaces)
  const entry = cache.entries.get(key)
  if (entry === undefined) return undefined
  if (isFresh(entry, cache.ttlSecs)) return entry.result
  cache.entries.delete(key)
  return undefined
}

function structuredCachePut<TRecord>(
  cache: StructuredRecallCache<TRecord>,
  query: string,
  topK: number,
  minStrength: number,
  namespaces: ReadonlyArray<string> | undefined,
  result: ReadonlyArray<RecallHit<TRecord>>,
): void {
  const key = structuredCacheKey(query, topK, minStrength, namespaces)
  evictOldestIfFull(cache.entries, cache.maxEntries)
  cache.entries.set(key, { result: Array.from(result), insertedAtMs: Date.now() })
}

function normalizeRecallCacheKey(query: string): string {
  return query.toLowerCase().trim()
}

function structuredCacheKey(
  query: string,
  topK: number,
  minStrength: number,
  namespaces: ReadonlyArray<string> | undefined,
): string {
  const normalized = query.toLowerCase().trim()
  const ns = namespaces === undefined ? DEFAULT_NAMESPACE : namespaces.join(",")
  return `${normalized}|${topK}|${minStrength.toFixed(2)}|${ns}`
}

function isFresh<T>(entry: CacheEntry<T>, ttlSecs: number): boolean {
  return Date.now() - entry.insertedAtMs < ttlSecs * 1000
}

function evictExpired<T>(entries: Map<string, CacheEntry<T>>, ttlSecs: number): void {
  const nowMs = Date.now()
  for (const [key, entry] of entries) {
    if (nowMs - entry.insertedAtMs >= ttlSecs * 1000) {
      entries.delete(key)
    }
  }
}

function evictOldestIfFull<T>(entries: Map<string, CacheEntry<T>>, maxEntries: number): void {
  if (entries.size < maxEntries) return
  let oldestKey: string | undefined
  let oldestMs = Number.POSITIVE_INFINITY
  for (const [key, entry] of entries) {
    if (entry.insertedAtMs < oldestMs) {
      oldestMs = entry.insertedAtMs
      oldestKey = key
    }
  }
  if (oldestKey !== undefined) entries.delete(oldestKey)
}

function formatRecord(record: AuraRecord, records: ReadonlyMap<string, AuraRecord>): string {
  const tags = record.tags.length === 0 ? "" : ` [${record.tags.join(", ")}]`
  const sourceLabel = sourceTypeLabel(record.source_type)
  const semanticLabel = semanticTypeLabel(record.semantic_type)
  let base: string

  switch (record.content_type) {
    case "code": {
      const language = record.metadata.language ?? ""
      base = `  - [CODE]${sourceLabel}${semanticLabel}${tags}\n\`\`\`${language}\n${record.content}\n\`\`\``
      break
    }
    case "json":
      base = `  - [JSON]${sourceLabel}${semanticLabel}${tags}\n\`\`\`json\n${record.content}\n\`\`\``
      break
    default:
      base = `  - ${record.content}${sourceLabel}${semanticLabel}${tags}`
      break
  }

  if (typeof record.caused_by_id === "string") {
    const parent = records.get(record.caused_by_id)
    if (parent !== undefined) {
      base += `\n    ^ because: ${Array.from(parent.content).slice(0, 120).join("")}`
    }
  }

  return base
}

function sourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case "retrieved":
      return " [retrieved]"
    case "inferred":
      return " [inferred]"
    case "generated":
      return " [generated]"
    default:
      return ""
  }
}

function semanticTypeLabel(semanticType: string): string {
  switch (semanticType) {
    case "decision":
      return " {decision}"
    case "preference":
      return " {preference}"
    case "trend":
      return " {trend}"
    case "serendipity":
      return " {serendipity}"
    case "contradiction":
      return " {contradiction}"
    default:
      return ""
  }
}

function estimateTokens(text: string): number {
  return Math.trunc(text.split(/\s+/).filter((word) => word.length > 0).length * TOKENS_PER_WORD)
}
