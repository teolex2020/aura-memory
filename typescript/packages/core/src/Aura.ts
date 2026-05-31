import { Effect, Ref } from "effect";
import {
  FileFormatError,
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  EmbeddingQueryError,
  FinalizeError,
  JsonParseError,
  Level,
  RecordNotFoundError,
  RecordValidationError,
  RerankError,
  type RecallScored,
  type Record as AuraRecord,
  type SalienceSummary,
  type StoreOptions,
  type TrustConfig,
  type UpdateOptions,
  Clock,
  EpistemicRuntime,
  UnsupportedSurfaceError,
  applyCrossNamespaceDimensionFlags,
  DEFAULT_NAMESPACE,
  DEFAULT_SOURCE_TYPE,
  DEFAULT_SEMANTIC_TYPE,
  defaultCrossNamespaceDigestOptions,
  defaultConfidenceForSource,
  finalizeStartupValidationReport,
  startupValidationEvent,
  validateRecordNamespace,
  validateRecordSourceType,
  validateRecordStoreInput,
  type StartupValidationEvent,
  type StartupValidationReport,
} from "@aura/contract";
import {
  BeliefStoreFile,
  BrainAuraFile,
  CognitiveStoreFile,
  loadCognitiveRecords,
  loadPersistenceManifestWithStartupValidation,
  MaintenanceTrendsFile,
  normalizeCognitiveRecord,
  ReflectionSummariesFile,
  readBrainAuraFile,
  type BrainAuraRecord,
  type PersistenceManifest,
} from "@aura/storage";
import type { IndexFormatError } from "@aura/indexing";
import {
  applyBeliefRerank,
  computeShadowBeliefScores,
  defaultTrustConfig,
  type RecallPipelineOptions,
  type RecallRecordEvidence,
  type SdrInterpreterError,
} from "@aura/recall";
import {
  finalizeRecallScored as finalizeRecallScoredEffect,
  recallRawScored as recallRawScoredEffect,
  recallRecords as recallRecordsEffect,
  recallScored as recallScoredEffect,
  recallTemporalRecords as recallTemporalRecordsEffect,
  recallWithTrace as recallWithTraceEffect,
} from "./Recall";
import { createRecallSessionTracker, endRecallSession, type RecallSessionTracker } from "./RecallFinalizer"
import { id12, nowSecs } from "@aura/utils";

const DEFAULT_CONFIDENCE = defaultConfidenceForSource(DEFAULT_SOURCE_TYPE)
const RECORD_SALIENCE_REASON_KEY = "salience_reason"
const RECORD_SALIENCE_MARKED_AT_KEY = "salience_marked_at"
const MAX_AUTO_CONNECTIONS = 50
const startupJsonDecoder = new TextDecoder()

function numberOr(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function rustModeLabel(mode: string | undefined, fallback: string): string {
  return (mode ?? fallback).toLowerCase()
}

function defaultBoundedRerankModes(): BoundedRerankModes {
  return {
    beliefMode: BeliefRerankMode.Limited,
    conceptMode: Csm.Inspect,
    causalMode: CausalRerankMode.Limited,
    policyMode: PolicyRerankMode.Limited,
  }
}

function cloneTrustConfig(config: TrustConfig): TrustConfig {
  return {
    source_trust: { ...config.source_trust },
    source_authority: { ...config.source_authority },
    recency_boost_max: config.recency_boost_max,
    recency_half_life_days: config.recency_half_life_days,
  }
}

function parseBeliefRerankMode(mode: BeliefRerankMode | string): BeliefRerankMode {
  switch (String(mode).toLowerCase()) {
    case "limited":
      return BeliefRerankMode.Limited
    case "shadow":
      return BeliefRerankMode.Shadow
    default:
      return BeliefRerankMode.Off
  }
}

function parseConceptSurfaceMode(mode: ConceptSurfaceMode | string): ConceptSurfaceMode {
  switch (String(mode).toLowerCase()) {
    case "limited":
      return Csm.Limited
    case "inspect":
      return Csm.Inspect
    default:
      return Csm.Off
  }
}

function parseCausalRerankMode(mode: CausalRerankMode | string): CausalRerankMode {
  return String(mode).toLowerCase() === "limited" ? CausalRerankMode.Limited : CausalRerankMode.Off
}

function parsePolicyRerankMode(mode: PolicyRerankMode | string): PolicyRerankMode {
  return String(mode).toLowerCase() === "limited" ? PolicyRerankMode.Limited : PolicyRerankMode.Off
}

function parseTemporalBudgetMode(mode: TemporalBudgetMode | string): TemporalBudgetMode {
  switch (String(mode).toLowerCase()) {
    case "exhaustive_capped":
    case "exhaustivecapped":
      return TemporalBudgetMode.ExhaustiveCapped
    default:
      return TemporalBudgetMode.NearbySuccessors
  }
}

function parseEvidenceMode(mode: EvidenceMode | string): EvidenceMode {
  switch (String(mode).toLowerCase()) {
    case "explicit_trusted":
    case "explicittrusted":
      return EvidenceMode.ExplicitTrusted
    case "temporal_cluster_recovery":
    case "temporalclusterrecovery":
      return EvidenceMode.TemporalClusterRecovery
    default:
      return EvidenceMode.StrictRepeatedWindows
  }
}

function rustOptionalTopK(value: number | undefined): number {
  if (value === undefined) return 20
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 20))
}

function rustOptionalMinStrength(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0.1
}

function recallReportOptions(
  topK?: number,
  minStrength?: number,
  expandConnections?: boolean,
  sessionId?: string,
  namespaces?: ReadonlyArray<string>
): Partial<RecallPipelineOptions> {
  return {
    topK: rustOptionalTopK(topK),
    minStrength: rustOptionalMinStrength(minStrength),
    expandConnections: expandConnections ?? true,
    namespaces: namespaces ?? [DEFAULT_NAMESPACE],
    ...(sessionId === undefined ? {} : { sessionId }),
  }
}

type AuraRecallHit = readonly [score: number, record: AuraRecord]
type MemoryTierKind = "cognitive" | "core"

function recallHitsFromScored(
  scored: RecallScored,
  records: ReadonlyMap<string, AuraRecord>
): AuraRecallHit[] {
  const out: AuraRecallHit[] = []
  for (const [score, recordId] of scored) {
    const record = records.get(recordId)
    if (record !== undefined) out.push([score, record])
  }
  return out
}

function migrateLegacyConfidence(record: AuraRecord): AuraRecord | undefined {
  const expected = defaultConfidenceForSource(record.source_type)
  if (Math.abs(record.confidence - DEFAULT_CONFIDENCE) < 0.001 && Math.abs(expected - DEFAULT_CONFIDENCE) > 0.001) {
    return { ...record, confidence: expected }
  }
  return undefined
}

type StartupJsonSurfaceOptions<T> = {
  readonly path: string
  readonly surface: string
  readonly empty: () => T
  readonly missingDetail: string
  readonly emptyDetail: string
  readonly loadedDetail: (value: T) => string
  readonly missingRecovered: boolean
  readonly isValid?: (value: unknown) => boolean
}

function formatStartupCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function recordObjectCount(value: unknown, field: string): number {
  if (typeof value !== "object" || value === null) return 0
  const raw = (value as Record<string, unknown>)[field]
  return typeof raw === "object" && raw !== null ? Object.keys(raw as Record<string, unknown>).length : 0
}

function hasObjectField(value: unknown, field: string): boolean {
  if (typeof value !== "object" || value === null) return false
  const raw = (value as Record<string, unknown>)[field]
  return typeof raw === "object" && raw !== null
}

function loadJsonSurfaceWithStartupValidation<T>(
  options: StartupJsonSurfaceOptions<T>,
): Effect.Effect<{ readonly value: T; readonly event: StartupValidationEvent }, never, FileRead> {
  return Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)
    let existsError: unknown = null
    const exists = yield* fr.exists(options.path).pipe(
      Effect.catchTag("FileReadError", (cause) => {
        existsError = cause
        return Effect.succeed(false)
      }),
    )

    if (existsError !== null) {
      return {
        value: options.empty(),
        event: startupValidationEvent(
          options.surface,
          options.path,
          "load_error_fallback",
          formatStartupCause(existsError),
          true,
        ),
      }
    }

    if (!exists) {
      return {
        value: options.empty(),
        event: startupValidationEvent(
          options.surface,
          options.path,
          "missing_fallback",
          options.missingDetail,
          options.missingRecovered,
        ),
      }
    }

    let readError: unknown = null
    const bytes = yield* fr.readFile(options.path).pipe(
      Effect.catchTag("FileReadError", (cause) => {
        readError = cause
        return Effect.succeed(new Uint8Array())
      }),
    )
    if (readError !== null) {
      return {
        value: options.empty(),
        event: startupValidationEvent(
          options.surface,
          options.path,
          "load_error_fallback",
          formatStartupCause(readError),
          true,
        ),
      }
    }

    const raw = startupJsonDecoder.decode(bytes).trim()
    if (raw.length === 0) {
      return {
        value: options.empty(),
        event: startupValidationEvent(
          options.surface,
          options.path,
          "empty_fallback",
          options.emptyDetail,
          options.missingRecovered,
        ),
      }
    }

    try {
      const parsed = JSON.parse(raw) as unknown
      if (options.isValid !== undefined && !options.isValid(parsed)) {
        return {
          value: options.empty(),
          event: startupValidationEvent(
            options.surface,
            options.path,
            "load_error_fallback",
            "invalid startup surface shape",
            true,
          ),
        }
      }
      const value = parsed as T
      return {
        value,
        event: startupValidationEvent(
          options.surface,
          options.path,
          "loaded",
          options.loadedDetail(value),
          false,
        ),
      }
    } catch (cause) {
      return {
        value: options.empty(),
        event: startupValidationEvent(
          options.surface,
          options.path,
          "load_error_fallback",
          formatStartupCause(cause),
          true,
        ),
      }
    }
  })
}

// ── MaintenanceService function imports ──
import {
  runInitialPhases,
  buildSdrLookup,
  computeLayerStability,
  runDiscoveryPhases,
  runPostDiscoveryPhases,
  finalizeTelemetry,
  buildTrendSnapshot,
  pushTrendSnapshot,
  summarizeTrends,
  summarizeReflections,
  buildReflectionSummary,
  pushReflectionSummary,
  createCognitiveStoreAdapter,
  createDefaultTagTaxonomy,
  createNGramIndex,
  DefaultBackgroundBrain,
  makeMaintenanceSdrInterpreter,
} from "./MaintenanceService"

// ── Contract types for MaintenanceService ──
import {
  BeliefRerankMode,
  BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine,
  BeliefStore, ConceptStore, CausalStore, PolicyStore,
  CausalRerankMode,
  EpistemicTrace,
  EvidenceMode,
  PolicyRerankMode,
  TemporalBudgetMode,
  type BoundedRerankModes,
  type LimitedRerankReport,
  type MaintenanceReport, type MaintenanceConfig,
  defaultMaintenanceConfig,
  type PhaseTimings, type MaintenanceHotspots,
  type MaintenanceTrendSnapshot, type ReflectionSummary,
  type ReflectionFinding,
  type ConceptSurfaceCounters, type ConceptSurfaceMode,
  ConceptSurfaceMode as Csm,
  type ContradictionCluster,
  type McpMaintenanceTrendSnapshot,
  type McpReflectionSummary,
  type Belief,
  type BeliefInstabilitySummary,
  type PolicyLifecycleSummary,
  type PolicyPressureArea,
  type PolicyHint,
  type ConceptCandidate,
  type CausalPattern,
  type CrossNamespaceBeliefStateSummary,
  type CrossNamespaceDigest,
  type CrossNamespaceDigestOptions,
  type MaintenanceTrendSummary,
  type McpBeliefInstabilitySummary,
  type McpPolicyLifecycleSummary,
  type McpPolicyPressureArea,
  type MemoryHealthDigest,
  type NamespaceGovernanceStatus,
  type OperatorReviewIssue,
  type CorrectionLogEntry,
  type CorrectionReviewCandidate,
  type ContradictionReviewCandidate,
  type ExplainabilityBundle,
  type McpMaintenanceTrendSummary,
  type McpReflectionDigest,
  type McpReflectionFinding,
  type ProvenanceChain,
  type RecallBeliefExplanation,
  type RecallCausalExplanation,
  type RecallConceptExplanation,
  type RecallExplanation,
  type RecallExplanationItem,
  type RecallPolicyExplanation,
  type RecallSignalScore,
  type RecallTraceScore,
  type ShadowRecallReport,
  type SuggestedCorrection,
  type SuggestedCorrectionsReport,
  type SurfacedConcept,
  type SurfacedPolicyHint,
} from "@aura/contract"

export type StoreCodeOptions = {
  readonly language: string
  readonly code: string
  readonly filename?: string
  readonly tags?: ReadonlyArray<string>
  readonly namespace?: string
}

export type StoreDecisionOptions = {
  readonly decision: string
  readonly reasoning?: string
  readonly alternatives?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
  readonly caused_by_id?: string
  readonly namespace?: string
}

export type AuraSearchOptions = {
  readonly query?: string
  readonly level?: Level
  readonly tags?: ReadonlyArray<string>
  readonly limit?: number
  readonly content_type?: string
  readonly source_type?: string
  readonly namespaces?: ReadonlyArray<string>
  readonly namespace?: string
  readonly semantic_type?: string
}

export type AuraCrossNamespaceDigestOptions = Partial<CrossNamespaceDigestOptions> & {
  readonly include_dimensions?: ReadonlyArray<string> | null
}

export type AuraStats = Readonly<Record<string, number>>

export class Aura {
  private constructor(
    private readonly brainDir: string,
    private readonly records: BrainAuraRecord[],
    private searchRecords: Map<string, AuraRecord> = new Map(),
    private readonly persistenceManifest: PersistenceManifest,
    private readonly startupValidationReport: StartupValidationReport,
    private readonly maintenanceTrendHistory: MaintenanceTrendSnapshot[] = [],
    private readonly reflectionSummaries: ReflectionSummary[] = [],
    private readonly correctionLog: CorrectionLogEntry[] = [],
    private boundedRerankModes: BoundedRerankModes = defaultBoundedRerankModes(),
    private causalTemporalBudgetMode: TemporalBudgetMode = TemporalBudgetMode.NearbySuccessors,
    private causalEvidenceMode: EvidenceMode = EvidenceMode.StrictRepeatedWindows,
    private maintenanceConfig: MaintenanceConfig = defaultMaintenanceConfig,
    private trustConfig: TrustConfig = defaultTrustConfig(),
    private readonly sessionTracker: RecallSessionTracker = createRecallSessionTracker(),
  ) {}

  /**
   * Create a new Aura instance at the given path.
   * 在给定路径创建 Aura 实例。
   *
   * Rust reference: `Aura::open` (`../src/aura.rs`).
   */
  static open(
    brainPath: string,
  ): Effect.Effect<
    Aura,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    const brainAuraPath = `${brainPath}/brain.aura`;
    return Effect.gen(function* () {
      const fs = yield* Effect.service(FileRead);
      const startupEvents: StartupValidationEvent[] = []
      const buf = yield* fs.readFile(brainAuraPath);
      const parsed = yield* Effect.try({
        try: () => readBrainAuraFile(buf),
        catch: (cause) =>
          new FileFormatError({
            path: brainAuraPath,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      const cognitiveRecords = yield* loadCognitiveRecords(brainPath)
      startupEvents.push(startupValidationEvent(
        "records",
        brainPath,
        "loaded",
        `loaded ${cognitiveRecords.size} records`,
        false,
      ))
      const beliefValidation = yield* loadJsonSurfaceWithStartupValidation({
        path: `${brainPath}/beliefs.cog`,
        surface: "belief",
        empty: () => ({}),
        missingDetail: "belief store missing; started with empty belief engine",
        emptyDetail: "belief store file was empty; started with empty belief engine",
        loadedDetail: (value) => `loaded ${recordObjectCount(value, "beliefs")} beliefs`,
        missingRecovered: true,
        isValid: (value) => hasObjectField(value, "beliefs"),
      })
      startupEvents.push(beliefValidation.event)
      const conceptValidation = yield* loadJsonSurfaceWithStartupValidation({
        path: `${brainPath}/concepts.cog`,
        surface: "concept",
        empty: () => ({}),
        missingDetail: "concept store missing; started with empty concept engine",
        emptyDetail: "concept store file was empty; started with empty concept engine",
        loadedDetail: (value) => `loaded ${recordObjectCount(value, "concepts")} concepts`,
        missingRecovered: false,
        isValid: (value) => hasObjectField(value, "concepts"),
      })
      startupEvents.push(conceptValidation.event)
      const causalValidation = yield* loadJsonSurfaceWithStartupValidation({
        path: `${brainPath}/causal.cog`,
        surface: "causal",
        empty: () => ({}),
        missingDetail: "causal store missing; started with empty causal engine",
        emptyDetail: "causal store file was empty; started with empty causal engine",
        loadedDetail: (value) => `loaded ${recordObjectCount(value, "patterns")} causal patterns`,
        missingRecovered: true,
        isValid: (value) => hasObjectField(value, "patterns"),
      })
      startupEvents.push(causalValidation.event)
      const policyValidation = yield* loadJsonSurfaceWithStartupValidation({
        path: `${brainPath}/policies.cog`,
        surface: "policy",
        empty: () => ({}),
        missingDetail: "policy store missing; started with empty policy engine",
        emptyDetail: "policy store file was empty; started with empty policy engine",
        loadedDetail: (value) => `loaded ${recordObjectCount(value, "hints")} policy hints`,
        missingRecovered: true,
        isValid: (value) => hasObjectField(value, "hints"),
      })
      startupEvents.push(policyValidation.event)
      const manifestValidation = yield* loadPersistenceManifestWithStartupValidation(brainPath)
      startupEvents.push(...manifestValidation.events)
      const trendValidation = yield* loadJsonSurfaceWithStartupValidation({
        path: `${brainPath}/maintenance_trends.json`,
        surface: "maintenance_trends",
        empty: MaintenanceTrendsFile.empty,
        missingDetail: "maintenance trend history missing; started with empty trend history",
        emptyDetail: "maintenance trend history file was empty",
        loadedDetail: (history) => `loaded ${history.length} maintenance trend snapshots`,
        missingRecovered: true,
        isValid: Array.isArray,
      })
      startupEvents.push(trendValidation.event)
      const reflectionValidation = yield* loadJsonSurfaceWithStartupValidation({
        path: `${brainPath}/reflection_summaries.json`,
        surface: "reflection_summaries",
        empty: ReflectionSummariesFile.empty,
        missingDetail: "reflection summary history missing; started with empty reflection history",
        emptyDetail: "reflection summary history file was empty",
        loadedDetail: (history) => `loaded ${history.length} reflection summaries`,
        missingRecovered: true,
        isValid: Array.isArray,
      })
      startupEvents.push(reflectionValidation.event)
      const trends = trendValidation.value.map(fromMcpMaintenanceTrendSnapshot)
      const reflections = reflectionValidation.value.map(fromMcpReflectionSummary)
      const migratedRecords: AuraRecord[] = []
      for (const [id, record] of cognitiveRecords) {
        const migrated = migrateLegacyConfidence(record)
        if (migrated !== undefined) {
          cognitiveRecords.set(id, migrated)
          migratedRecords.push(migrated)
        }
      }
      if (migratedRecords.length > 0) {
        const store = yield* CognitiveStoreFile.open(brainPath)
        for (const record of migratedRecords) {
          yield* store.appendUpdate(record)
        }
        yield* store.flush()
      }
      const startupValidationReport = finalizeStartupValidationReport(startupEvents)
      return new Aura(
        brainPath,
        parsed.records,
        cognitiveRecords,
        manifestValidation.manifest,
        startupValidationReport,
        trends,
        reflections,
      );
    });
  }

  /**
   * Create a new Aura instance with optional encryption.
   * 创建 Aura 实例（可选加密）。
   *
   * NON-PARITY IMPLEMENTATION: password/encryption is not wired yet.
   * 差异说明：TS core 目前只使用 FileRead/FileWrite 抽象，尚未接入 Rust AuraStorage 的加密管线。
   * Rust reference: `Aura::open_with_password` (`../src/aura.rs`).
   */
  static open_with_password(
    brainPath: string,
    password?: string,
  ): Effect.Effect<
    Aura,
    FileReadError | FileWriteError | FileFormatError | UnsupportedSurfaceError,
    FileRead | FileWrite
  > {
    if (password !== undefined) {
      return Effect.fail(new UnsupportedSurfaceError({
        surface: "Aura.open_with_password",
        reason: "TS core has no Rust-parity encrypted AuraStorage path yet; silently ignoring passwords is forbidden.",
        rustReference: "Aura::open_with_password (aura.rs)",
        missingPrerequisites: ["Rust-compatible encrypted AuraStorage read/write path"],
      }))
    }
    return Aura.open(brainPath);
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice();
  }

  listCognitiveRecords(): AuraRecord[] {
    return [...this.searchRecords.values()].map(cloneAuraRecord)
  }

  /**
   * Get a single record by ID.
   * 按 ID 获取单条 record。
   *
   * Rust reference: `Aura::get` and `py_get` (`../src/aura.rs`).
   */
  get(recordId: string): AuraRecord | null {
    const record = this.searchRecords.get(recordId)
    return record === undefined ? null : cloneAuraRecord(record)
  }

  /**
   * Return records with elevated salience, highest salience first.
   * 返回高 salience records，按 salience 降序排列。
   *
   * Rust reference: `Aura::get_high_salience_records` and `py_get_high_salience_records` (`../src/aura.rs`).
   */
  get_high_salience_records(min_salience?: number, limit?: number): ReadonlyArray<AuraRecord> {
    const threshold = clamp01(min_salience ?? 0.50)
    const max = clampInt(limit ?? 20, 0, 100)
    return highSalienceRecords([...this.searchRecords.values()], threshold, max)
      .map(cloneAuraRecord)
  }

  /**
   * Return a bounded summary of current record salience distribution.
   * 返回当前 record salience 分布摘要。
   *
   * Rust reference: `Aura::get_salience_summary` and `py_get_salience_summary` (`../src/aura.rs`).
   */
  get_salience_summary(): SalienceSummary {
    const records = [...this.searchRecords.values()]
    const total = records.length
    if (total === 0) {
      return {
        total_records: 0,
        high_salience_count: 0,
        avg_salience: 0,
        max_salience: 0,
        bands: { low: 0, medium: 0, high: 0 },
      }
    }

    let highSalienceCount = 0
    let avgSalience = 0
    let maxSalience = 0
    const bands = { low: 0, medium: 0, high: 0 }
    for (const record of records) {
      const salience = record.salience
      avgSalience += salience
      maxSalience = Math.max(maxSalience, salience)
      if (salience >= 0.70) {
        highSalienceCount++
        bands.high++
      } else if (salience >= 0.30) {
        bands.medium++
      } else {
        bands.low++
      }
    }
    return {
      total_records: total,
      high_salience_count: highSalienceCount,
      avg_salience: avgSalience / total,
      max_salience: maxSalience,
      bands,
    }
  }

  /**
   * Mark a record with bounded manual salience and optional reason metadata.
   * 标记一条 record 的人工 salience，并可写入 reason 元数据。
   *
   * Rust reference: `Aura::mark_record_salience` and `py_mark_record_salience` (`../src/aura.rs`).
   */
  mark_record_salience(
    record_id: string,
    salience: number,
    reason?: string | null,
  ): Effect.Effect<
    AuraRecord | null,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const clock = yield* Clock
      const records = yield* loadCognitiveRecords(dir)
      const existing = records.get(record_id)
      if (existing === undefined) return null

      const metadata = { ...existing.metadata }
      const trimmedReason = reason?.trim()
      if (trimmedReason !== undefined && trimmedReason.length > 0) {
        metadata[RECORD_SALIENCE_REASON_KEY] = trimmedReason
      } else {
        delete metadata[RECORD_SALIENCE_REASON_KEY]
      }
      metadata[RECORD_SALIENCE_MARKED_AT_KEY] = clock.nowSeconds().toFixed(3)

      const updated: AuraRecord = {
        ...existing,
        salience: clamp01(salience),
        metadata,
      }

      const store = yield* CognitiveStoreFile.open(dir)
      yield* store.appendUpdate(updated)
      yield* store.flush()
      // NON-PARITY IMPLEMENTATION: Rust calls `runtime.clear_recall_caches()` after append_update.
      // 非对齐点：TS core 暂无 recall cache surface；当前仅替换 in-memory read model。
      // Rust reference: `Aura::mark_record_salience` (`../src/aura.rs`).
      self.replaceSearchRecord(updated)
      return cloneAuraRecord(updated)
    })
  }

  /**
   * Count records, optionally filtered by level.
   * 统计 record 数量，可按 level 过滤。
   *
   * Rust reference: `Aura::count` and `py_count` (`../src/aura.rs`).
   */
  count(level?: Level): number {
    if (level === undefined) return this.searchRecords.size
    let total = 0
    for (const record of this.searchRecords.values()) {
      if (record.level === level) total++
    }
    return total
  }

  // -- Two-Tier API (Cognitive / Core) --

  /**
   * Get memory statistics broken down by tier.
   * 按 cognitive/core tier 返回 memory 统计。
   *
   * Rust reference: `Aura::tier_stats` and `py_tier_stats` (`../src/aura.rs`).
   */
  tier_stats(): Readonly<Record<string, number>> {
    let working = 0
    let decisions = 0
    let domain = 0
    let identity = 0
    for (const record of this.searchRecords.values()) {
      if (record.level === Level.Working) working++
      if (record.level === Level.Decisions) decisions++
      if (record.level === Level.Domain) domain++
      if (record.level === Level.Identity) identity++
    }
    return {
      cognitive_total: working + decisions,
      cognitive_working: working,
      cognitive_decisions: decisions,
      core_total: domain + identity,
      core_domain: domain,
      core_identity: identity,
      total: working + decisions + domain + identity,
    }
  }

  /**
   * Find cognitive records that are candidates for promotion to core.
   * 查找可从 cognitive tier 晋升到 core 的 records。
   *
   * Rust reference: `Aura::promotion_candidates` and `py_promotion_candidates` (`../src/aura.rs`).
   */
  promotion_candidates(min_activations?: number, min_strength?: number): ReadonlyArray<AuraRecord> {
    const minAct = min_activations ?? 5
    const minStr = min_strength ?? 0.7
    return [...this.searchRecords.values()]
      .filter((record) =>
        isCognitiveLevel(record.level) &&
        record.activation_count >= minAct &&
        record.strength >= minStr
      )
      .sort((a, b) => {
        const activationDelta = b.activation_count - a.activation_count
        if (activationDelta !== 0) return activationDelta
        return b.strength - a.strength
      })
      .map(cloneAuraRecord)
  }

  /**
   * Promote a record to the next cognitive level.
   * 将 record 晋升到下一个 memory level。
   *
   * WORKING -> DECISIONS -> DOMAIN -> IDENTITY.
   * Returns the new level, or null if already IDENTITY or record not found.
   * 返回新 level；如果已是 IDENTITY 或 record 不存在则返回 null。
   *
   * Rust reference: `Aura::promote_record` and `py_promote_record` (`../src/aura.rs`).
   */
  promote_record(record_id: string): Effect.Effect<
    Level | null,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const records = yield* loadCognitiveRecords(dir)
      const existing = records.get(record_id)
      if (existing === undefined) return null

      const nextLevel = promoteLevel(existing.level)
      if (nextLevel === null) return null

      const updated: AuraRecord = {
        ...existing,
        level: nextLevel,
      }
      const store = yield* CognitiveStoreFile.open(dir)
      yield* store.appendUpdate(updated)
      yield* store.flush()
      // NON-PARITY IMPLEMENTATION: Rust clears recall caches after promotion.
      // 非对齐点：TS core 暂无 recall cache surface；当前仅替换 in-memory read model。
      // Rust reference: `Aura::promote_record` (`../src/aura.rs`).
      self.replaceSearchRecord(updated)
      return nextLevel
    })
  }

  /**
   * Recall from the cognitive tier only (WORKING + DECISIONS).
   * 仅从 cognitive tier（WORKING + DECISIONS）召回 records。
   *
   * When `query` is provided, runs the full RRF Fusion pipeline (SDR + MinHash +
   * Tag Jaccard + optional embeddings) and then filters results to cognitive-tier
   * records. This gives the same ranking quality as `recall_structured()`.
   * 当提供 `query` 时，先运行完整 RRF Fusion pipeline（SDR + MinHash +
   * Tag Jaccard + 可选 embeddings），再过滤到 cognitive-tier records；
   * 这与 `recall_structured()` 具备相同 ranking quality。
   *
   * When `query` is None, returns all cognitive records sorted by importance.
   * 当 `query` 为 None/null/undefined 时，返回按 importance 排序的全部 cognitive records。
   *
   * Rust reference: `Aura::recall_cognitive` and `py_recall_cognitive` (`../src/aura.rs`).
   */
  recall_cognitive(query?: string | null, limit?: number, namespaces?: ReadonlyArray<string>) {
    return this.recallTierRecords("cognitive", query, limit, namespaces)
  }

  /**
   * Recall from the core tier only (DOMAIN + IDENTITY).
   * 仅从 core tier（DOMAIN + IDENTITY）召回 records。
   *
   * When `query` is provided, runs the full RRF Fusion pipeline (SDR + MinHash +
   * Tag Jaccard + optional embeddings) and then filters results to core-tier
   * records. This gives the same ranking quality as `recall_structured()`.
   * 当提供 `query` 时，先运行完整 RRF Fusion pipeline（SDR + MinHash +
   * Tag Jaccard + 可选 embeddings），再过滤到 core-tier records；
   * 这与 `recall_structured()` 具备相同 ranking quality。
   *
   * When `query` is None, returns all core records sorted by importance.
   * 当 `query` 为 None/null/undefined 时，返回按 importance 排序的全部 core records。
   *
   * Rust reference: `Aura::recall_core_tier` and `py_recall_core_tier` (`../src/aura.rs`).
   */
  recall_core_tier(query?: string | null, limit?: number, namespaces?: ReadonlyArray<string>) {
    return this.recallTierRecords("core", query, limit, namespaces)
  }

  /**
   * List all distinct namespaces present in the brain.
   * 列出当前 brain 中出现过的 namespace；始终包含 Rust 默认 namespace。
   *
   * Rust reference: `Aura::list_namespaces` and `py_list_namespaces` (`../src/aura.rs`).
   */
  list_namespaces(): ReadonlyArray<string> {
    const namespaces = new Set<string>([DEFAULT_NAMESPACE])
    for (const record of this.searchRecords.values()) {
      namespaces.add(record.namespace)
    }
    return [...namespaces].sort()
  }

  /**
   * Move a record to a different namespace.
   *
   * Prunes connections that would become cross-namespace after the move.
   * 将 record 移动到另一个 namespace，并剪掉移动后会跨 namespace 的连接。
   *
   * Rust reference: `Aura::move_record` and `py_move_record` (`../src/aura.rs`).
   */
  move_record(
    record_id: string,
    new_namespace: string,
  ): Effect.Effect<AuraRecord | null, FileReadError | FileWriteError, FileRead | FileWrite> {
    const validationError = validateRecordNamespace(new_namespace)
    if (validationError !== undefined) {
      return Effect.succeed(null)
    }

    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const records = new Map(self.searchRecords)

      // 1. Collect outgoing connection keys and old namespace (immutable access)
      // 1. 收集 outgoing connection keys 和旧 namespace（只读访问）。
      const existing = records.get(record_id)
      if (existing === undefined) return null
      const oldNamespace = existing.namespace
      const outgoingKeys = Object.keys(existing.connections)

      // 2. Move the record
      // 2. 移动 record。
      const movedConnections: { [recordId: string]: number } = { ...existing.connections }

      // 3. Determine which outgoing connections are now cross-namespace
      // 3. 找出移动后变成跨 namespace 的 outgoing connections。
      const crossNamespaceIds: string[] = []
      for (const connectionId of outgoingKeys) {
        const peer = records.get(connectionId)
        if (peer !== undefined && peer.namespace !== new_namespace) {
          crossNamespaceIds.push(connectionId)
        }
      }

      // 4. Prune cross-namespace outgoing connections
      //    (re-borrow after immutable filter above)
      // 4. 剪掉跨 namespace 的 outgoing connections（对应 Rust 的重新借用）。
      for (const connectionId of crossNamespaceIds) {
        delete movedConnections[connectionId]
      }

      const moved: AuraRecord = {
        ...existing,
        namespace: new_namespace,
        connections: movedConnections,
      }

      // 5. Prune incoming connections from old-namespace records pointing to this one
      // 5. 剪掉旧 namespace records 中指向当前 record 的 incoming connections。
      records.set(record_id, moved)
      for (const [peerId, peer] of records) {
        if (peerId === record_id) continue
        if (peer.namespace !== oldNamespace) continue
        if (peer.connections[record_id] === undefined) continue
        const peerConnections: { [recordId: string]: number } = { ...peer.connections }
        delete peerConnections[record_id]
        records.set(peerId, {
          ...peer,
          connections: peerConnections,
        })
      }

      const store = yield* CognitiveStoreFile.open(dir)
      yield* store.appendUpdate(moved)
      yield* store.flush()
      // NON-PARITY IMPLEMENTATION: Rust clears recall caches after namespace moves.
      // 非对齐点：TS core 暂无 recall cache surface；当前仅替换 in-memory read model。
      // Rust reference: `Aura::move_record` (`../src/aura.rs`).
      self.searchRecords = records
      return cloneAuraRecord(moved)
    })
  }

  /**
   * Get record counts per namespace.
   * 获取每个 namespace 的 record 数量。
   *
   * Rust reference: `Aura::namespace_stats` and `py_namespace_stats` (`../src/aura.rs`).
   */
  namespace_stats(): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const record of this.searchRecords.values()) {
      counts[record.namespace] = (counts[record.namespace] ?? 0) + 1
    }
    return counts
  }

  /**
   * Return the access/strength timeline for a single record.
   * 返回单条 record 的访问/强度时间线快照。
   *
   * Rust reference: `Aura::history` and `py_history` (`../src/aura.rs`).
   */
  history(recordId: string): Effect.Effect<Readonly<Record<string, string>>, RecordNotFoundError> {
    const record = this.searchRecords.get(recordId)
    if (record === undefined) {
      return Effect.fail(new RecordNotFoundError({
        recordId,
        rustReference: "Aura::history (../src/aura.rs)",
      }))
    }
    const now = nowSecs()
    const out: Record<string, string> = {
      id: record.id,
      content: record.content,
      level: levelDisplayName(record.level),
      strength: record.strength.toFixed(4),
      activation_count: String(record.activation_count),
      created_at: record.created_at.toFixed(3),
      last_activated: record.last_activated.toFixed(3),
      age_days: ((now - record.created_at) / 86400).toFixed(2),
      days_since_activation: ((now - record.last_activated) / 86400).toFixed(2),
      namespace: record.namespace,
      source_type: record.source_type,
      tags: record.tags.join(", "),
      salience: record.salience.toFixed(4),
      connections: String(Object.keys(record.connections).length),
    }
    const salienceReason = record.metadata[RECORD_SALIENCE_REASON_KEY]
    if (salienceReason !== undefined) {
      out.salience_reason = salienceReason
    }
    return Effect.succeed(out)
  }

  store(
    content: string,
    options?: StoreOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError | RecordValidationError,
    FileRead | FileWrite
  > {
    return this.store_with_channel(content, options);
  }

  /**
   * Store a code snippet at DOMAIN level.
   * 将代码片段以 DOMAIN level 存储；language/filename 通过 tags 与 fenced content 暴露。
   * Rust reference: `AuraMcpServer::store_code` (`../src/mcp.rs`).
   */
  store_code(
    options: StoreCodeOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError | RecordValidationError,
    FileRead | FileWrite
  > {
    const tags = [...(options.tags ?? []), "code", options.language]
    if (options.filename !== undefined && options.filename.length > 0) {
      tags.push(`file:${options.filename}`)
    }
    const content = "```" + options.language + "\n" + options.code + "\n```"
    return this.store(content, {
      level: Level.Domain,
      tags,
      content_type: "code",
      namespace: options.namespace,
    })
  }

  /**
   * Store a decision with reasoning and rejected alternatives.
   * 存储决策、理由与被拒绝的备选方案。
   * Rust reference: `AuraMcpServer::store_decision` (`../src/mcp.rs`).
   */
  store_decision(
    options: StoreDecisionOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError | RecordValidationError,
    FileRead | FileWrite
  > {
    let content = `DECISION: ${options.decision}`
    if (options.reasoning !== undefined && options.reasoning.length > 0) {
      content += `\nREASONING: ${options.reasoning}`
    }
    if (options.alternatives !== undefined && options.alternatives.length > 0) {
      content += `\nALTERNATIVES: ${options.alternatives.join(", ")}`
    }
    return this.store(content, {
      level: Level.Decisions,
      tags: [...(options.tags ?? []), "decision"],
      caused_by_id: options.caused_by_id,
      namespace: options.namespace,
      semantic_type: "decision",
    })
  }

  /**
   * Store with explicit channel for provenance stamping.
   * 带显式 channel 的存储，用于 provenance 标记。
   *
   * `auto_promote`: if Some(false), disables surprise-based level promotion.
   * `auto_promote` 为 false 时关闭基于“surprise”的 level 晋升。
   *
   * SIMPLE IMPLEMENTATION: only appends to brain.cog (CognitiveStoreFile) and fsyncs.
   * 简化实现：仅追加写入 brain.cog 并 fsync；不维护 brain.aura 与 index/。
   * Rust reference: `Aura::store` / `Aura::store_with_channel` (`../src/aura.rs`).
   */
  store_with_channel(
    content: string,
    options?: StoreOptions & {
      readonly channel?: string;
      readonly auto_promote?: boolean;
    },
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError | RecordValidationError,
    FileRead | FileWrite
  > {
    const dir = this.brainDir;
    const self = this;
    return Effect.gen(function* () {
      const clock = yield* Clock
      const nowSec = clock.nowSeconds();
      const nowIso = new Date().toISOString();
      // NON-PARITY: id12() generates random IDs — record IDs must be deterministic
      // for engine parity. Tracked: defer until Rust-aligned AuraStorage provides
      // deterministic record ID generation (e.g., content-hash-based).
      const id = id12();

      const tags = Array.isArray(options?.tags)
        ? options!.tags.filter((t): t is string => typeof t === "string")
        : [];

      const sourceType = options?.source_type ?? DEFAULT_SOURCE_TYPE
      const namespace = options?.namespace ?? DEFAULT_NAMESPACE
      const semanticType = options?.semantic_type ?? DEFAULT_SEMANTIC_TYPE
      const validationError = validateRecordStoreInput({
        content,
        tags,
        source_type: sourceType,
        semantic_type: semanticType,
        namespace,
      })
      if (validationError !== undefined) {
        return yield* Effect.fail(validationError)
      }
      let record: AuraRecord = {
        id,
        content,
        level: options?.level ?? Level.Working,
        strength: 1,
        activation_count: 0,
        created_at: nowSec,
        last_activated: nowSec,
        tags,
        connections: {},
        connection_types: {},
        content_type: options?.content_type ?? "text",
        source_type: sourceType,
        namespace,
        semantic_type: semanticType,
        activation_velocity: 0,
        salience: 0,
        metadata: { ...(options?.metadata ?? {}), timestamp: nowIso },
        caused_by_id: options?.caused_by_id ?? null,
        confidence: defaultConfidenceForSource(sourceType),
        support_mass: 0,
        conflict_mass: 0,
        volatility: 0,
      };

      record = self.autoConnectRecord(record)
      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendStore(record);
      yield* store.flush();
      self.replaceSearchRecord(record)
      return record;
    });
  }

  /**
   * Update a record.
   * 更新一条 record。
   *
   * SIMPLE IMPLEMENTATION: load current in-memory view (from brain.cog/brain.snap) and append an Update record.
   * 简化实现：从 brain.cog/brain.snap 回放得到当前视图，再追加写入一条 Update 记录。
   * Rust reference: `Aura::update` (`../src/aura.rs`).
   */
  update(
    record_id: string,
    patch?: UpdateOptions,
  ): Effect.Effect<
    AuraRecord | null,
    FileReadError | FileWriteError | FileFormatError | RecordValidationError,
    FileRead | FileWrite
  > {
    const dir = this.brainDir;
    const self = this;
    return Effect.gen(function* () {
      if (patch?.source_type !== undefined) {
        const validationError = validateRecordSourceType(patch.source_type)
        if (validationError !== undefined) {
          return yield* Effect.fail(validationError)
        }
      }
      const clock = yield* Clock
      const nowSec = clock.nowSeconds();
      const records = yield* loadCognitiveRecords(dir);
      const existing = records.get(record_id);
      const base = existing ? toRecordLike(existing, nowSec) : undefined;
      if (base === undefined) {
        return null
      }

      const next: AuraRecord = {
        id: record_id,
        content: patch?.content ?? base.content,
        level: patch?.level ?? base.level,
        strength: patch?.strength !== undefined ? clamp01(patch.strength) : base.strength,
        activation_count: base.activation_count,
        created_at: base.created_at,
        last_activated: base.last_activated,
        tags: patch?.tags ?? base.tags,
        connections: base.connections,
        connection_types: base.connection_types,
        content_type: base.content_type,
        source_type: patch?.source_type ?? base.source_type,
        namespace: base.namespace,
        semantic_type: base.semantic_type,
        activation_velocity: base.activation_velocity,
        salience: base.salience,
        metadata: patch?.metadata ?? base.metadata,
        aura_id: base.aura_id ?? null,
        caused_by_id: base.caused_by_id ?? null,
        confidence: base.confidence,
        support_mass: base.support_mass,
        conflict_mass: base.conflict_mass,
        volatility: base.volatility,
      };

      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendUpdate(next);
      yield* store.flush();
      self.replaceSearchRecord(next)
      return next;
    });
  }

  /**
   * Delete a record.
   * 删除一条 record。
   *
   * SIMPLE IMPLEMENTATION: append delete op to brain.cog and return true.
   * 简化实现：追加写入 delete 操作并返回 true（后续 parity 可返回 existed?）。
   * Rust reference: `Aura::delete` (`../src/aura.rs`).
   */
  delete(
    record_id: string,
  ): Effect.Effect<
    boolean,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    const dir = this.brainDir;
    const self = this;
    return Effect.gen(function* () {
      const records = yield* loadCognitiveRecords(dir);
      if (!records.has(record_id)) {
        return false
      }
      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendDelete(record_id);
      yield* store.flush();
      self.removeSearchRecord(record_id)
      return true;
    });
  }

  /**
   * Connect two records with optional relationship type.
   * 连接两条 records（可选 relationship 类型）。
   *
   * Relationship types (inspired by molecular reasoning bonds):
   * - `"causal"`: A caused/led to B
   * - `"reflective"`: B validates/corrects A
   * - `"associative"`: A and B are thematically related
   * - `"coactivation"`: A and B were recalled together in a session
   * - Any custom string
   *
   * SIMPLE IMPLEMENTATION: load records, mutate connections, appendUpdate full records.
   * 简化实现：加载记录、更新 connections、追加写入完整 record。
   * Rust reference: `Aura::connect` (`../src/aura.rs`).
   */
  connect(
    from_id: string,
    to_id: string,
    weight?: number,
    relationship?: string,
  ): Effect.Effect<
    void,
    FileReadError | FileWriteError | FileFormatError | RecordValidationError,
    FileRead | FileWrite
  > {
    const dir = this.brainDir;
    const self = this;
    const w =
      typeof weight === "number" && Number.isFinite(weight) ? clamp01(weight) : 0.5;
    return Effect.gen(function* () {
      const clock = yield* Clock
      const nowSec = clock.nowSeconds();
      const records = yield* loadCognitiveRecords(dir);
      const fromBase = records.get(from_id) !== undefined ? toRecordLike(records.get(from_id)!, nowSec) : undefined;
      const toBase = records.get(to_id) !== undefined ? toRecordLike(records.get(to_id)!, nowSec) : undefined;
      if (fromBase === undefined) {
        return yield* Effect.fail(recordValidationError("from_id", `Record ${from_id} not found`, "Aura::connect (aura.rs)"))
      }
      if (toBase === undefined) {
        return yield* Effect.fail(recordValidationError("to_id", `Record ${to_id} not found`, "Aura::connect (aura.rs)"))
      }
      if (fromBase.namespace !== toBase.namespace) {
        return yield* Effect.fail(recordValidationError(
          "namespace",
          `Cannot connect records across namespaces ('${fromBase.namespace}' vs '${toBase.namespace}')`,
          "Aura::connect (aura.rs)"
        ))
      }

      const fromConnections: { [k: string]: number } = { ...fromBase.connections };
      fromConnections[to_id] = w;
      const toConnections: { [k: string]: number } = { ...toBase.connections };
      toConnections[from_id] = w;
      const fromConnectionTypes: { [k: string]: string } = { ...fromBase.connection_types }
      const toConnectionTypes: { [k: string]: string } = { ...toBase.connection_types }
      if (relationship !== undefined) {
        fromConnectionTypes[to_id] = relationship
        toConnectionTypes[from_id] = relationship
      }

      const fromNext: AuraRecord = {
        ...fromBase,
        id: from_id,
        connections: fromConnections,
        connection_types: fromConnectionTypes,
      };
      const toNext: AuraRecord = {
        ...toBase,
        id: to_id,
        connections: toConnections,
        connection_types: toConnectionTypes,
      };

      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendUpdate(fromNext);
      yield* store.appendUpdate(toNext);
      yield* store.flush();
      self.replaceSearchRecord(fromNext)
      self.replaceSearchRecord(toNext)
    });
  }

  private currentBoundedRerankModes(): BoundedRerankModes {
    return { ...this.boundedRerankModes }
  }

  private currentTrustConfig(): TrustConfig {
    return cloneTrustConfig(this.trustConfig)
  }

  private recallOptionsWithRuntimeModes(options?: Partial<RecallPipelineOptions>): Partial<RecallPipelineOptions> {
    return {
      ...(options ?? {}),
      boundedRerankModes: this.currentBoundedRerankModes(),
    }
  }

  private recallTierRecords(
    tier: MemoryTierKind,
    query: string | null | undefined,
    limit: number | undefined,
    namespaces: ReadonlyArray<string> | undefined,
  ): Effect.Effect<ReadonlyArray<AuraRecord>, never, FileRead | FileWrite> {
    const self = this
    const max = rustOptionalTopK(limit)
    const nsList = namespaces ?? [DEFAULT_NAMESPACE]
    return Effect.gen(function* () {
      if (query !== undefined && query !== null) {
        /**
         * RRF pipeline -> filter to requested tier.
         * 先跑 RRF pipeline，再过滤到目标 tier。
         *
         * Request more from pipeline to compensate for tier filtering.
         * 多取结果以补偿 tier filter。
         * Rust reference: `Aura::recall_cognitive` / `Aura::recall_core_tier` (`../src/aura.rs`).
         */
        const pipelineLimit = max * 3
        const hitsOrNull = yield* Effect.gen(function* () {
          const hits = yield* recallRecordsEffect<AuraRecord>(
            self.brainDir,
            query,
            self.recallOptionsWithRuntimeModes({
              topK: pipelineLimit,
              minStrength: 0.1,
              expandConnections: true,
              namespaces: nsList,
            }),
            undefined,
            self.currentTrustConfig(),
          )
          self.searchRecords = yield* loadCognitiveRecords(self.brainDir)
          return hits as ReadonlyArray<readonly [number, AuraRecord]>
        }).pipe(
          Effect.catch(() => Effect.succeed(null as ReadonlyArray<readonly [number, AuraRecord]> | null)),
        )

        if (hitsOrNull !== null) {
          return hitsOrNull
            .map(([, record]) => record)
            .filter((record) => isLevelInTier(record.level, tier))
            .slice(0, max)
            .map(cloneAuraRecord)
        }
      }

      // No query or pipeline error -> list requested tier by importance.
      // 无 query 或 pipeline 失败时，按 importance 返回目标 tier 的 records。
      // Rust reference: `Aura::recall_cognitive` / `Aura::recall_core_tier` (`../src/aura.rs`).
      return tierRecords([...self.searchRecords.values()], tier, max, nsList)
    })
  }

  /**
   * NON-PARITY IMPLEMENTATION: returns RecallScored rather than Rust's richer RecallItem.
   * 差异说明：TS recall pipeline 目前返回 scored IDs；structured/explainability 尚未实现。
   * Rust reference: `Aura::recall` (`../src/aura.rs`).
   */
  recall(query: string, options?: Partial<RecallPipelineOptions>) {
    const self = this
    return Effect.gen(function* () {
      const scored = yield* recallScoredEffect(
        self.brainDir,
        query,
        self.recallOptionsWithRuntimeModes(options),
        undefined,
        self.currentTrustConfig(),
        self.sessionTracker,
      )
      self.searchRecords = yield* loadCognitiveRecords(self.brainDir)
      return scored
    })
  }

  /**
   * NON-PARITY IMPLEMENTATION: approximates structured recall via recallRecords.
   * Reason: TS does not yet model RecallExplanation/trace bundle.
   * Rust reference: `Aura::recall_structured` (`../src/aura.rs`).
   */
  recall_structured(query: string, options?: Partial<RecallPipelineOptions>) {
    const self = this
    return Effect.gen(function* () {
      const records = yield* recallRecordsEffect<AuraRecord>(
        self.brainDir,
        query,
        self.recallOptionsWithRuntimeModes(options),
        undefined,
        self.currentTrustConfig(),
        self.sessionTracker,
      )
      self.searchRecords = yield* loadCognitiveRecords(self.brainDir)
      return records
    })
  }

  /**
   * NON-PARITY IMPLEMENTATION: same as recall_structured for now.
   * Reason: TS does not yet model the full explainability DTO surface from Rust.
   * Rust reference: `Aura::recall_full` (`../src/aura.rs`).
   */
  recall_full(query: string, options?: Partial<RecallPipelineOptions>) {
    return this.recall_structured(query, options);
  }

  /**
   * Temporal recall: recall only from records created at or before a given timestamp.
   * 时间召回：仅考虑创建时间不晚于指定 timestamp 的 records。
   *
   * Answers the question: "What did the agent know at time X?"
   * 回答“agent 在 X 时刻知道什么？”。
   *
   * The pipeline is identical to `recall_structured`, but the record set is
   * pre-filtered by `created_at <= timestamp` before scoring.
   * 管线与 `recall_structured` 相同，但 scoring 前先用 `created_at <= timestamp` 过滤 record set。
   * Rust reference: `Aura::recall_at` and `py_recall_at` (`../src/aura.rs`).
   */
  recall_at(
    query: string,
    timestamp: number,
    topK?: number,
    minStrength?: number,
    expandConnections?: boolean,
    sessionId?: string,
    namespaces?: ReadonlyArray<string>,
  ) {
    const self = this
    const options = recallReportOptions(topK, minStrength, expandConnections, sessionId, namespaces)
    return Effect.gen(function* () {
      const records = yield* recallTemporalRecordsEffect<AuraRecord>(
        self.brainDir,
        query,
        timestamp,
        options,
        self.currentTrustConfig(),
        self.sessionTracker,
      )
      self.searchRecords = yield* loadCognitiveRecords(self.brainDir)
      return records
    })
  }

  /**
   * Recall with parallel shadow belief scoring.
   * 使用并行 shadow belief scoring 的 structured recall。
   *
   * Returns baseline raw results plus a shadow report; shadow scoring is observational.
   * 返回 raw baseline 结果和 shadow report；shadow scoring 不改变排序。
   * Rust reference: `Aura::recall_structured_with_shadow` (`../src/aura.rs`).
   */
  recall_structured_with_shadow(
    query: string,
    topK?: number,
    minStrength?: number,
    expandConnections?: boolean,
    sessionId?: string,
    namespaces?: ReadonlyArray<string>,
  ) {
    const self = this
    const options = recallReportOptions(topK, minStrength, expandConnections, sessionId, namespaces)
    const top = options.topK ?? 20
    return Effect.gen(function* () {
      const scored = yield* recallRawScoredEffect(self.brainDir, query, options, self.currentTrustConfig())
      const records = yield* loadCognitiveRecords(self.brainDir)
      const beliefState = yield* BeliefStoreFile.new(self.brainDir).load()
      const shadowReport = computeShadowBeliefScores(scored, beliefState, top)
      const hits = recallHitsFromScored(scored, records)
      yield* finalizeRecallScoredEffect(self.brainDir, scored, sessionId, self.sessionTracker)
      self.searchRecords = yield* loadCognitiveRecords(self.brainDir)
      return [hits, shadowReport] as readonly [ReadonlyArray<AuraRecallHit>, ShadowRecallReport]
    })
  }

  /**
   * Recall with limited reranking and a diagnostic report.
   * 使用 limited reranking 并返回诊断报告。
   *
   * Applies a single belief rerank pass on the raw baseline, regardless of runtime mode.
   * 无论 runtime mode 如何，都只在 raw baseline 上执行一次 belief rerank，避免 double-rerank。
   * Rust reference: `Aura::recall_structured_with_rerank_report` (`../src/aura.rs`).
   */
  recall_structured_with_rerank_report(
    query: string,
    topK?: number,
    minStrength?: number,
    expandConnections?: boolean,
    sessionId?: string,
    namespaces?: ReadonlyArray<string>,
  ) {
    const self = this
    const options = recallReportOptions(topK, minStrength, expandConnections, sessionId, namespaces)
    const top = options.topK ?? 20
    return Effect.gen(function* () {
      const scored = yield* recallRawScoredEffect(self.brainDir, query, options, self.currentTrustConfig())
      const matched = Array.from(scored)
      const beliefState = yield* BeliefStoreFile.new(self.brainDir).load()
      const report = applyBeliefRerank(matched, beliefState, top)
      const records = yield* loadCognitiveRecords(self.brainDir)
      const hits = recallHitsFromScored(matched, records)
      yield* finalizeRecallScoredEffect(self.brainDir, matched, sessionId, self.sessionTracker)
      self.searchRecords = yield* loadCognitiveRecords(self.brainDir)
      return [hits, report] as readonly [ReadonlyArray<AuraRecallHit>, LimitedRerankReport]
    })
  }

  /**
   * Set belief-aware recall reranking mode.
   *
   * 设置 belief-aware recall reranking mode。字符串入参与 Rust Python binding 保持一致：
   * `"limited"` / `"shadow"` / 其它值回落 `"off"`。
   *
   * Rust reference: `Aura::set_belief_rerank_mode` and
   * `py_set_belief_rerank_mode` in `../src/aura.rs`.
   */
  set_belief_rerank_mode(mode: BeliefRerankMode | string): void {
    this.boundedRerankModes = {
      ...this.boundedRerankModes,
      beliefMode: parseBeliefRerankMode(mode),
    }
  }

  /**
   * Get current belief-aware recall reranking mode.
   * 获取当前 belief-aware recall reranking mode。
   * Rust reference: `Aura::get_belief_rerank_mode` (`../src/aura.rs`).
   */
  get_belief_rerank_mode(): BeliefRerankMode {
    return this.boundedRerankModes.beliefMode
  }

  /**
   * Convenience: enable limited belief reranking.
   * 便利方法：启用 limited belief reranking。
   * Rust reference: `Aura::set_belief_rerank_enabled` (`../src/aura.rs`).
   */
  set_belief_rerank_enabled(enabled: boolean): void {
    this.set_belief_rerank_mode(enabled ? BeliefRerankMode.Limited : BeliefRerankMode.Off)
  }

  /**
   * Convenience: check if belief reranking is actively influencing ranking.
   * 便利方法：检查 belief reranking 是否正在影响排序。
   * Rust reference: `Aura::is_belief_rerank_enabled` (`../src/aura.rs`).
   */
  is_belief_rerank_enabled(): boolean {
    return this.get_belief_rerank_mode() === BeliefRerankMode.Limited
  }

  /**
   * Set concept surface mode.
   *
   * 设置 concept surface mode。字符串入参与 Rust Python binding 保持一致：
   * `"limited"` / `"inspect"` / 其它值回落 `"off"`。
   *
   * Rust reference: `Aura::set_concept_surface_mode` and
   * `py_set_concept_surface_mode` in `../src/aura.rs`.
   */
  set_concept_surface_mode(mode: ConceptSurfaceMode | string): void {
    this.boundedRerankModes = {
      ...this.boundedRerankModes,
      conceptMode: parseConceptSurfaceMode(mode),
    }
  }

  /**
   * Get current concept surface mode.
   * 获取当前 concept surface mode。
   * Rust reference: `Aura::get_concept_surface_mode` (`../src/aura.rs`).
   */
  get_concept_surface_mode(): ConceptSurfaceMode {
    return this.boundedRerankModes.conceptMode
  }

  /**
   * Set causal-pattern recall reranking mode.
   *
   * 设置 causal-pattern recall reranking mode。字符串入参与 Rust Python binding 保持一致：
   * `"limited"` / 其它值回落 `"off"`。
   *
   * Rust reference: `Aura::set_causal_rerank_mode` and
   * `py_set_causal_rerank_mode` in `../src/aura.rs`.
   */
  set_causal_rerank_mode(mode: CausalRerankMode | string): void {
    this.boundedRerankModes = {
      ...this.boundedRerankModes,
      causalMode: parseCausalRerankMode(mode),
    }
  }

  /**
   * Get current causal-pattern recall reranking mode.
   * 获取当前 causal-pattern recall reranking mode。
   * Rust reference: `Aura::get_causal_rerank_mode` (`../src/aura.rs`).
   */
  get_causal_rerank_mode(): CausalRerankMode {
    return this.boundedRerankModes.causalMode
  }

  /**
   * Set the temporal causal edge budgeting mode.
   *
   * 设置 temporal causal edge budgeting mode。字符串入参支持 Rust enum 名
   * `ExhaustiveCapped` / `NearbySuccessors` 和 snake_case 形式。
   *
   * Rust reference: `Aura::set_causal_temporal_budget_mode` in `../src/aura.rs`.
   * Rust original enum name: `TemporalEdgeBudgetMode`.
   */
  set_causal_temporal_budget_mode(mode: TemporalBudgetMode | string): void {
    this.causalTemporalBudgetMode = parseTemporalBudgetMode(mode)
  }

  /**
   * Get current temporal causal edge budgeting mode.
   * 获取当前 temporal causal edge budgeting mode。
   * Rust reference: `Aura::get_causal_temporal_budget_mode` (`../src/aura.rs`).
   */
  get_causal_temporal_budget_mode(): TemporalBudgetMode {
    return this.causalTemporalBudgetMode
  }

  /**
   * Set causal evidence gating mode.
   *
   * 设置 causal evidence gating mode。字符串入参与 Rust Python binding 保持一致：
   * `"strict"` / `"temporal_cluster_recovery"` / `"explicit_trusted"`。
   *
   * Rust reference: `Aura::set_causal_evidence_mode` and
   * `py_set_causal_evidence_mode` in `../src/aura.rs`.
   */
  set_causal_evidence_mode(mode: EvidenceMode | string): void {
    this.causalEvidenceMode = parseEvidenceMode(mode)
  }

  /**
   * Get current causal evidence gating mode.
   * 获取当前 causal evidence gating mode。
   * Rust reference: `Aura::get_causal_evidence_mode` (`../src/aura.rs`).
   */
  get_causal_evidence_mode(): EvidenceMode {
    return this.causalEvidenceMode
  }

  /**
   * Set policy-hint recall reranking mode.
   *
   * 设置 policy-hint recall reranking mode。字符串入参与 Rust Python binding 保持一致：
   * `"limited"` / 其它值回落 `"off"`。
   *
   * Rust reference: `Aura::set_policy_rerank_mode` and
   * `py_set_policy_rerank_mode` in `../src/aura.rs`.
   */
  set_policy_rerank_mode(mode: PolicyRerankMode | string): void {
    this.boundedRerankModes = {
      ...this.boundedRerankModes,
      policyMode: parsePolicyRerankMode(mode),
    }
  }

  /**
   * Get current policy-hint recall reranking mode.
   * 获取当前 policy-hint recall reranking mode。
   * Rust reference: `Aura::get_policy_rerank_mode` (`../src/aura.rs`).
   */
  get_policy_rerank_mode(): PolicyRerankMode {
    return this.boundedRerankModes.policyMode
  }

  /**
   * Set trust configuration.
   * 设置信任评分配置。
   *
   * Rust reference: `Aura::set_trust_config` and `py_set_trust_config` in `../src/aura.rs`.
   */
  set_trust_config(config: TrustConfig): void {
    this.trustConfig = cloneTrustConfig(config)
  }

  /**
   * Get current trust configuration.
   * 获取当前信任评分配置。
   *
   * Rust reference: `Aura::get_trust_config` in `../src/aura.rs`.
   */
  get_trust_config(): TrustConfig {
    return this.currentTrustConfig()
  }

  /**
   * Enable all four cognitive recall reranking signals.
   *
   * 开启四个 cognitive recall reranking signal。
   *
   * Rust reference: `Aura::enable_full_cognitive_stack` and
   * `py_enable_full_cognitive_stack` in `../src/aura.rs`.
   */
  enable_full_cognitive_stack(): void {
    this.boundedRerankModes = {
      beliefMode: BeliefRerankMode.Limited,
      conceptMode: Csm.Limited,
      causalMode: CausalRerankMode.Limited,
      policyMode: PolicyRerankMode.Limited,
    }
    this.set_causal_evidence_mode(EvidenceMode.ExplicitTrusted)
  }

  /**
   * Disable all four cognitive recall reranking signals.
   *
   * 关闭四个 cognitive recall reranking signal。
   *
   * Rust reference: `Aura::disable_full_cognitive_stack` and
   * `py_disable_full_cognitive_stack` in `../src/aura.rs`.
   */
  disable_full_cognitive_stack(): void {
    this.boundedRerankModes = {
      beliefMode: BeliefRerankMode.Off,
      conceptMode: Csm.Off,
      causalMode: CausalRerankMode.Off,
      policyMode: PolicyRerankMode.Off,
    }
  }

  /**
   * Search with filters.
   * 按过滤条件搜索 records。
   * Rust reference: `Aura::search` (`../src/aura.rs`).
   */
  search(
    options?: AuraSearchOptions,
  ): ReadonlyArray<AuraRecord>
  search(
    query?: string,
    level?: Level,
    tags?: ReadonlyArray<string>,
    limit?: number,
    content_type?: string,
    source_type?: string,
    namespaces?: ReadonlyArray<string>,
    semantic_type?: string,
  ): ReadonlyArray<AuraRecord>
  search(
    first?: AuraSearchOptions | string,
    level?: Level,
    tags?: ReadonlyArray<string>,
    limit?: number,
    content_type?: string,
    source_type?: string,
    namespaces?: ReadonlyArray<string>,
    semantic_type?: string,
  ): ReadonlyArray<AuraRecord> {
    const options: AuraSearchOptions =
      typeof first === "object" && first !== null
        ? first
        : {
            query: first,
            level,
            tags,
            limit,
            content_type,
            source_type,
            namespaces,
            semantic_type,
          }
    const max = options.limit ?? 20
    const nsList = options.namespaces ?? (options.namespace !== undefined ? [options.namespace] : ["default"])
    const query = options.query?.toLowerCase()
    const results = [...this.searchRecords.values()].filter((record) => {
      if (!nsList.includes(record.namespace)) return false
      if (options.level !== undefined && record.level !== options.level) return false
      if (options.tags !== undefined && !options.tags.some((tag) => record.tags.includes(tag))) return false
      if (options.content_type !== undefined && record.content_type !== options.content_type) return false
      if (options.source_type !== undefined && record.source_type !== options.source_type) return false
      if (options.semantic_type !== undefined && record.semantic_type !== options.semantic_type) return false
      if (query !== undefined && !record.content.toLowerCase().includes(query)) return false
      return true
    })
    results.sort((a, b) => recordImportance(b) - recordImportance(a))
    return results.slice(0, max).map(cloneAuraRecord)
  }

  /**
   * Get statistics.
   * 获取基础统计。
   * Rust reference: `Aura::stats` (`../src/aura.rs`).
   */
  stats(): AuraStats {
    const records = [...this.searchRecords.values()]
    const uniqueTags = new Set<string>()
    let totalConnections = 0
    let working = 0
    let decisions = 0
    let domain = 0
    let identity = 0
    for (const record of records) {
      if (record.level === Level.Working) working += 1
      if (record.level === Level.Decisions) decisions += 1
      if (record.level === Level.Domain) domain += 1
      if (record.level === Level.Identity) identity += 1
      totalConnections += Object.keys(record.connections).length
      for (const tag of record.tags) uniqueTags.add(tag)
    }
    return {
      total_records: records.length,
      working,
      decisions,
      domain,
      identity,
      total_connections: totalConnections,
      total_tags: uniqueTags.size,
    }
  }

  /**
   * MCP insights intentionally mirrors Rust MCP's stats() call path.
   * MCP insights 在 Rust server 中实际调用 stats()，TS 侧保持同一契约。
   * Rust reference: `AuraMcpServer::insights` (`../src/mcp.rs`).
   */
  insights(): AuraStats {
    return this.stats()
  }

  /**
   * Apply decay to all records.
   * 对所有 records 应用衰减。
   * Rust reference: `Aura::decay` and `py_decay` (`../src/aura.rs`).
   */
  decay(): Effect.Effect<readonly [number, number], FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const records = yield* loadCognitiveRecords(dir)
      const store = yield* CognitiveStoreFile.open(dir)
      let decayed = 0
      const toArchive: string[] = []

      for (const [id, record] of records) {
        const decayedRecord = decayRecordConnections(applyRecordDecay(record))
        decayed += 1
        if (isRecordAlive(decayedRecord)) {
          records.set(id, decayedRecord)
          yield* store.appendUpdate(decayedRecord)
        } else {
          toArchive.push(id)
        }
      }

      for (const id of toArchive) {
        records.delete(id)
        yield* store.appendDelete(id)
      }

      if (toArchive.length > 100) {
        yield* store.writeSnapshot(Array.from(records.values()))
      }
      yield* store.flush()
      self.searchRecords = records
      return [decayed, toArchive.length] as const
    })
  }

  /**
   * Reflect — promote, archive, detect conflicts.
   * 反思维护：提升符合条件的 records，并归档死亡 records。
   * Rust reference: `Aura::reflect` and `py_reflect` (`../src/aura.rs`).
   */
  reflect(): Effect.Effect<Record<string, number>, FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const records = yield* loadCognitiveRecords(dir)
      const store = yield* CognitiveStoreFile.open(dir)
      let promoted = 0

      for (const [id, record] of records) {
        if (!canPromoteRecord(record)) continue
        const nextLevel = promoteLevel(record.level)
        if (nextLevel === null) continue
        const promotedRecord: AuraRecord = { ...record, level: nextLevel }
        records.set(id, promotedRecord)
        promoted += 1
        yield* store.appendUpdate(promotedRecord)
      }

      // Semantic-aware promotion removed: Level decay rates already encode importance.
      // 语义感知提升已移除：Level 衰减率已经编码重要性。
      // Rust reference: `Aura::reflect` (`../src/aura.rs`).
      const semanticPromotable: string[] = []

      for (const id of semanticPromotable) {
        const record = records.get(id)
        if (record === undefined) continue
        const nextLevel = promoteLevel(record.level)
        if (nextLevel === null) continue
        const promotedRecord: AuraRecord = { ...record, level: nextLevel }
        records.set(id, promotedRecord)
        promoted += 1
        yield* store.appendUpdate(promotedRecord)
      }

      const hubPromotable: string[] = []
      for (const [id, record] of records) {
        if (canPromoteContextualHub(record)) hubPromotable.push(id)
      }

      for (const id of hubPromotable) {
        const record = records.get(id)
        if (record === undefined) continue
        const nextLevel = promoteLevel(record.level)
        if (nextLevel === null) continue
        const promotedRecord: AuraRecord = { ...record, level: nextLevel }
        records.set(id, promotedRecord)
        promoted += 1
        yield* store.appendUpdate(promotedRecord)
      }

      const dead: string[] = []
      for (const [id, record] of records) {
        if (!isRecordAlive(record)) dead.push(id)
      }

      for (const id of dead) {
        records.delete(id)
        yield* store.appendDelete(id)
      }

      yield* store.flush()
      self.searchRecords = records
      return { promoted, archived: dead.length }
    })
  }

  /**
   * End a session (co-activation strengthening).
   * 结束 session（共同激活增强）。
   * Rust reference: `Aura::end_session` and `py_end_session` (`../src/aura.rs`).
   */
  end_session(session_id: string): Effect.Effect<Record<string, number>, FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const stats = yield* endRecallSession(dir, self.sessionTracker, session_id)
      self.searchRecords = yield* loadCognitiveRecords(dir)
      return stats
    })
  }

  /**
   * Public MCP-facing facade over the maintenance orchestration.
   * 面向 MCP 的公开维护入口，委托到 runMaintenance。
   * Rust reference: `Aura::run_maintenance` / `AuraMcpServer` maintain path.
   */
  maintain(config?: MaintenanceConfig) {
    return this.runMaintenance(config)
  }

  /**
   * Configure the maintenance pipeline.
   * 配置 maintenance pipeline。
   * Rust reference: `Aura::configure_maintenance` (`../src/aura.rs`).
   */
  configure_maintenance(config: MaintenanceConfig): void {
    this.maintenanceConfig = config
  }

  /**
   * Run the full maintenance pipeline using the configured maintenance settings.
   * 使用已配置的 maintenance settings 运行完整 maintenance pipeline。
   * Rust reference: `Aura::run_maintenance` (`../src/aura.rs`).
   */
  run_maintenance() {
    return this.runMaintenance()
  }

  /**
   * UNIMPLEMENTED: consolidation is recoverably unsupported until TS has a real merge algorithm.
   * 未实现：TS 具备真实 merge 算法前，consolidate 以可恢复 typed error 暴露。
   * Rust reference: `Aura::consolidate` (`../src/aura.rs`).
   */
  consolidate(): Effect.Effect<never, UnsupportedSurfaceError> {
    return Effect.fail(new UnsupportedSurfaceError({
      surface: "Aura.consolidate",
      reason: "TS core has no Rust-parity consolidation merge/update path yet; dummy success counts are forbidden.",
      rustReference: "Aura::consolidate (aura.rs)",
      missingPrerequisites: [
        "Rust-parity consolidation algorithm",
        "coherent ngram/tag/aura index mutation during merges",
      ],
    }))
  }

  /**
   * Close and flush everything.
   * 关闭并 flush 所有持久化 surface。
   * Rust reference: `Aura::close` (`../src/aura.rs`).
   */
  close(): Effect.Effect<void, FileReadError | FileWriteError, FileRead | FileWrite> {
    return this.flush()
  }

  /**
   * Flush pending writes.
   * flush 待写入数据。
   * Rust reference: `Aura::flush` (`../src/aura.rs`).
   */
  flush(): Effect.Effect<void, FileReadError | FileWriteError, FileRead | FileWrite> {
    const dir = this.brainDir
    return Effect.gen(function* () {
      const brain = yield* BrainAuraFile.open(dir)
      yield* brain.flush()
      const cognitive = yield* CognitiveStoreFile.open(dir)
      yield* cognitive.flush()
    })
  }

  /**
   * Check if encryption is enabled.
   * 检查当前 Aura 实例是否启用加密。
   *
   * TS open_with_password 目前会对 password 返回 UnsupportedSurfaceError，因此已支持打开的实例均未启用加密。
   * Rust reference: `Aura::is_encrypted` (`../src/aura.rs`).
   */
  is_encrypted(): boolean {
    return false
  }

  /**
   * Export all records as JSON.
   * 将全部 records 导出为 JSON。
   * Rust reference: `Aura::export_json` (`../src/aura.rs`).
   */
  export_json(): string {
    return JSON.stringify(Array.from(this.searchRecords.values()), null, 2)
  }

  /**
   * Import records from JSON.
   * 从 JSON 导入 records。
   * Rust reference: `Aura::import_json` (`../src/aura.rs`).
   */
  import_json(
    jsonStr: string,
  ): Effect.Effect<number, JsonParseError | FileWriteError | FileReadError | RecordValidationError, FileRead | FileWrite> {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(jsonStr) as unknown,
        catch: (cause) => new JsonParseError({ path: "Aura.import_json", cause }),
      })
      if (!Array.isArray(parsed)) {
        return yield* Effect.fail(new JsonParseError({
          path: "Aura.import_json",
          cause: "expected JSON array of records",
        }))
      }

      const imported: AuraRecord[] = []
      for (const raw of parsed) {
        const record = normalizeCognitiveRecord(raw)
        if (record === undefined) {
          return yield* Effect.fail(new JsonParseError({
            path: "Aura.import_json",
            cause: "record is missing a valid id",
          }))
        }
        const validationError = validateRecordStoreInput({
          content: record.content,
          tags: record.tags,
          source_type: record.source_type,
          semantic_type: record.semantic_type,
          namespace: record.namespace,
        })
        if (validationError !== undefined) {
          return yield* Effect.fail(validationError)
        }
        imported.push(record)
      }

      const store = yield* CognitiveStoreFile.open(dir)
      for (const record of imported) {
        yield* store.appendStore(record)
      }
      yield* store.flush()

      const nextRecords = new Map(self.searchRecords)
      for (const record of imported) {
        nextRecords.set(record.id, record)
      }
      self.searchRecords = nextRecords
      return imported.length
    })
  }

  /**
   * Reuse the EpistemicRuntime read model instead of recomposing belief logic in the MCP layer.
   * 复用 EpistemicRuntime 读模型，避免 MCP 传输层重复组合业务逻辑。
   * Rust reference: `Aura::get_belief_instability_summary` (`../src/aura.rs`).
   */
  get_belief_instability_summary(): Effect.Effect<McpBeliefInstabilitySummary, never, EpistemicRuntime | BeliefEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const summary = yield* runtime.getBeliefInstabilitySummary()
      return toMcpBeliefInstabilitySummary(summary)
    })
  }

  belief_instability(): Effect.Effect<McpBeliefInstabilitySummary, never, EpistemicRuntime | BeliefEngine> {
    return this.get_belief_instability_summary()
  }

  /**
   * Reuse the EpistemicRuntime policy lifecycle aggregation.
   * 复用 EpistemicRuntime 的 policy lifecycle 聚合。
   * Rust reference: `Aura::get_policy_lifecycle_summary` (`../src/aura.rs`).
   */
  get_policy_lifecycle_summary(
    actionLimit?: number,
    domainLimit?: number,
  ): Effect.Effect<McpPolicyLifecycleSummary, never, EpistemicRuntime | PolicyEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const summary = yield* runtime.getPolicyLifecycleSummary(actionLimit, domainLimit)
      return toMcpPolicyLifecycleSummary(summary)
    })
  }

  policy_lifecycle(
    actionLimit?: number,
    domainLimit?: number,
  ): Effect.Effect<McpPolicyLifecycleSummary, never, EpistemicRuntime | PolicyEngine> {
    return this.get_policy_lifecycle_summary(actionLimit, domainLimit)
  }

  /**
   * Assemble the Rust MCP policy_lifecycle payload from core/runtime read models.
   * 从 core/runtime 读模型组装 Rust MCP policy_lifecycle payload，避免 MCP 层承载业务逻辑。
   *
   * Rust reference: `AuraMcpServer::policy_lifecycle` (`../src/mcp.rs`).
   */
  policy_lifecycle_report(
    namespace?: string,
    limit?: number,
    actionLimit?: number,
    domainLimit?: number,
  ): Effect.Effect<{
    readonly summary: McpPolicyLifecycleSummary
    readonly pressure: ReadonlyArray<McpPolicyPressureArea>
    readonly suppressed: ReadonlyArray<PolicyHint>
    readonly rejected: ReadonlyArray<PolicyHint>
  }, never, EpistemicRuntime | PolicyEngine> {
    const self = this
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const summary = yield* self.get_policy_lifecycle_summary(actionLimit, domainLimit)
      const pressure = yield* self.get_policy_pressure_report(namespace, limit)
      const suppressed = yield* runtime.getSuppressedPolicyHints(namespace, limit)
      const rejected = yield* runtime.getRejectedPolicyHints(namespace, limit)
      return { summary, pressure, suppressed, rejected }
    })
  }

  get_policy_pressure_report(
    namespace?: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<McpPolicyPressureArea>, never, EpistemicRuntime | PolicyEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const pressure = yield* runtime.getPolicyPressureReport(namespace, limit)
      return pressure.map(toMcpPolicyPressureArea)
    })
  }

  /**
   * Return suppressed policy hints, strongest first.
   * 返回 suppressed policy hints，最强的在前。
   *
   * Rust reference: `Aura::get_suppressed_policy_hints` and
   * `py_get_suppressed_policy_hints` (`../src/aura.rs`).
   */
  get_suppressed_policy_hints(
    namespace?: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<PolicyHint>, never, EpistemicRuntime | PolicyEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getSuppressedPolicyHints(namespace, limit)
    })
  }

  /**
   * Return rejected policy hints, strongest first.
   * 返回 rejected policy hints，最强的在前。
   *
   * Rust reference: `Aura::get_rejected_policy_hints` and
   * `py_get_rejected_policy_hints` (`../src/aura.rs`).
   */
  get_rejected_policy_hints(
    namespace?: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<PolicyHint>, never, EpistemicRuntime | PolicyEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getRejectedPolicyHints(namespace, limit)
    })
  }

  /**
   * Return surfaced policy hints for external consumption.
   * 返回用于外部消费的 surfaced policy hints。
   *
   * Rust reference: `Aura::get_surfaced_policy_hints` and
   * `py_get_surfaced_policy_hints` (`../src/aura.rs`).
   */
  get_surfaced_policy_hints(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, EpistemicRuntime | PolicyEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getSurfacedPolicyHints(limit)
    })
  }

  /**
   * Return surfaced policy hints filtered by namespace.
   * 返回按 namespace 过滤的 surfaced policy hints。
   *
   * Rust reference: `Aura::get_surfaced_policy_hints_for_namespace` and
   * `py_get_surfaced_policy_hints_for_namespace` (`../src/aura.rs`).
   */
  get_surfaced_policy_hints_for_namespace(
    namespace: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<SurfacedPolicyHint>, never, EpistemicRuntime | PolicyEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getSurfacedPolicyHintsForNamespace(namespace, limit)
    })
  }

  /**
   * Assemble the Rust MCP belief_instability payload from core/runtime read models.
   * 从 core/runtime 读模型组装 Rust MCP belief_instability payload。
   *
   * Rust reference: `AuraMcpServer::belief_instability` (`../src/mcp.rs`).
   */
  belief_instability_report(
    minVolatility?: number,
    maxStability?: number,
    limit?: number,
  ): Effect.Effect<{
    readonly summary: McpBeliefInstabilitySummary
    readonly high_volatility: ReadonlyArray<Belief>
    readonly low_stability: ReadonlyArray<Belief>
    readonly recently_corrected: ReadonlyArray<Belief>
  }, never, EpistemicRuntime | BeliefEngine> {
    const max = clampInt(limit ?? 20, 1, 100)
    const corrections = this.correctionLog
      .filter((entry) => entry.target_kind === "belief")
      .sort((a, b) => b.timestamp - a.timestamp)
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const summary = yield* runtime.getBeliefInstabilitySummary()
      const highVolatility = yield* runtime.getHighVolatilityBeliefs(minVolatility, max)
      const lowStability = yield* runtime.getLowStabilityBeliefs(maxStability, max)
      const beliefs = yield* runtime.getBeliefs()
      const byId = new Map(beliefs.map((belief) => [belief.id, belief]))
      const recentlyCorrected: Belief[] = []
      const seen = new Set<string>()
      for (const entry of corrections) {
        if (seen.has(entry.target_id)) continue
        const belief = byId.get(entry.target_id)
        if (belief === undefined) continue
        seen.add(entry.target_id)
        recentlyCorrected.push(belief)
        if (recentlyCorrected.length >= max) break
      }
      return {
        summary: toMcpBeliefInstabilitySummary(summary),
        high_volatility: highVolatility,
        low_stability: lowStability,
        recently_corrected: recentlyCorrected,
      }
    })
  }

  /**
   * Return beliefs with elevated volatility, highest volatility first.
   * 返回 volatility 较高的 beliefs，按 volatility 降序排列。
   *
   * Rust reference: `Aura::get_high_volatility_beliefs` and
   * `py_get_high_volatility_beliefs` (`../src/aura.rs`).
   */
  get_high_volatility_beliefs(
    minVolatility?: number,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<Belief>, never, EpistemicRuntime | BeliefEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getHighVolatilityBeliefs(minVolatility, limit)
    })
  }

  /**
   * Return beliefs with low stability, lowest stability first.
   * 返回 stability 较低的 beliefs，按 stability 升序排列。
   *
   * Rust reference: `Aura::get_low_stability_beliefs` and
   * `py_get_low_stability_beliefs` (`../src/aura.rs`).
   */
  get_low_stability_beliefs(
    maxStability?: number,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<Belief>, never, EpistemicRuntime | BeliefEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getLowStabilityBeliefs(maxStability, limit)
    })
  }

  /**
   * Return deterministic contradiction clusters derived from unstable belief groups.
   * 返回由不稳定 belief groups 派生的确定性 contradiction clusters。
   *
   * Rust reference: `Aura::get_contradiction_clusters` and
   * `py_get_contradiction_clusters` (`../src/aura.rs`).
   */
  get_contradiction_clusters(
    namespace?: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<ContradictionCluster>, never, EpistemicRuntime | BeliefEngine> {
    const records = this.searchRecords
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getContradictionClusters(records, namespace, limit)
    })
  }

  /**
   * Return beliefs that were explicitly corrected most recently.
   * 返回最近被显式 corrected 的 beliefs。
   *
   * Rust reference: `Aura::get_recently_corrected_beliefs` and
   * `py_get_recently_corrected_beliefs` (`../src/aura.rs`).
   */
  get_recently_corrected_beliefs(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<Belief>, never, EpistemicRuntime | BeliefEngine> {
    const max = clampInt(limit ?? 20, 1, 100)
    const corrections = this.correctionLog
      .filter((entry) => entry.target_kind === "belief")
      .sort((a, b) => b.timestamp - a.timestamp)
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const beliefs = yield* runtime.getBeliefs()
      const byId = new Map(beliefs.map((belief) => [belief.id, belief]))
      const out: Belief[] = []
      const seen = new Set<string>()
      for (const entry of corrections) {
        if (seen.has(entry.target_id)) continue
        const belief = byId.get(entry.target_id)
        if (belief === undefined) continue
        seen.add(entry.target_id)
        out.push(belief)
        if (out.length >= max) break
      }
      return out
    })
  }

  /**
   * Return surfaced concepts for external inspection.
   *
   * Returns bounded, sorted, provenance-checked concepts suitable for public consumption.
   * This is inspection-only -- surfaced concepts do not affect recall, compression, or behavior.
   * 返回用于外部 inspection 的 surfaced concepts；该读模型不影响 recall、compression 或行为。
   *
   * Rust reference: `Aura::get_surfaced_concepts` and
   * `py_get_surfaced_concepts` (`../src/aura.rs`).
   */
  get_surfaced_concepts(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, EpistemicRuntime | ConceptEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getSurfacedConcepts(limit)
    })
  }

  /**
   * Return surfaced concepts for a namespace.
   * 返回指定 namespace 的 surfaced concepts。
   *
   * Rust reference: `Aura::get_surfaced_concepts_for_namespace` and
   * `py_get_surfaced_concepts_for_namespace` (`../src/aura.rs`).
   */
  get_surfaced_concepts_for_namespace(
    namespace: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<SurfacedConcept>, never, EpistemicRuntime | ConceptEngine> {
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      return yield* runtime.getSurfacedConceptsForNamespace(namespace, limit)
    })
  }

  cross_namespace_digest(): Effect.Effect<CrossNamespaceDigest, never, ConceptEngine | CausalEngine | BeliefEngine> {
    return this.cross_namespace_digest_with_options(undefined, defaultCrossNamespaceDigestOptions())
  }

  cross_namespace_digest_filtered(
    namespaces?: ReadonlyArray<string>,
    topConceptsLimit?: number,
  ): Effect.Effect<CrossNamespaceDigest, never, ConceptEngine | CausalEngine | BeliefEngine> {
    const options: AuraCrossNamespaceDigestOptions = {
      top_concepts_limit: clampInt(topConceptsLimit ?? 5, 1, 10),
    }
    return this.cross_namespace_digest_with_options(namespaces, options)
  }

  /**
   * Build a read-only bounded analytics digest across namespaces.
   * 构建跨 namespace 的只读有界分析摘要。
   * Rust reference: `Aura::cross_namespace_digest_with_options` (`../src/aura.rs`).
   */
  cross_namespace_digest_with_options(
    namespaces?: ReadonlyArray<string>,
    inputOptions?: AuraCrossNamespaceDigestOptions,
  ): Effect.Effect<CrossNamespaceDigest, never, ConceptEngine | CausalEngine | BeliefEngine> {
    const started = Date.now()
    const records = [...this.searchRecords.values()]
    const recordsById = new Map(records.map((record) => [record.id, record]))
    const options = normalizeCrossNamespaceOptions(inputOptions)
    const allowed = namespaces !== undefined ? new Set(namespaces) : null
    const correctionLog = this.correctionLog

    return Effect.gen(function* () {
      const conceptEngine = yield* Effect.service(ConceptEngine)
      const causalEngine = yield* Effect.service(CausalEngine)
      const beliefEngine = yield* Effect.service(BeliefEngine)
      const conceptState = yield* conceptEngine.stats()
      const causalState = yield* causalEngine.stats()
      const beliefState = yield* beliefEngine.stats()
      const concepts = Object.values(conceptState.concepts)
      const causalPatterns = Object.values(causalState.patterns)
      const beliefs = Object.values(beliefState.beliefs)

      let namespaceList = [...new Set(records.map((record) => record.namespace))]
        .filter((namespace) => allowed === null || allowed.has(namespace))
        .filter((namespace) => records.filter((record) => record.namespace === namespace).length >= options.min_record_count)
      namespaceList.sort()

      const namespaceDigests = namespaceList.map((namespace) => {
        const namespaceRecords = records.filter((record) => record.namespace === namespace)
        const tags = options.include_tags && !options.compact_summary
          ? sortedUnique(namespaceRecords.flatMap((record) => record.tags.map((tag) => tag.toLowerCase())))
          : []
        const structuralRelationTypes = options.include_structural && !options.compact_summary
          ? sortedUnique(namespaceRecords.flatMap((record) =>
              Object.values(record.connection_types).filter(isStructuralRelationType)
            ))
          : []

        const namespaceConcepts = concepts
          .filter((concept) => concept.namespace === namespace)
          .sort((a, b) => b.confidence - a.confidence || a.key.localeCompare(b.key))
        const topConcepts = options.include_concepts && !options.compact_summary
          ? namespaceConcepts.slice(0, options.top_concepts_limit).map((concept) => ({
              concept_id: concept.id,
              key: concept.key,
              confidence: concept.confidence,
              state: concept.state.toLowerCase(),
              record_count: concept.record_ids.length,
              belief_count: concept.belief_ids.length,
            }))
          : []
        const conceptSignatures = options.include_concepts && !options.compact_summary
          ? sortedUnique(namespaceConcepts.map(canonicalConceptSignature))
          : []

        const causalSignatures = options.include_causal && !options.compact_summary
          ? sortedUnique(
              causalPatterns
                .filter((pattern) => pattern.namespace === namespace)
                .map((pattern) => canonicalCausalSignature(pattern, recordsById))
            )
          : []

        const namespaceBeliefs = beliefs.filter((belief) => belief.key.startsWith(`${namespace}:`))
        const beliefStateSummary = options.include_belief_states
          ? summarizeNamespaceBeliefStates(namespaceBeliefs)
          : null
        const correctionCount = options.include_corrections
          ? correctionLog.filter((entry) =>
              namespaceForCorrection(entry, recordsById, causalPatterns, []) === namespace ||
              (entry.target_kind === "belief" && namespaceBeliefs.some((belief) => belief.id === entry.target_id))
            ).length
          : null
        const correctionDensity = options.include_corrections
          ? (namespaceRecords.length === 0 ? 0 : correctionCount! / namespaceRecords.length)
          : null

        return {
          namespace,
          record_count: namespaceRecords.length,
          concept_count: namespaceConcepts.length,
          stable_concept_count: namespaceConcepts.filter((concept) => concept.state === "Stable").length,
          top_concepts: topConcepts,
          concept_signatures: conceptSignatures,
          tags,
          structural_relation_types: structuralRelationTypes,
          causal_signatures: causalSignatures,
          belief_state_summary: beliefStateSummary,
          correction_count: correctionCount,
          correction_density: correctionDensity,
        }
      })

      const pairs = []
      for (let left = 0; left < namespaceDigests.length; left++) {
        for (let right = left + 1; right < namespaceDigests.length; right++) {
          const a = namespaceDigests[left]!
          const b = namespaceDigests[right]!
          const sharedConceptSignatures = options.include_concepts && !options.compact_summary
            ? sortedIntersection(a.concept_signatures, b.concept_signatures)
            : []
          const sharedTags = options.include_tags && !options.compact_summary
            ? sortedIntersection(a.tags, b.tags)
            : []
          const sharedStructuralRelationTypes = options.include_structural && !options.compact_summary
            ? sortedIntersection(a.structural_relation_types, b.structural_relation_types)
            : []
          const sharedCausalSignatures = options.include_causal && !options.compact_summary
            ? sortedIntersection(a.causal_signatures, b.causal_signatures)
            : []
          const conceptSimilarity = jaccardSimilarity(a.concept_signatures, b.concept_signatures)
          const tagSimilarity = jaccardSimilarity(a.tags, b.tags)
          const structuralSimilarity = jaccardSimilarity(a.structural_relation_types, b.structural_relation_types)
          const causalSimilarity = jaccardSimilarity(a.causal_signatures, b.causal_signatures)
          const maxSimilarity = Math.max(conceptSimilarity, tagSimilarity, structuralSimilarity, causalSimilarity)
          if (maxSimilarity < options.pairwise_similarity_threshold) continue
          pairs.push({
            namespace_a: a.namespace,
            namespace_b: b.namespace,
            shared_concept_signatures: sharedConceptSignatures,
            concept_signature_similarity: conceptSimilarity,
            shared_tags: sharedTags,
            tag_jaccard: tagSimilarity,
            shared_structural_relation_types: sharedStructuralRelationTypes,
            structural_similarity: structuralSimilarity,
            shared_causal_signatures: sharedCausalSignatures,
            causal_signature_similarity: causalSimilarity,
          })
        }
      }

      return {
        namespace_count: namespaceDigests.length,
        latency_ms: Date.now() - started,
        compact_summary: options.compact_summary,
        included_dimensions: includedCrossNamespaceDimensions(options),
        namespaces: namespaceDigests,
        pairs,
      }
    })
  }

  memory_health(limit?: number): Effect.Effect<MemoryHealthDigest, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    return this.get_memory_health_digest(limit)
  }

  /**
   * Return an operator-facing digest from runtime read models plus persisted maintenance history.
   * 从 runtime 读模型和已持久化维护历史生成面向 operator 的健康摘要。
   * Rust reference: `Aura::get_memory_health_digest` (`../src/aura.rs`).
   */
  get_memory_health_digest(limit?: number): Effect.Effect<MemoryHealthDigest, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    const max = Math.min(20, Math.max(1, limit ?? 8))
    const records = this.searchRecords
    const reflection = summarizeReflections(this.reflectionSummaries)
    const trendSummary = summarizeTrends(this.maintenanceTrendHistory)
    const trendDirection = deriveMaintenanceTrendDirection(trendSummary)
    const recentCorrectionCount = this.correctionLog.length
    const startupHasRecoveryWarnings = this.startupValidationReport.has_recovery_warnings

    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const instability = yield* runtime.getBeliefInstabilitySummary()
      const lifecycle = yield* runtime.getPolicyLifecycleSummary(max, max)
      const pressure = yield* runtime.getPolicyPressureReport(undefined, max)
      const highVolatility = yield* runtime.getHighVolatilityBeliefs(0.20, max)
      const contradictionClusters = yield* runtime.getContradictionClusters(records, undefined, max)
      const recordValues = Array.from(records.values())

      const issues: OperatorReviewIssue[] = []
      for (const belief of highVolatility) {
        issues.push({
          kind: "belief_instability",
          target_id: belief.id,
          namespace: namespaceFromBeliefKey(belief.key),
          title: `High-volatility belief ${belief.key}`,
          score: belief.volatility,
          severity: issueSeverity(belief.volatility, 0.45, 0.25),
        })
      }
      for (const cluster of contradictionClusters.slice(0, max)) {
        const score = cluster.avgVolatility + Math.min(cluster.totalConflictMass, 1)
        issues.push({
          kind: "contradiction_cluster",
          target_id: cluster.id,
          namespace: cluster.namespace,
          title: `Contradiction cluster with ${cluster.beliefIds.length} beliefs`,
          score,
          severity: issueSeverity(score, 1.2, 0.6),
        })
      }
      for (const finding of reflection.topFindings.slice(0, max)) {
        issues.push({
          kind: "reflection_finding",
          target_id: finding.relatedIds[0] ?? "",
          namespace: finding.namespace,
          title: finding.title,
          score: finding.score,
          severity: finding.severity,
        })
      }
      for (const record of highSalienceRecords(recordValues, 0.70, max)) {
        issues.push({
          kind: "high_salience_record",
          target_id: record.id,
          namespace: record.namespace,
          title: `High-salience record ${previewText(record.content, 48)}`,
          score: clamp01(record.salience),
          severity: issueSeverity(clamp01(record.salience), 0.90, 0.70),
        })
      }
      for (const area of pressure.slice(0, max)) {
        issues.push({
          kind: "policy_pressure",
          target_id: area.strongestHintId,
          namespace: area.namespace,
          title: `Policy pressure in ${area.namespace}:${area.domain}`,
          score: area.advisoryPressure,
          severity: issueSeverity(area.advisoryPressure, 1.2, 0.7),
        })
      }
      issues.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.target_id.localeCompare(b.target_id))

      const saliences = recordValues.map((record) => clamp01(record.salience ?? 0))
      const totalSalience = saliences.reduce((sum, salience) => sum + salience, 0)
      const maxSalience = saliences.length === 0 ? 0 : Math.max(...saliences)

      return {
        total_records: records.size,
        startup_has_recovery_warnings: startupHasRecoveryWarnings,
        high_salience_record_count: saliences.filter((salience) => salience >= 0.70).length,
        avg_salience: saliences.length === 0 ? 0 : totalSalience / saliences.length,
        max_salience: maxSalience,
        reflection_summary_count: reflection.summaryCount,
        reflection_high_severity_findings: reflection.highSeverityFindings,
        contradiction_cluster_count: contradictionClusters.length,
        high_volatility_belief_count: instability.highVolatilityCount,
        low_stability_belief_count: instability.lowStabilityCount,
        recent_correction_count: recentCorrectionCount,
        suppressed_policy_hint_count: lifecycle.suppressedHints,
        rejected_policy_hint_count: lifecycle.rejectedHints,
        policy_pressure_area_count: pressure.length,
        maintenance_trend_direction: trendDirection,
        latest_dominant_phase: trendSummary.latestDominantPhase,
        top_issues: issues.slice(0, max),
      }
    })
  }

  namespace_governance_status(
    namespaces?: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<NamespaceGovernanceStatus>, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    return this.get_namespace_governance_status_filtered(namespaces)
  }

  get_namespace_governance_status(): Effect.Effect<ReadonlyArray<NamespaceGovernanceStatus>, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    return this.get_namespace_governance_status_filtered(undefined)
  }

  /**
   * Return read-only governance status grouped per namespace.
   * 返回按 namespace 聚合的只读治理状态。
   * Rust reference: `Aura::get_namespace_governance_status_filtered` (`../src/aura.rs`).
   */
  get_namespace_governance_status_filtered(
    namespaces?: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<NamespaceGovernanceStatus>, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    const allowed = namespaces !== undefined ? new Set(namespaces) : null
    const namespaceList = [...new Set([...this.searchRecords.values()].map((record) => record.namespace))]
      .filter((namespace) => allowed === null || allowed.has(namespace))
      .sort()
    const lastCycle = this.maintenanceTrendHistory[this.maintenanceTrendHistory.length - 1]
    const lastMaintenanceCycle = lastCycle?.timestamp ?? null
    const latestDominantPhase = lastCycle?.dominantPhase ?? "none"
    const records = this.searchRecords
    const correctionLog = this.correctionLog

    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const beliefs = yield* runtime.getBeliefs()
      const statuses: NamespaceGovernanceStatus[] = []
      for (const namespace of namespaceList) {
        const recordCount = [...records.values()].filter((record) => record.namespace === namespace).length
        const namespaceBeliefs = beliefs.filter((belief) => belief.key.startsWith(`${namespace}:`))
        const highVolatilityBeliefCount = namespaceBeliefs.filter((belief) => belief.volatility >= 0.20).length
        const lowStabilityBeliefCount = namespaceBeliefs.filter((belief) => belief.stability <= 1.0).length
        const correctionCount = correctionLog.filter((entry) =>
          namespaceForCorrection(entry, records, [], []) === namespace ||
          (entry.target_kind === "belief" && namespaceBeliefs.some((belief) => belief.id === entry.target_id))
        ).length
        const correctionDensity = recordCount === 0 ? 0 : correctionCount / recordCount
        const policyPressureAreaCount = (yield* runtime.getPolicyPressureReport(namespace, 64)).length
        const suggestedCorrectionCount = namespaceBeliefs.filter((belief) => belief.volatility >= 0.20 || belief.stability <= 1.0).length
        const instabilityScore =
          highVolatilityBeliefCount * 1.5 +
          lowStabilityBeliefCount * 1.2 +
          correctionDensity * 3.0 +
          policyPressureAreaCount * 0.8
        statuses.push({
          namespace,
          record_count: recordCount,
          belief_count: namespaceBeliefs.length,
          correction_count: correctionCount,
          correction_density: correctionDensity,
          high_volatility_belief_count: highVolatilityBeliefCount,
          low_stability_belief_count: lowStabilityBeliefCount,
          instability_score: instabilityScore,
          instability_level: issueSeverity(instabilityScore, 4.0, 1.8),
          policy_pressure_area_count: policyPressureAreaCount,
          suggested_correction_count: suggestedCorrectionCount,
          last_maintenance_cycle: lastMaintenanceCycle,
          latest_dominant_phase: latestDominantPhase,
        })
      }
      statuses.sort((a, b) => b.instability_score - a.instability_score || a.namespace.localeCompare(b.namespace))
      return statuses
    })
  }

  static recallScored(
    brainDir: string,
    query: string,
    options?: Partial<RecallPipelineOptions>,
  ) {
    return recallScoredEffect(brainDir, query, options);
  }

  static recallRecords<TRecord = unknown>(
    brainDir: string,
    query: string,
    options?: Partial<RecallPipelineOptions>,
  ) {
    return recallRecordsEffect<TRecord>(brainDir, query, options);
  }

  /**
   * Explain recall results using persisted provenance across belief/concept/causal/policy layers.
   * 使用 belief/concept/causal/policy 持久化 provenance 解释召回结果。
   * Rust reference: `Aura::explain_recall` (`../src/aura.rs`).
   */
  explain_recall(
    query: string,
    topK?: number,
    minStrength?: number,
    expandConnections?: boolean,
    namespaces?: ReadonlyArray<string>,
  ): Effect.Effect<
    RecallExplanation,
    | FileReadError
    | JsonParseError
    | FileFormatError
    | IndexFormatError
    | SdrInterpreterError
    | EmbeddingQueryError
    | RerankError
    | FinalizeError,
    FileRead | EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine
  > {
    const started = Date.now()
    const top = clampInt(topK ?? 20, 1, 100)
    const self = this
    const options: Partial<RecallPipelineOptions> = {
      topK: top,
      minStrength: minStrength ?? 0.1,
      expandConnections: expandConnections ?? true,
      namespaces: namespaces ?? ["default"],
      boundedRerankModes: self.currentBoundedRerankModes(),
    }
    return Effect.gen(function* () {
      const traced = yield* recallWithTraceEffect(
        self.brainDir,
        query,
        options,
        undefined,
        self.currentTrustConfig(),
      )
      const items: RecallExplanationItem[] = []
      for (let index = 0; index < traced.scored.length; index++) {
        const [score, recordId] = traced.scored[index]!
        const item = yield* self.buildRecallExplanationItem(
          recordId,
          index + 1,
          score,
          traced.evidence.get(recordId),
        )
        if (item !== null) items.push(item)
      }
      return {
        query,
        top_k: top,
        result_count: items.length,
        latency_ms: Date.now() - started,
        belief_rerank_mode: rustModeLabel(traced.boundedRerankReport?.modes.beliefMode, "Limited"),
        concept_surface_mode: rustModeLabel(traced.boundedRerankReport?.modes.conceptMode, "Inspect"),
        causal_rerank_mode: rustModeLabel(traced.boundedRerankReport?.modes.causalMode, "Limited"),
        policy_rerank_mode: rustModeLabel(traced.boundedRerankReport?.modes.policyMode, "Limited"),
        items,
      }
    })
  }

  /**
   * Explain a single record using current persisted provenance.
   * 用当前持久化 provenance 解释单条 record；不依赖召回排序。
   * Rust reference: `Aura::explain_record` (`../src/aura.rs`).
   */
  explain_record(
    recordId: string,
  ): Effect.Effect<
    RecallExplanationItem | null,
    never,
    EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine
  > {
    return this.buildRecallExplanationItem(recordId, 1, this.searchRecords.get(recordId)?.strength ?? 0, undefined)
  }

  provenance_chain(
    recordId: string,
  ): Effect.Effect<
    ProvenanceChain | null,
    never,
    EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine
  > {
    const started = Date.now()
    const self = this
    return Effect.gen(function* () {
      const item = yield* self.explain_record(recordId)
      return item === null ? null : buildProvenanceChain(item, Date.now() - started)
    })
  }

  /**
   * Build one bounded explainability bundle for UI/debugging.
   * 构建单条 record 的有界解释包，包含 provenance、修正摘录和运行时摘要。
   * Rust reference: `Aura::explainability_bundle` (`../src/aura.rs`).
   */
  explainability_bundle(
    recordId: string,
  ): Effect.Effect<
    ExplainabilityBundle | null,
    never,
    EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine
  > {
    const self = this
    return Effect.gen(function* () {
      const explanation = yield* self.explain_record(recordId)
      if (explanation === null) return null
      const provenance = buildProvenanceChain(explanation, 0)
      const beliefInstability = yield* self.get_belief_instability_summary()
      return {
        record_id: recordId,
        explanation,
        provenance,
        record_corrections: self.get_correction_log_for_target("record", recordId),
        belief_corrections: explanation.belief === null
          ? []
          : self.get_correction_log_for_target("belief", explanation.belief.id),
        causal_corrections: explanation.causal_patterns.flatMap((pattern) =>
          self.get_correction_log_for_target("causal_pattern", pattern.id)
        ),
        policy_corrections: explanation.policy_hints.flatMap((hint) =>
          self.get_correction_log_for_target("policy_hint", hint.id)
        ),
        belief_instability: beliefInstability,
        reflection_digest: self.get_reflection_digest(8),
        related_reflection_findings: self.relatedReflectionFindings(recordId, explanation.namespace, 8),
        maintenance_trends: self.get_maintenance_trend_summary(),
      }
    })
  }

  /**
   * Soft-deprecate a belief so it no longer acts as a confident winner.
   * 软废弃 belief，使其不再作为 confident winner。
   * Rust reference: `Aura::deprecate_belief` (`../src/aura.rs`).
   */
  deprecate_belief(
    beliefId: string,
  ): Effect.Effect<boolean, FileWriteError, BeliefEngine | BeliefStore | FileWrite> {
    return this.deprecate_belief_with_reason(beliefId, "manual_deprecation")
  }

  /**
   * Soft-deprecate a belief and append an in-memory correction-log entry.
   * 软废弃 belief 并追加内存 correction log；与 Rust runtime Vec<CorrectionLogEntry> 模型对齐。
   * Rust reference: `Aura::deprecate_belief_with_reason` (`../src/aura.rs`).
   */
  deprecate_belief_with_reason(
    beliefId: string,
    reason: string,
  ): Effect.Effect<boolean, FileWriteError, BeliefEngine | BeliefStore | FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const engine = yield* Effect.service(BeliefEngine)
      const store = yield* Effect.service(BeliefStore)
      const before = yield* engine.stats()
      if (before.beliefs[beliefId] === undefined) return false
      yield* engine.deprecate_belief(beliefId)
      const after = yield* engine.stats()
      yield* store.save(after)
      const clock = yield* Clock
      self.appendCorrectionLogEntry(clock.nowSeconds(), "belief", beliefId, "deprecate", reason)
      return true
    })
  }

  /**
   * Invalidate a single causal pattern while preserving its tombstone.
   * 使单个 causal pattern 失效，同时保留 tombstone。
   * Rust reference: `Aura::invalidate_causal_pattern` (`../src/aura.rs`).
   */
  invalidate_causal_pattern(
    patternId: string,
  ): Effect.Effect<boolean, FileWriteError, CausalEngine | CausalStore | FileWrite> {
    return this.invalidate_causal_pattern_with_reason(patternId, "manual_invalidation")
  }

  /**
   * Invalidate a causal pattern and preserve the reason in the correction log.
   * 使 causal pattern 失效，并在 correction log 中保留原因。
   * Rust reference: `Aura::invalidate_causal_pattern_with_reason` (`../src/aura.rs`).
   */
  invalidate_causal_pattern_with_reason(
    patternId: string,
    reason: string,
  ): Effect.Effect<boolean, FileWriteError, CausalEngine | CausalStore | FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const engine = yield* Effect.service(CausalEngine)
      const store = yield* Effect.service(CausalStore)
      const before = yield* engine.stats()
      if (before.patterns[patternId] === undefined) return false
      yield* engine.invalidate_pattern(patternId)
      const after = yield* engine.stats()
      yield* store.save(after)
      const clock = yield* Clock
      self.appendCorrectionLogEntry(clock.nowSeconds(), "causal_pattern", patternId, "invalidate", reason)
      return true
    })
  }

  /**
   * Legacy compatibility alias: causal retraction now preserves an invalidated tombstone.
   * 旧兼容别名：causal retraction 现在保留 invalidated tombstone。
   * Rust reference: `Aura::retract_causal_pattern` (`../src/aura.rs`).
   */
  retract_causal_pattern(
    patternId: string,
  ): Effect.Effect<boolean, FileWriteError, CausalEngine | CausalStore | FileWrite> {
    return this.invalidate_causal_pattern_with_reason(patternId, "manual_retraction")
  }

  /**
   * Legacy compatibility alias: causal retraction now preserves an invalidated tombstone.
   * 旧兼容别名：causal retraction 现在保留 invalidated tombstone。
   * Rust reference: `Aura::retract_causal_pattern_with_reason` (`../src/aura.rs`).
   */
  retract_causal_pattern_with_reason(
    patternId: string,
    reason: string,
  ): Effect.Effect<boolean, FileWriteError, CausalEngine | CausalStore | FileWrite> {
    return this.invalidate_causal_pattern_with_reason(patternId, reason)
  }

  /**
   * Retract a single policy hint from persisted runtime state.
   * 从持久化 runtime state 中撤回单个 policy hint。
   * Rust reference: `Aura::retract_policy_hint` (`../src/aura.rs`).
   */
  retract_policy_hint(
    hintId: string,
  ): Effect.Effect<boolean, FileWriteError, PolicyEngine | PolicyStore | FileWrite> {
    return this.retract_policy_hint_with_reason(hintId, "manual_retraction")
  }

  /**
   * Retract a policy hint and append an in-memory correction-log entry.
   * 撤回 policy hint 并追加内存 correction log。
   * Rust reference: `Aura::retract_policy_hint_with_reason` (`../src/aura.rs`).
   */
  retract_policy_hint_with_reason(
    hintId: string,
    reason: string,
  ): Effect.Effect<boolean, FileWriteError, PolicyEngine | PolicyStore | FileWrite> {
    const self = this
    return Effect.gen(function* () {
      const engine = yield* Effect.service(PolicyEngine)
      const store = yield* Effect.service(PolicyStore)
      const before = yield* engine.stats()
      if (before.hints[hintId] === undefined) return false
      yield* engine.retract_hint(hintId)
      const after = yield* engine.stats()
      yield* store.save(after)
      const clock = yield* Clock
      self.appendCorrectionLogEntry(clock.nowSeconds(), "policy_hint", hintId, "retract", reason)
      return true
    })
  }

  correction_log(): ReadonlyArray<CorrectionLogEntry> {
    return this.get_correction_log()
  }

  get_correction_log(): ReadonlyArray<CorrectionLogEntry> {
    return this.correctionLog.slice()
  }

  get_correction_log_for_target(
    targetKind: string,
    targetId: string,
  ): ReadonlyArray<CorrectionLogEntry> {
    return this.correctionLog.filter((entry) => entry.target_kind === targetKind && entry.target_id === targetId)
  }

  correction_review_queue(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<CorrectionReviewCandidate>, never, BeliefEngine | CausalEngine | PolicyEngine> {
    return this.get_correction_review_queue(limit)
  }

  /**
   * Return correction candidates sorted by repeated correction pressure, recency, and downstream impact.
   * 返回按重复修正压力、新近度和下游影响排序的 correction review 队列。
   * Rust reference: `Aura::get_correction_review_queue` (`../src/aura.rs`).
   */
  get_correction_review_queue(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<CorrectionReviewCandidate>, never, BeliefEngine | CausalEngine | PolicyEngine> {
    const max = clampInt(limit ?? 10, 1, 50)
    const records = this.searchRecords
    const corrections = this.correctionLog.slice().sort((a, b) => b.timestamp - a.timestamp)
    return Effect.gen(function* () {
      if (corrections.length === 0) return []
      const belief = yield* Effect.service(BeliefEngine)
      const causal = yield* Effect.service(CausalEngine)
      const policy = yield* Effect.service(PolicyEngine)
      const beliefs = Object.values((yield* belief.stats()).beliefs)
      const causalPatterns = Object.values((yield* causal.stats()).patterns)
      const policyHints = Object.values((yield* policy.stats()).hints)
      const repeatCounts = new Map<string, number>()
      for (const entry of corrections) {
        const key = `${entry.target_kind}:${entry.target_id}`
        repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1)
      }
      const total = Math.max(corrections.length, 1)
      const queue = corrections.map((entry, index) => {
        const dependentCausalPatterns = dependentCausalCount(entry, causalPatterns)
        const dependentPolicyHints = dependentPolicyCount(entry, policyHints)
        const downstreamImpact = dependentCausalPatterns + dependentPolicyHints
        const repeatCount = repeatCounts.get(`${entry.target_kind}:${entry.target_id}`) ?? 1
        const recencyScore = clamp(1 - (index / total) * 0.85, 0.15, 1)
        const priorityScore = downstreamImpact * 1.6 + Math.max(0, repeatCount - 1) * 0.9 + recencyScore
        return {
          timestamp: entry.timestamp,
          time_iso: entry.time_iso,
          target_kind: entry.target_kind,
          target_id: entry.target_id,
          operation: entry.operation,
          reason: entry.reason,
          session_id: entry.session_id,
          namespace: namespaceForCorrectionWithBeliefs(entry, records, beliefs, causalPatterns, policyHints),
          title: `Review ${entry.operation} ${entry.target_kind} (${entry.reason})`,
          repeat_count: repeatCount,
          dependent_causal_patterns: dependentCausalPatterns,
          dependent_policy_hints: dependentPolicyHints,
          downstream_impact: downstreamImpact,
          priority_score: priorityScore,
          severity: issueSeverity(priorityScore, 5.0, 2.5),
        }
      })
      queue.sort((a, b) =>
        b.priority_score - a.priority_score ||
        b.timestamp - a.timestamp ||
        a.target_kind.localeCompare(b.target_kind) ||
        a.target_id.localeCompare(b.target_id)
      )
      return queue.slice(0, max)
    })
  }

  contradiction_review_queue(
    namespace?: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<ContradictionReviewCandidate>, never, EpistemicRuntime | BeliefEngine | CausalEngine | PolicyEngine> {
    return this.get_contradiction_review_queue(namespace, limit)
  }

  /**
   * Reuse EpistemicRuntime contradiction clusters and add Rust-style review prioritization.
   * 复用 EpistemicRuntime contradiction clusters，并添加 Rust 风格 review 排序层。
   * Rust reference: `Aura::get_contradiction_review_queue` (`../src/aura.rs`).
   */
  get_contradiction_review_queue(
    namespace?: string,
    limit?: number,
  ): Effect.Effect<ReadonlyArray<ContradictionReviewCandidate>, never, EpistemicRuntime | BeliefEngine | CausalEngine | PolicyEngine> {
    const max = clampInt(limit ?? 10, 1, 50)
    const records = this.searchRecords
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const causal = yield* Effect.service(CausalEngine)
      const policy = yield* Effect.service(PolicyEngine)
      const clusters = yield* runtime.getContradictionClusters(records, namespace, max * 3)
      const causalPatterns = Object.values((yield* causal.stats()).patterns)
      const policyHints = Object.values((yield* policy.stats()).hints)
      const queue = clusters.map((cluster) => {
        const dependentCausalPatterns = causalPatterns.filter((pattern) =>
          isActiveCausalPattern(pattern) &&
          cluster.beliefIds.some((beliefId) => pattern.cause_belief_id === beliefId || pattern.effect_belief_id === beliefId)
        ).length
        const dependentPolicyHints = policyHints.filter((hint) =>
          hint.state !== "Rejected" &&
          cluster.beliefKeys.some((beliefKey) => hint.cause_key.includes(beliefKey))
        ).length
        const downstreamImpact = dependentCausalPatterns + dependentPolicyHints
        const priorityScore = Math.min(
          10,
          cluster.avgVolatility * 4 +
            Math.min(cluster.totalConflictMass, 2) +
            cluster.unresolvedBeliefCount * 0.8 +
            cluster.highVolatilityBeliefCount * 0.6 +
            downstreamImpact * 0.9 +
            (1.5 - Math.min(cluster.avgStability, 1.5)),
        )
        return {
          cluster_id: cluster.id,
          namespace: cluster.namespace,
          title: `Review contradiction cluster in ${cluster.namespace} (${cluster.beliefIds.length} beliefs, ${cluster.recordIds.length} records)`,
          belief_ids: cluster.beliefIds,
          belief_keys: cluster.beliefKeys,
          record_ids: cluster.recordIds,
          shared_tags: cluster.sharedTags,
          unresolved_belief_count: cluster.unresolvedBeliefCount,
          high_volatility_belief_count: cluster.highVolatilityBeliefCount,
          dependent_causal_patterns: dependentCausalPatterns,
          dependent_policy_hints: dependentPolicyHints,
          downstream_impact: downstreamImpact,
          total_conflict_mass: cluster.totalConflictMass,
          avg_volatility: cluster.avgVolatility,
          avg_stability: cluster.avgStability,
          priority_score: priorityScore,
          severity: issueSeverity(priorityScore, 5.0, 2.5),
        }
      })
      queue.sort((a, b) =>
        b.priority_score - a.priority_score ||
        b.downstream_impact - a.downstream_impact ||
        b.unresolved_belief_count - a.unresolved_belief_count ||
        a.cluster_id.localeCompare(b.cluster_id)
      )
      return queue.slice(0, max)
    })
  }

  suggested_corrections(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<SuggestedCorrection>, never, EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine> {
    return this.get_suggested_corrections(limit)
  }

  /**
   * Return bounded suggested corrections without auto-applying them.
   * 返回有界建议修正，不自动执行。
   * Rust reference: `Aura::get_suggested_corrections` (`../src/aura.rs`).
   */
  get_suggested_corrections(
    limit?: number,
  ): Effect.Effect<ReadonlyArray<SuggestedCorrection>, never, EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine> {
    const self = this
    return Effect.gen(function* () {
      const report = yield* self.get_suggested_corrections_report(limit)
      return report.entries
    })
  }

  /**
   * Return bounded advisory corrections without auto-applying them.
   *
   * This advisory surface combines instability, lifecycle state, and review pressure.
   * 返回带 scan latency 的有界建议修正；该 advisory surface 组合 instability、lifecycle state 与 review pressure。
   * Rust reference: `Aura::get_suggested_corrections_report` (`../src/aura.rs`).
   */
  get_suggested_corrections_report(
    limit?: number,
  ): Effect.Effect<SuggestedCorrectionsReport, never, EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine> {
    const max = clampInt(limit ?? 10, 1, 50)
    const self = this
    return Effect.gen(function* () {
      const started = Date.now()
      const runtime = yield* Effect.service(EpistemicRuntime)
      const highVolatility = yield* runtime.getHighVolatilityBeliefs(0.2, max * 2)
      const lowStability = yield* runtime.getLowStabilityBeliefs(1.0, max * 2)
      const contradictionQueue = yield* self.get_contradiction_review_queue(undefined, max)
      const suggestions = new Map<string, SuggestedCorrection>()

      const upsert = (candidate: SuggestedCorrection) => {
        const key = `${candidate.target_kind}:${candidate.target_id}`
        const existing = suggestions.get(key)
        if (existing === undefined || existing.priority_score < candidate.priority_score) {
          suggestions.set(key, candidate)
        }
      }

      for (const belief of highVolatility) {
        const recordId = firstRecordForBelief(belief, self.searchRecords)
        const provenance = recordId === null ? null : yield* self.provenance_chain(recordId)
        const score = belief.volatility * 4
        upsert({
          target_kind: "belief",
          target_id: belief.id,
          namespace: namespaceFromBeliefKey(belief.key),
          reason_kind: "HighVolatility",
          suggested_action: "Deprecate",
          reason_detail: `belief volatility ${belief.volatility.toFixed(2)} exceeded bounded review threshold`,
          priority_score: score,
          severity: issueSeverity(score, 3.8, 2.2),
          supporting_record_id: recordId,
          provenance,
        })
      }

      for (const belief of lowStability) {
        const recordId = firstRecordForBelief(belief, self.searchRecords)
        const score = Math.max(0, 2 - belief.stability) * 1.5
        if (score <= 0) continue
        const provenance = recordId === null ? null : yield* self.provenance_chain(recordId)
        upsert({
          target_kind: "belief",
          target_id: belief.id,
          namespace: namespaceFromBeliefKey(belief.key),
          reason_kind: "LowStability",
          suggested_action: "Review",
          reason_detail: `belief stability ${belief.stability.toFixed(2)} is low`,
          priority_score: score,
          severity: issueSeverity(score, 3.8, 2.2),
          supporting_record_id: recordId,
          provenance,
        })
      }

      for (const candidate of contradictionQueue) {
        const recordId = candidate.record_ids[0] ?? null
        const provenance = recordId === null ? null : yield* self.provenance_chain(recordId)
        upsert({
          target_kind: "belief",
          target_id: candidate.belief_ids[0] ?? candidate.cluster_id,
          namespace: candidate.namespace,
          reason_kind: "ContradictionCluster",
          suggested_action: "ReviewContradiction",
          reason_detail: candidate.title,
          priority_score: candidate.priority_score,
          severity: candidate.severity,
          supporting_record_id: recordId,
          provenance,
        })
      }

      return {
        scan_latency_ms: Date.now() - started,
        entries: [...suggestions.values()]
          .sort((a, b) => b.priority_score - a.priority_score || a.target_kind.localeCompare(b.target_kind) || a.target_id.localeCompare(b.target_id))
          .slice(0, max),
      }
    })
  }

  get_maintenance_trend_summary(): McpMaintenanceTrendSummary {
    return toMcpMaintenanceTrendSummary(summarizeTrends(this.maintenanceTrendHistory))
  }

  /**
   * Return the bounded persisted maintenance trend history.
   * 返回有界持久化 maintenance trend history。
   *
   * Rust reference: `Aura::get_maintenance_trend_history` (`../src/aura.rs`).
   */
  get_maintenance_trend_history(): ReadonlyArray<McpMaintenanceTrendSnapshot> {
    return this.maintenanceTrendHistory.map(toMcpMaintenanceTrendSnapshot)
  }

  /**
   * Return the bounded persisted reflection history.
   * 返回有界持久化 reflection history，最新项在前。
   *
   * Rust reference: `Aura::get_reflection_summaries` (`../src/aura.rs`).
   */
  get_reflection_summaries(limit?: number): ReadonlyArray<McpReflectionSummary> {
    const max = clampInt(limit ?? 8, 1, 32)
    return this.reflectionSummaries
      .slice(-max)
      .reverse()
      .map(toMcpReflectionSummary)
  }

  /**
   * Return the latest persisted reflection digest, if any.
   * 返回最近一次持久化 reflection digest；不存在则返回 null。
   *
   * Rust reference: `Aura::get_latest_reflection_digest` (`../src/aura.rs`).
   */
  get_latest_reflection_digest(): McpReflectionSummary | null {
    const latest = this.reflectionSummaries[this.reflectionSummaries.length - 1]
    return latest === undefined ? null : toMcpReflectionSummary(latest)
  }

  /**
   * Return a bounded aggregated digest across recent reflection summaries.
   * 返回最近 reflection summaries 的有界聚合 digest。
   *
   * Rust reference: `Aura::get_reflection_digest` (`../src/aura.rs`).
   */
  get_reflection_digest(limit?: number): McpReflectionDigest {
    const max = clampInt(limit ?? 8, 1, 32)
    const digest = summarizeReflections(this.reflectionSummaries.slice(-max))
    return {
      summary_count: digest.summaryCount,
      total_findings: digest.totalFindings,
      high_severity_findings: digest.highSeverityFindings,
      latest_timestamp: digest.latestTimestamp,
      latest_dominant_phase: digest.latestDominantPhase,
      kinds: digest.kinds.map((kind) => ({
        kind: kind.kind,
        count: kind.count,
        high_severity_count: kind.highSeverityCount,
        avg_score: kind.avgScore,
      })),
      namespaces: digest.namespaces,
      top_findings: digest.topFindings.map(toMcpReflectionFinding),
    }
  }

  /**
   * Return the current persistence manifest describing versioned persisted surfaces.
   * 返回当前持久化 manifest，描述各持久化 surface 的版本。
   *
   * Rust reference: `Aura::get_persistence_manifest` (`../src/aura.rs`).
   */
  get_persistence_manifest(): PersistenceManifest {
    return {
      schema_version: this.persistenceManifest.schema_version,
      surfaces: { ...this.persistenceManifest.surfaces },
    }
  }

  /**
   * Return the startup validation and recovery report for the current runtime.
   * 返回当前 runtime 的启动验证与恢复报告。
   *
   * NON-PARITY IMPLEMENTATION: TS validates persisted surface files during `Aura.open`,
   * while engine hydration still belongs to Effect Layers rather than this Aura instance.
   * Rust reference: `Aura::get_startup_validation_report` (`../src/aura.rs`).
   */
  get_startup_validation_report(): StartupValidationReport {
    return {
      loaded_surfaces: this.startupValidationReport.loaded_surfaces,
      missing_fallbacks: this.startupValidationReport.missing_fallbacks,
      recovered_fallbacks: this.startupValidationReport.recovered_fallbacks,
      derived_skips: this.startupValidationReport.derived_skips,
      has_recovery_warnings: this.startupValidationReport.has_recovery_warnings,
      events: this.startupValidationReport.events.map((event) => ({ ...event })),
    }
  }

  private relatedReflectionFindings(
    recordId: string,
    namespace: string,
    limit: number,
  ): ReadonlyArray<McpReflectionFinding> {
    return this.reflectionSummaries
      .flatMap((summary) => summary.findings)
      .filter((finding) => finding.relatedIds.includes(recordId) || finding.namespace === namespace)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, limit)
      .map(toMcpReflectionFinding)
  }

  private appendCorrectionLogEntry(
    timestampSeconds: number,
    targetKind: string,
    targetId: string,
    operation: string,
    reason: string,
  ): void {
    const timestamp = Math.trunc(timestampSeconds)
    this.correctionLog.push({
      timestamp,
      time_iso: new Date(timestamp * 1000).toISOString(),
      target_kind: targetKind,
      target_id: targetId,
      operation,
      reason,
      session_id: "ts-core",
    })
  }

  private buildRecallExplanationItem(
    recordId: string,
    rank: number,
    score: number,
    evidence: RecallRecordEvidence | undefined,
  ): Effect.Effect<
    RecallExplanationItem | null,
    never,
    EpistemicRuntime | BeliefEngine | ConceptEngine | CausalEngine | PolicyEngine
  > {
    const record = this.searchRecords.get(recordId)
    if (record === undefined) return Effect.succeed(null)
    const records = this.searchRecords
    const corrections = this.correctionLog
    const reflections = this.reflectionSummaries
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const belief = yield* runtime.getBeliefForRecord(recordId)
      const concepts = yield* runtime.getConcepts()
      const causalPatterns = yield* runtime.getCausalPatterns()
      const policyHints = yield* runtime.getPolicyHints()

      const beliefExplanation: RecallBeliefExplanation | null = belief === null
        ? null
        : {
            id: belief.id,
            state: belief.state.toLowerCase(),
            confidence: belief.confidence,
            support_mass: belief.support_mass,
            conflict_mass: belief.conflict_mass,
            stability: belief.stability,
            volatility: belief.volatility,
            has_unresolved_evidence:
              belief.state === "Unresolved" ||
              belief.state === "Empty" ||
              belief.volatility >= 0.2 ||
              belief.conflict_mass > belief.support_mass,
          }
      const beliefId = beliefExplanation?.id ?? null
      const hasUnresolvedEvidence = beliefExplanation?.has_unresolved_evidence ?? false
      const contradictionDependency =
        beliefExplanation !== null &&
        (beliefExplanation.conflict_mass > 0 || beliefExplanation.has_unresolved_evidence)

      const conceptExplanations: RecallConceptExplanation[] = concepts
        .filter((concept) =>
          concept.record_ids.includes(recordId) ||
          (beliefId !== null && concept.belief_ids.includes(beliefId))
        )
        .sort((a, b) => b.confidence - a.confidence || a.key.localeCompare(b.key))
        .map((concept) => ({
          id: concept.id,
          key: concept.key,
          state: concept.state.toLowerCase(),
          confidence: concept.confidence,
        }))

      const causalExplanations: RecallCausalExplanation[] = causalPatterns
        .filter((pattern) =>
          pattern.cause_record_ids.includes(recordId) ||
          pattern.effect_record_ids.includes(recordId) ||
          (beliefId !== null && (pattern.cause_belief_id === beliefId || pattern.effect_belief_id === beliefId))
        )
        .sort((a, b) => b.causal_strength - a.causal_strength || a.id.localeCompare(b.id))
        .map((pattern) => ({
          id: pattern.id,
          key: `${pattern.cause_key}:${pattern.effect_key}`,
          state: pattern.state.toLowerCase(),
          causal_strength: pattern.causal_strength,
          invalidation_reason: latestCorrectionReason(corrections, "causal_pattern", pattern.id, "invalidate"),
          invalidated_at: latestCorrectionTimestamp(corrections, "causal_pattern", pattern.id, "invalidate"),
          corrections: corrections.filter((entry) => entry.target_kind === "causal_pattern" && entry.target_id === pattern.id),
        }))

      const policyExplanations: RecallPolicyExplanation[] = policyHints
        .filter((hint) =>
          hint.cause_record_ids.includes(recordId) ||
          hint.effect_keys.includes(recordId) ||
          (belief !== null && hint.cause_key.includes(belief.key))
        )
        .sort((a, b) => b.policyStrength - a.policyStrength || a.id.localeCompare(b.id))
        .map((hint) => ({
          id: hint.id,
          key: hint.cause_key,
          state: hint.state.toLowerCase(),
          action_kind: hint.actionKind,
          policy_strength: hint.policyStrength,
        }))

      const becauseRecordId = typeof record.caused_by_id === "string" ? record.caused_by_id : null
      const becausePreview = becauseRecordId === null
        ? null
        : previewText(records.get(becauseRecordId)?.content ?? "", 120)
      const reflectionReferences = reflections
        .flatMap((summary) => summary.findings)
        .filter((finding) => finding.relatedIds.includes(recordId) || finding.namespace === record.namespace)
        .map((finding) => finding.title)
      const uniqueReflectionReferences = sortedUnique(reflectionReferences).slice(0, 4)
      const honestyNote = hasUnresolvedEvidence
        ? (policyExplanations.length > 0
            ? "This recommendation depends on unresolved evidence."
            : "This memory is linked to unstable or conflicting evidence.")
        : null
      const salience = clamp01(record.salience ?? 0)
      const salienceReason = record.metadata[RECORD_SALIENCE_REASON_KEY] ?? null
      const salienceExplanation = salience > 0
        ? "This memory carries non-zero significance weighting."
        : null

      return {
        rank,
        record_id: record.id,
        score,
        namespace: record.namespace,
        salience,
        salience_reason: salienceReason,
        salience_explanation: salienceExplanation,
        content_preview: previewText(record.content, 160),
        because_record_id: becauseRecordId,
        because_preview: becausePreview,
        belief: beliefExplanation,
        has_unresolved_evidence: hasUnresolvedEvidence,
        honesty_note: honestyNote,
        contradiction_dependency: contradictionDependency,
        reflection_references: uniqueReflectionReferences,
        answer_support: {
          significance_phrase: salienceExplanation,
          uncertainty_phrase: honestyNote,
          contradiction_phrase: contradictionDependency
            ? "This answer should acknowledge conflicting or unresolved evidence."
            : null,
          reflection_phrase: uniqueReflectionReferences.length === 0
            ? null
            : `Recent reflection findings touching this area: ${uniqueReflectionReferences.join(", ")}.`,
          recommended_framing: hasUnresolvedEvidence
            ? "State the useful evidence, then explicitly note uncertainty or conflict."
            : "State the answer directly without anthropomorphic language.",
        },
        concepts: conceptExplanations,
        causal_patterns: causalExplanations,
        policy_hints: policyExplanations,
        trace: toRecallTraceScore(evidence, score),
      }
    })
  }

  runMaintenance(
    config?: MaintenanceConfig
  ) {
    const cfg = config ?? this.maintenanceConfig
    const dir = this.brainDir

    const self = this
    return Effect.gen(function* () {
      const records = yield* self.refreshSearchViewFromDisk()
      const trace = yield* Effect.service(EpistemicTrace)
      yield* trace.event("maintenance.start", { records: records.size })

      // ── Get engines and stores from Effect context ──
      const beliefEng = yield* Effect.service(BeliefEngine)
      const conceptEng = yield* Effect.service(ConceptEngine)
      const causalEng = yield* Effect.service(CausalEngine)
      const policyEng = yield* Effect.service(PolicyEngine)
      yield* causalEng.set_temporal_budget_mode(self.causalTemporalBudgetMode)
      yield* causalEng.set_evidence_mode(self.causalEvidenceMode)

      const beliefStore = yield* Effect.service(BeliefStore)
      const conceptStore = yield* Effect.service(ConceptStore)
      const causalStore = yield* Effect.service(CausalStore)
      const policyStore = yield* Effect.service(PolicyStore)

      // ── Create buffer/state Refs ──
      const sdrLookupCache = yield* Ref.make(new Map<string, ReadonlyArray<number>>())
      const prevBeliefKeys = yield* Ref.make(new Set<string>())
      const prevConceptKeys = yield* Ref.make(new Set<string>())
      const prevCausalKeys = yield* Ref.make(new Set<string>())
      const prevPolicyKeys = yield* Ref.make(new Set<string>())

      // ── Create counters ──
      const counters: ConceptSurfaceCounters = {
        globalCalls: yield* Ref.make(0),
        namespaceCalls: yield* Ref.make(0),
        recordCalls: yield* Ref.make(0),
        conceptsReturned: yield* Ref.make(0),
        recordAnnotationsReturned: yield* Ref.make(0),
      }

      // ── Build records map ──
      // runMaintenance owns the contract Record boundary through brain.cog/brain.snap.
      // runMaintenance 通过 brain.cog/brain.snap 维护 contract Record 边界，不再使用 BrainAuraRecord[]。
      const cognitiveStore = yield* CognitiveStoreFile.open(dir)
      const cognitiveStoreAdapter = createCognitiveStoreAdapter(cognitiveStore)
      const taxonomy = createDefaultTagTaxonomy()
      const sdrInterpreter = yield* makeMaintenanceSdrInterpreter()

      // ── Initialize timings and hotspots ──
      const timings: PhaseTimings = {
        levelFixMs: 0, decayMs: 0, reflectMs: 0, epistemicMs: 0,
        insightsMs: 0, sdrBuildMs: 0, beliefMs: 0, conceptMs: 0,
        causalMs: 0, policyMs: 0, consolidationMs: 0, crossConnectionsMs: 0,
        tasksArchivalMs: 0, totalMs: 0,
      }

      const hotspots: MaintenanceHotspots = {
        recordsBeforeCycle: records.size, recordsAfterCycle: records.size,
        beliefSnapshotRecords: records.size, sdrSourceBytes: 0,
        sdrVectorsBuilt: 0, sdrVectorsComputed: 0, sdrVectorsReused: 0,
        beliefTotalBeliefs: 0, beliefTotalHypotheses: 0,
        conceptPairwiseComparisons: 0, conceptPartitionsWithMultipleSeeds: 0,
        causalEdgesFound: 0, causalExplicitEdgesFound: 0,
        causalTemporalEdgesFound: 0, causalTemporalNamespacesScanned: 0,
        causalTemporalPairsConsidered: 0, causalTemporalPairsSkippedByBudget: 0,
        causalTemporalEdgesCapped: 0, causalTemporalNamespacesHitCap: 0,
        policySeedsFound: 0, crossConnectionsFound: 0, taskRemindersFound: 0,
        dominantPhase: "", dominantPhaseMs: 0, dominantPhaseShare: 0,
      }

      const t0 = Date.now()
      const timestamp = new Date().toISOString()

      // ── Phase 1: Initial phases ──
      const initial = yield* runInitialPhases(
        records, cfg,
        taxonomy,
        cognitiveStoreAdapter,
        0, timings, hotspots
      )

      // ── Phase 2: SDR lookup ──
      const sdrLookup = yield* buildSdrLookup(
        sdrInterpreter,
        sdrLookupCache, records, timings, hotspots
      )

      // ── Phase 3: Layer stability ──
      const stability = yield* computeLayerStability(
        beliefEng, conceptEng, causalEng, policyEng,
        prevBeliefKeys, prevConceptKeys, prevCausalKeys, prevPolicyKeys
      )

      // ── Phase 4: Discovery phases ──
      const discovery = yield* runDiscoveryPhases(
        beliefEng, beliefStore, conceptEng, conceptStore,
        causalEng, causalStore, policyEng, policyStore,
        records, sdrLookup, timings, hotspots
      )

      // ── Phase 5: Post-discovery phases ──
      const postDiscovery = yield* runPostDiscoveryPhases(
        records,
        createNGramIndex(records),
        new Map(), // tagIndex
        new Map(), // auraIndex
        cognitiveStoreAdapter,
        DefaultBackgroundBrain,
        cfg,
        taxonomy,
        timings, hotspots
      )

      // ── Phase 6: Finalize telemetry ──
      const telemetry = yield* finalizeTelemetry(
        timings, hotspots, Csm.Inspect, conceptEng, counters
      )

      // ── Phase 7: Trends ──
      const trendHistory = self.maintenanceTrendHistory
      const previousCumulativeCorrections = trendHistory[trendHistory.length - 1]?.cumulativeCorrections ?? 0
      const cumulativeCorrections = self.correctionLog.length
      const snapshot = buildTrendSnapshot(
        timestamp, records.size, postDiscovery.recordsArchived,
        initial.insightsFound, initial.epistemic,
        discovery.belief, discovery.causal, discovery.policy,
        discovery.feedback, timings, hotspots, cumulativeCorrections, previousCumulativeCorrections
      )
      yield* pushTrendSnapshot(trendHistory, snapshot)
      const trendSummary = summarizeTrends(trendHistory)
      // NON-PARITY IMPLEMENTATION: TS mirrors Rust in-memory maintenance history to JSON for reopen/introspection.
      // Rust keeps runtime history as source of truth and persists it through Aura helpers.
      yield* MaintenanceTrendsFile.new(dir).save(trendHistory.map(toMcpMaintenanceTrendSnapshot))

      // ── Phase 8: Reflection ──
      const contradictionClusters: ContradictionCluster[] = []
      const reflection = yield* buildReflectionSummary(
        timestamp, records, cfg.taskTag,
        contradictionClusters, trendSummary, hotspots
      )
      yield* pushReflectionSummary(self.reflectionSummaries, reflection)
      // NON-PARITY IMPLEMENTATION: TS mirrors Rust in-memory reflection summaries to JSON for reopen/introspection.
      // Rust reference: Aura::save_reflection_summaries.
      yield* ReflectionSummariesFile.new(dir).save(self.reflectionSummaries.map(toMcpReflectionSummary))

      // ── Total timing ──
      const timingsMut = timings as { totalMs: number }
      timingsMut.totalMs = Date.now() - t0

      yield* trace.event("maintenance.end", {
        totalMs: timings.totalMs,
        dominantPhase: hotspots.dominantPhase,
      })

      self.searchRecords = new Map(records)

      return {
        timestamp,
        decay: initial.decay,
        reflect: initial.reflect,
        epistemic: initial.epistemic,
        insightsFound: initial.insightsFound,
        belief: discovery.belief,
        concept: discovery.concept,
        causal: discovery.causal,
        policy: discovery.policy,
        feedback: discovery.feedback,
        consolidation: postDiscovery.consolidation,
        crossConnections: postDiscovery.crossConnections,
        taskReminders: postDiscovery.taskReminders,
        recordsArchived: postDiscovery.recordsArchived,
        totalRecords: records.size,
        experienceInjected: 0,
        timings,
        stability,
        conceptSurface: telemetry,
        reflection,
        trendSummary,
        hotspots,
      } as MaintenanceReport
    })
  }

  private refreshSearchViewFromDisk(): Effect.Effect<
    Map<string, AuraRecord>,
    FileReadError | FileFormatError,
    FileRead
  > {
    const dir = this.brainDir
    const self = this
    return Effect.gen(function* () {
      const records = yield* loadCognitiveRecords(dir)
      self.searchRecords = new Map(records)
      return records
    })
  }

  private replaceSearchRecord(record: AuraRecord): void {
    this.searchRecords = new Map(this.searchRecords).set(record.id, record)
  }

  /**
   * Rust auto_connect mutates the in-memory records map before append_store.
   * TS mirrors that visibility without appending synthetic Update records.
   * Rust reference: `graph::auto_connect` (`../src/graph.rs`), `Aura::store` (`../src/aura.rs`).
   */
  private autoConnectRecord(record: AuraRecord): AuraRecord {
    if (record.tags.length === 0) return record

    const connections: { [recordId: string]: number } = { ...record.connections }
    const connectionTypes: { [recordId: string]: string } = { ...record.connection_types }

    for (const candidate of [...this.searchRecords.values()]) {
      if (Object.keys(connections).length >= MAX_AUTO_CONNECTIONS) break
      if (candidate.id === record.id) continue
      if (candidate.namespace !== record.namespace) continue

      const sharedCount = sharedTagCount(record.tags, candidate.tags)
      if (sharedCount === 0) continue

      const weight = Math.min(0.2 + 0.15 * sharedCount, 0.8)
      connections[candidate.id] = weight
      connectionTypes[candidate.id] = "associative"

      if (Object.keys(candidate.connections).length < MAX_AUTO_CONNECTIONS) {
        this.replaceSearchRecord({
          ...candidate,
          connections: { ...candidate.connections, [record.id]: weight },
          connection_types: {
            ...candidate.connection_types,
            [record.id]: "associative",
          },
        })
      }
    }

    return {
      ...record,
      connections,
      connection_types: connectionTypes,
    }
  }

  private removeSearchRecord(recordId: string): void {
    const next = new Map(this.searchRecords)
    next.delete(recordId)
    this.searchRecords = next
  }

  /**
   * UNIMPLEMENTED: relation/entity graph APIs are recoverably unsupported for now.
   * Reason: TS does not have the relation graph store/index yet; returning dummy values would hide missing capability.
   * Rust reference: `Aura::get_entity_digest` (`../src/aura.rs`).
   */
  get_entity_digest(..._args: ReadonlyArray<unknown>) {
    return unsupportedSurface("Aura.get_entity_digest", "Aura::get_entity_digest (aura.rs)", [
      "Relation graph store",
      "Entity digest read model",
    ])
  }

  /**
   * UNIMPLEMENTED: relation/entity graph APIs are recoverably unsupported for now.
   * Reason: TS does not have the relation graph store/index yet; returning dummy values would hide missing capability.
   * Rust reference: `Aura::link_entities` (`../src/aura.rs`).
   */
  link_entities(..._args: ReadonlyArray<unknown>) {
    return unsupportedSurface("Aura.link_entities", "Aura::link_entities (aura.rs)", [
      "Relation graph store",
      "Entity link mutation path",
    ])
  }

  /**
   * UNIMPLEMENTED: project graph APIs are recoverably unsupported for now.
   * Reason: TS does not have the project graph store/index yet; returning dummy values would hide missing capability.
   * Rust reference: `Aura::get_project_graph` (`../src/aura.rs`).
   */
  get_project_graph(..._args: ReadonlyArray<unknown>) {
    return unsupportedSurface("Aura.get_project_graph", "Aura::get_project_graph (aura.rs)", [
      "Project graph store",
      "Project graph read model",
    ])
  }

  /**
   * UNIMPLEMENTED: family graph APIs are recoverably unsupported for now.
   * Reason: TS does not have the family graph store/index yet; returning dummy values would hide missing capability.
   * Rust reference: `Aura::get_family_graph` (`../src/aura.rs`).
   */
  get_family_graph(..._args: ReadonlyArray<unknown>) {
    return unsupportedSurface("Aura.get_family_graph", "Aura::get_family_graph (aura.rs)", [
      "Family graph store",
      "Family graph read model",
    ])
  }
}

function unsupportedSurface(
  surface: string,
  rustReference: string,
  missingPrerequisites: ReadonlyArray<string>,
): Effect.Effect<never, UnsupportedSurfaceError> {
  return Effect.fail(new UnsupportedSurfaceError({
    surface,
    reason: "TS core does not yet have the Rust-parity implementation for this MCP-facing surface.",
    rustReference,
    missingPrerequisites,
  }))
}

function toRecallSignalScore(signal: RecallRecordEvidence["signals"][keyof RecallRecordEvidence["signals"]]): RecallSignalScore | null {
  return signal === undefined
    ? null
    : {
        raw_score: signal.rawScore,
        rank: signal.rank,
        rrf_share: signal.rrfShare,
      }
}

function toRecallTraceScore(evidence: RecallRecordEvidence | undefined, finalScore: number): RecallTraceScore {
  return {
    sdr: toRecallSignalScore(evidence?.signals.sdr),
    ngram: toRecallSignalScore(evidence?.signals.ngram),
    tags: toRecallSignalScore(evidence?.signals.tags),
    embedding: toRecallSignalScore(evidence?.signals.embedding),
    rrf_score: evidence?.rrfScore ?? 0,
    graph_score: evidence?.graphScore ?? 0,
    causal_score: evidence?.causalScore ?? 0,
    pre_trust_score: evidence?.preTrustScore ?? 0,
    trust_multiplier: evidence?.trustMultiplier ?? 1,
    pre_rerank_score: evidence?.preRerankScore ?? finalScore,
    rerank_delta: evidence?.rerankDelta ?? 0,
    final_score: finalScore,
  }
}

function buildProvenanceChain(item: RecallExplanationItem, buildLatencyMs: number): ProvenanceChain {
  const steps: string[] = [`record ${item.record_id} in namespace ${item.namespace}`]
  if (item.because_record_id !== null) {
    steps.push(item.because_preview === null
      ? `caused_by ${item.because_record_id}`
      : `caused_by ${item.because_record_id} from "${previewText(item.because_preview, 80)}"`)
  }
  if (item.belief !== null) {
    steps.push(`belief ${item.belief.id} is ${item.belief.state} at confidence ${item.belief.confidence.toFixed(2)}`)
    if (item.belief.has_unresolved_evidence) {
      steps.push(`belief ${item.belief.id} carries unresolved evidence`)
    }
  }
  for (const concept of item.concepts) {
    steps.push(`concept ${concept.id} (${concept.key}) is ${concept.state} at confidence ${concept.confidence.toFixed(2)}`)
  }
  for (const pattern of item.causal_patterns) {
    const lastCorrection = pattern.corrections[pattern.corrections.length - 1]
    steps.push(lastCorrection === undefined
      ? `causal pattern ${pattern.id} (${pattern.key}) is ${pattern.state} with strength ${pattern.causal_strength.toFixed(2)}`
      : `causal pattern ${pattern.id} (${pattern.key}) is ${pattern.state}; last correction ${lastCorrection.operation} at ${lastCorrection.time_iso}`)
  }
  for (const hint of item.policy_hints) {
    steps.push(`policy hint ${hint.id} (${hint.key}) is ${hint.state} as ${hint.action_kind} with strength ${hint.policy_strength.toFixed(2)}`)
  }

  const narrativeParts = [`Record ${item.record_id} surfaced in namespace ${item.namespace}`]
  if (item.belief !== null) {
    narrativeParts.push(`it maps to belief ${item.belief.id} (${item.belief.state}, confidence ${item.belief.confidence.toFixed(2)})`)
  }
  if (item.concepts.length > 0) {
    narrativeParts.push(`it participates in concepts ${item.concepts.map((concept) => concept.key).join(", ")}`)
  }
  if (item.causal_patterns.length > 0) {
    narrativeParts.push(`causal evidence includes ${item.causal_patterns.length} pattern(s)`)
  }
  if (item.policy_hints.length > 0) {
    narrativeParts.push(`policy guidance includes ${item.policy_hints.length} hint(s)`)
  }

  return {
    record_id: item.record_id,
    namespace: item.namespace,
    content_preview: item.content_preview,
    build_latency_ms: buildLatencyMs,
    because_record_id: item.because_record_id,
    because_preview: item.because_preview,
    belief: item.belief,
    concepts: item.concepts,
    causal_patterns: item.causal_patterns,
    policy_hints: item.policy_hints,
    steps,
    narrative: `${narrativeParts.join("; ")}.`,
  }
}

function latestCorrectionReason(
  entries: ReadonlyArray<CorrectionLogEntry>,
  targetKind: string,
  targetId: string,
  operation: string,
): string | null {
  const entry = entries
    .filter((item) => item.target_kind === targetKind && item.target_id === targetId && item.operation === operation)
    .sort((a, b) => b.timestamp - a.timestamp)[0]
  return entry?.reason ?? null
}

function latestCorrectionTimestamp(
  entries: ReadonlyArray<CorrectionLogEntry>,
  targetKind: string,
  targetId: string,
  operation: string,
): number | null {
  const entry = entries
    .filter((item) => item.target_kind === targetKind && item.target_id === targetId && item.operation === operation)
    .sort((a, b) => b.timestamp - a.timestamp)[0]
  return entry?.timestamp ?? null
}

function dependentCausalCount(
  entry: CorrectionLogEntry,
  patterns: ReadonlyArray<CausalPattern>,
): number {
  return patterns.filter((pattern) => {
    if (!isActiveCausalPattern(pattern)) return false
    if (entry.target_kind === "belief") {
      return pattern.cause_belief_id === entry.target_id || pattern.effect_belief_id === entry.target_id
    }
    if (entry.target_kind === "record") {
      return pattern.cause_record_ids.includes(entry.target_id) || pattern.effect_record_ids.includes(entry.target_id)
    }
    return false
  }).length
}

function dependentPolicyCount(
  entry: CorrectionLogEntry,
  hints: ReadonlyArray<PolicyHint>,
): number {
  return hints.filter((hint) => {
    if (hint.state === "Rejected") return false
    if (entry.target_kind === "causal_pattern") return hint.pattern_id === entry.target_id
    if (entry.target_kind === "record") {
      return hint.cause_record_ids.includes(entry.target_id) || hint.effect_keys.includes(entry.target_id)
    }
    if (entry.target_kind === "belief") return hint.cause_key.includes(entry.target_id)
    return false
  }).length
}

function namespaceForCorrection(
  entry: CorrectionLogEntry,
  records: ReadonlyMap<string, AuraRecord>,
  patterns: ReadonlyArray<CausalPattern>,
  hints: ReadonlyArray<PolicyHint>,
): string {
  if (entry.target_kind === "record") return records.get(entry.target_id)?.namespace ?? inferNamespaceFromTarget(entry.target_id)
  if (entry.target_kind === "causal_pattern") {
    return patterns.find((pattern) => pattern.id === entry.target_id)?.namespace ?? inferNamespaceFromTarget(entry.target_id)
  }
  if (entry.target_kind === "policy_hint") {
    return hints.find((hint) => hint.id === entry.target_id)?.namespace ?? inferNamespaceFromTarget(entry.target_id)
  }
  return inferNamespaceFromTarget(entry.target_id)
}

function namespaceForCorrectionWithBeliefs(
  entry: CorrectionLogEntry,
  records: ReadonlyMap<string, AuraRecord>,
  beliefs: ReadonlyArray<Belief>,
  patterns: ReadonlyArray<CausalPattern>,
  hints: ReadonlyArray<PolicyHint>,
): string {
  if (entry.target_kind === "belief") {
    const belief = beliefs.find((item) => item.id === entry.target_id)
    if (belief !== undefined) return namespaceFromBeliefKey(belief.key)
  }
  return namespaceForCorrection(entry, records, patterns, hints)
}

function inferNamespaceFromTarget(targetId: string): string {
  const [namespace] = targetId.split(":")
  if (namespace && namespace.length > 0 && namespace !== targetId) return namespace
  const dashParts = targetId.split("-")
  const suffix = dashParts[dashParts.length - 1]
  return suffix && suffix.length > 0 && suffix !== targetId ? suffix : "default"
}

function isActiveCausalPattern(pattern: CausalPattern): boolean {
  return pattern.state === "Candidate" || pattern.state === "Stable"
}

function firstRecordForBelief(
  belief: Belief,
  records: ReadonlyMap<string, AuraRecord>,
): string | null {
  for (const record of records.values()) {
    const keyParts = belief.key.split(":")
    const semantic = keyParts[keyParts.length - 1]
    if (record.namespace === namespaceFromBeliefKey(belief.key) && semantic !== undefined && record.semantic_type === semantic) {
      return record.id
    }
  }
  return null
}

function previewText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1))}...`
}

/**
 * Return records with elevated salience, highest salience first.
 * 返回 salience 较高的 records，按 salience 降序排列。
 * Rust reference: `Aura::get_high_salience_records` (`../src/aura.rs`).
 */
function highSalienceRecords(
  records: ReadonlyArray<AuraRecord>,
  minSalience: number,
  limit: number,
): ReadonlyArray<AuraRecord> {
  return records
    .filter((record) => record.salience >= minSalience)
    .sort((a, b) => {
      const salienceDelta = b.salience - a.salience
      if (Number.isFinite(salienceDelta) && salienceDelta !== 0) return salienceDelta
      return recordImportance(b) - recordImportance(a)
    })
    .slice(0, Math.min(100, Math.max(0, limit)))
}

function normalizeCrossNamespaceOptions(
  input?: AuraCrossNamespaceDigestOptions,
): CrossNamespaceDigestOptions {
  const base: CrossNamespaceDigestOptions = {
    ...defaultCrossNamespaceDigestOptions(),
    ...input,
    min_record_count: Math.max(0, Math.trunc(input?.min_record_count ?? 1)),
    top_concepts_limit: clampInt(input?.top_concepts_limit ?? 5, 1, 10),
    pairwise_similarity_threshold: clamp(input?.pairwise_similarity_threshold ?? 0, 0, 1),
    compact_summary: input?.compact_summary ?? false,
  }
  return applyCrossNamespaceDimensionFlags(base, input?.include_dimensions)
}

function includedCrossNamespaceDimensions(options: CrossNamespaceDigestOptions): ReadonlyArray<string> {
  const dimensions: string[] = []
  if (options.include_concepts) dimensions.push("concepts")
  if (options.include_tags) dimensions.push("tags")
  if (options.include_structural) dimensions.push("structural")
  if (options.include_causal) dimensions.push("causal")
  if (options.include_belief_states) dimensions.push("belief_states")
  if (options.include_corrections) dimensions.push("corrections")
  return dimensions
}

function summarizeNamespaceBeliefStates(
  beliefs: ReadonlyArray<Belief>,
): CrossNamespaceBeliefStateSummary {
  const total = beliefs.length
  const avgVolatility = total === 0
    ? 0
    : beliefs.reduce((sum, belief) => sum + belief.volatility, 0) / total
  return {
    resolved: beliefs.filter((belief) => belief.state === "Resolved").length,
    unresolved: beliefs.filter((belief) => belief.state === "Unresolved").length,
    singleton: beliefs.filter((belief) => belief.state === "Singleton").length,
    empty: beliefs.filter((belief) => belief.state === "Empty").length,
    high_volatility_count: beliefs.filter((belief) => belief.volatility >= 0.20).length,
    avg_volatility: avgVolatility,
  }
}

function canonicalConceptSignature(concept: ConceptCandidate): string {
  const terms = sortedUnique([...concept.core_terms, ...concept.tags].map(normalizeAnalyticsTerm).filter((term) => term.length > 0))
    .slice(0, 4)
  return `${concept.semantic_type}:${terms.join("+")}`
}

function canonicalCausalSignature(
  pattern: CausalPattern,
  records: ReadonlyMap<string, AuraRecord>,
): string {
  const causeTerms = collectRecordSignatureTerms(pattern.cause_record_ids, records)
  const effectTerms = collectRecordSignatureTerms(pattern.effect_record_ids, records)
  return `${causeTerms.join("+")}=>${effectTerms.join("+")}`
}

function collectRecordSignatureTerms(
  recordIds: ReadonlyArray<string>,
  records: ReadonlyMap<string, AuraRecord>,
): ReadonlyArray<string> {
  const terms: string[] = []
  for (const recordId of recordIds) {
    const record = records.get(recordId)
    if (!record) continue
    for (const tag of record.tags) terms.push(normalizeAnalyticsTerm(tag))
    terms.push(normalizeAnalyticsTerm(record.content_type))
    terms.push(normalizeAnalyticsTerm(record.semantic_type))
  }
  return sortedUnique(terms.filter((term) => term.length > 0)).slice(0, 4)
}

function normalizeAnalyticsTerm(term: string): string {
  let normalized = ""
  let lastWasSpace = true
  for (const char of term.toLowerCase()) {
    if (/^[a-z0-9]$/.test(char)) {
      normalized += char
      lastWasSpace = false
    } else if (!lastWasSpace) {
      normalized += " "
      lastWasSpace = true
    }
  }
  return normalized.trim()
}

function isStructuralRelationType(relationType: string): boolean {
  return relationType.startsWith("family.") || relationType === "belongs_to_project"
}

function jaccardSimilarity(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const union = new Set([...leftSet, ...rightSet]).size
  if (union === 0) return 0
  let intersection = 0
  for (const item of leftSet) {
    if (rightSet.has(item)) intersection++
  }
  return intersection / union
}

function sortedUnique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)].sort()
}

function sortedIntersection(left: ReadonlyArray<string>, right: ReadonlyArray<string>): string[] {
  const rightSet = new Set(right)
  return sortedUnique(left.filter((item) => rightSet.has(item)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(Number.isFinite(value) ? value : min, min, max))
}

function toMcpBeliefInstabilitySummary(summary: BeliefInstabilitySummary): McpBeliefInstabilitySummary {
  return {
    total_beliefs: summary.totalBeliefs,
    resolved: summary.resolved,
    unresolved: summary.unresolved,
    singleton: summary.singleton,
    empty: summary.empty,
    contradiction_cluster_count: summary.contradictionClusterCount,
    high_volatility_count: summary.highVolatilityCount,
    low_stability_count: summary.lowStabilityCount,
    avg_volatility: summary.avgVolatility,
    avg_stability: summary.avgStability,
    volatility_bands: {
      low: summary.volatilityBands.low,
      medium: summary.volatilityBands.medium,
      high: summary.volatilityBands.high,
    },
  }
}

function toMcpPolicyLifecycleSummary(summary: PolicyLifecycleSummary): McpPolicyLifecycleSummary {
  return {
    total_hints: summary.totalHints,
    active_hints: summary.activeHints,
    stable_hints: summary.stableHints,
    candidate_hints: summary.candidateHints,
    suppressed_hints: summary.suppressedHints,
    rejected_hints: summary.rejectedHints,
    avg_policy_strength: summary.avgPolicyStrength,
    avg_risk_score: summary.avgRiskScore,
    action_summaries: summary.actionSummaries.map((item) => ({
      action_kind: item.actionKind,
      total_hints: item.totalHints,
      stable_hints: item.stableHints,
      candidate_hints: item.candidateHints,
      suppressed_hints: item.suppressedHints,
      rejected_hints: item.rejectedHints,
      avg_policy_strength: item.avgPolicyStrength,
      avg_risk_score: item.avgRiskScore,
    })),
    domain_summaries: summary.domainSummaries.map((item) => ({
      namespace: item.namespace,
      domain: item.domain,
      total_hints: item.totalHints,
      active_hints: item.activeHints,
      stable_hints: item.stableHints,
      candidate_hints: item.candidateHints,
      suppressed_hints: item.suppressedHints,
      rejected_hints: item.rejectedHints,
      avg_policy_strength: item.avgPolicyStrength,
      avg_risk_score: item.avgRiskScore,
      advisory_pressure: item.advisoryPressure,
    })),
  }
}

function toMcpPolicyPressureArea(area: PolicyPressureArea): McpPolicyPressureArea {
  return {
    namespace: area.namespace,
    domain: area.domain,
    advisory_pressure: area.advisoryPressure,
    active_hints: area.activeHints,
    suppressed_hints: area.suppressedHints,
    rejected_hints: area.rejectedHints,
    strongest_hint_id: area.strongestHintId,
    strongest_action_kind: area.strongestActionKind,
    strongest_policy_strength: area.strongestPolicyStrength,
  }
}

function toMcpMaintenanceTrendSummary(summary: MaintenanceTrendSummary): McpMaintenanceTrendSummary {
  return {
    snapshot_count: summary.snapshotCount,
    recent: summary.recent.map(toMcpMaintenanceTrendSnapshot),
    avg_belief_churn: summary.avgBeliefChurn,
    avg_causal_rejection_rate: summary.avgCausalRejectionRate,
    avg_policy_suppression_rate: summary.avgPolicySuppressionRate,
    avg_cycle_time_ms: summary.avgCycleTimeMs,
    avg_correction_events: summary.avgCorrectionEvents,
    total_corrections_in_window: summary.totalCorrectionsInWindow,
    latest_dominant_phase: summary.latestDominantPhase,
  }
}

function toMcpReflectionFinding(finding: ReflectionFinding): McpReflectionFinding {
  return {
    kind: finding.kind,
    namespace: finding.namespace,
    title: finding.title,
    detail: finding.detail,
    related_ids: finding.relatedIds,
    score: finding.score,
    severity: finding.severity,
  }
}

function deriveMaintenanceTrendDirection(summary: MaintenanceTrendSummary): string {
  if (summary.recent.length < 2) return "insufficient_data"
  const first = summary.recent[0]!
  const last = summary.recent[summary.recent.length - 1]!
  const firstPressure = first.volatileRecords + first.correctionEvents + first.policySuppressionRate * 10 + first.causalRejectionRate * 10
  const lastPressure = last.volatileRecords + last.correctionEvents + last.policySuppressionRate * 10 + last.causalRejectionRate * 10
  const delta = lastPressure - firstPressure
  if (delta > 1) return "worsening"
  if (delta < -1) return "improving"
  return "stable"
}

function issueSeverity(score: number, highThreshold: number, mediumThreshold: number): string {
  if (score >= highThreshold) return "high"
  if (score >= mediumThreshold) return "medium"
  return "low"
}

function namespaceFromBeliefKey(key: string): string {
  return key.split(":")[0] || "default"
}

/**
 * Composite importance score (0.0-1.0+).
 *
 * Formula: strength(40%) + level(25%) + connections(20%) + activations(15%) + bounded salience hint (10%).
 * 组合重要性分数；与 Rust `Record::importance` 公式对齐。
 * Rust reference: `Record::importance` (`../src/record.rs`).
 */
function recordImportance(record: AuraRecord): number {
  const levelScore = levelValue(record.level) / 4
  const connScore = Math.min(Object.keys(record.connections).length / 50, 1)
  const actScore = Math.min(record.activation_count / 20, 1)
  const salience = clamp01(record.salience ?? 0)
  return 0.40 * record.strength + 0.25 * levelScore + 0.20 * connScore + 0.15 * actScore + 0.10 * salience
}

function levelValue(level: Level): number {
  switch (level) {
    case Level.Working:
      return 1
    case Level.Decisions:
      return 2
    case Level.Domain:
      return 3
    case Level.Identity:
      return 4
  }
}

/**
 * Display name for the level.
 * level 的展示名；与 Rust `Level::name` 保持一致。
 * Rust reference: `Level::name` (`../src/levels.rs`).
 */
function levelDisplayName(level: Level): string {
  switch (level) {
    case Level.Working:
      return "WORKING"
    case Level.Decisions:
      return "DECISIONS"
    case Level.Domain:
      return "DOMAIN"
    case Level.Identity:
      return "IDENTITY"
  }
}

/**
 * Check if this level belongs to the cognitive tier (Working + Decisions).
 * 检查 level 是否属于 cognitive tier（Working + Decisions）。
 * Rust reference: `Level::is_cognitive` (`../src/levels.rs`).
 */
function isCognitiveLevel(level: Level): boolean {
  return level === Level.Working || level === Level.Decisions
}

/**
 * Check if this level belongs to the core tier (Domain + Identity).
 * 检查 level 是否属于 core tier（Domain + Identity）。
 * Rust reference: `Level::is_core` (`../src/levels.rs`).
 */
function isCoreLevel(level: Level): boolean {
  return level === Level.Domain || level === Level.Identity
}

function isLevelInTier(level: Level, tier: MemoryTierKind): boolean {
  return tier === "cognitive" ? isCognitiveLevel(level) : isCoreLevel(level)
}

function tierRecords(
  records: ReadonlyArray<AuraRecord>,
  tier: MemoryTierKind,
  limit: number,
  namespaces: ReadonlyArray<string>,
): ReadonlyArray<AuraRecord> {
  return records
    .filter((record) => isLevelInTier(record.level, tier) && namespaces.includes(record.namespace))
    .sort((a, b) => recordImportance(b) - recordImportance(a))
    .slice(0, limit)
    .map(cloneAuraRecord)
}

/**
 * Promote to the next level.
 * 晋升到下一个 level。
 * Rust reference: `Record::promote` (`../src/record.rs`).
 */
function promoteLevel(level: Level): Level | null {
  switch (level) {
    case Level.Working:
      return Level.Decisions
    case Level.Decisions:
      return Level.Domain
    case Level.Domain:
      return Level.Identity
    case Level.Identity:
      return null
  }
}

/**
 * Daily decay rate for this level.
 * 当前 level 的每日衰减率。
 * Rust reference: `Level::decay_rate` (`../src/levels.rs`).
 */
function levelDecayRate(level: Level): number {
  switch (level) {
    case Level.Working:
      return 0.80
    case Level.Decisions:
      return 0.90
    case Level.Domain:
      return 0.95
    case Level.Identity:
      return 0.99
  }
}

/**
 * Whether this record is still alive (not archived).
 * 判断 record 是否仍存活（未归档）。
 * Rust reference: `Record::is_alive` (`../src/record.rs`).
 */
function isRecordAlive(record: AuraRecord): boolean {
  return record.strength >= 0.05
}

/**
 * Whether this record is eligible for promotion.
 * 判断 record 是否符合晋升条件。
 * Rust reference: `Record::can_promote` (`../src/record.rs`).
 */
function canPromoteRecord(record: AuraRecord): boolean {
  return record.activation_count >= 5 && record.strength >= 0.7 && record.level !== Level.Identity
}

/**
 * Contextual hub promotion (10+ connections, avg weight >= 0.4).
 * 上下文 hub 提升：至少 10 条连接，平均权重不低于 0.4。
 * Rust reference: `Aura::reflect` (`../src/aura.rs`).
 */
function canPromoteContextualHub(record: AuraRecord): boolean {
  const weights = Object.values(record.connections)
  if (weights.length < 10) return false
  if (record.strength < 0.5) return false
  if (record.level === Level.Identity) return false
  const averageWeight = weights.reduce((sum, weight) => sum + weight, 0) / weights.length
  return averageWeight + Number.EPSILON >= 0.4
}

/**
 * Apply daily decay based on level and semantic type.
 *
 * Uses adaptive decay: rate interpolates from base toward 0.999
 * as activation_count grows (ceiling effect for frequently used records).
 * Retention is driven by Level (Identity=0.99 .. Working=0.80) and activation frequency.
 * semantic_type does not influence decay — Level already encodes information importance.
 * Salience adds only a bounded retention bias.
 *
 * 基于 level 与 activation frequency 应用自适应衰减；semantic_type 不参与衰减。
 * Rust reference: `Record::apply_decay` (`../src/record.rs`).
 */
function applyRecordDecay(record: AuraRecord): AuraRecord {
  const baseRate = levelDecayRate(record.level)
  const ceilingFactor = Math.min(record.activation_count / 10, 1)
  const activationRate = Math.min(baseRate + (0.999 - baseRate) * ceilingFactor, 0.999)
  const salienceBias = 0.03 * clamp01(record.salience ?? 0)
  const effectiveRate = Math.min(activationRate + salienceBias, 0.999)
  return { ...record, strength: record.strength * effectiveRate }
}

/**
 * Decay connection weights and remove weak connections.
 * 衰减 connection 权重，并移除弱连接。
 * Rust reference: `Aura::decay` connection pass (`../src/aura.rs`).
 */
function decayRecordConnections(record: AuraRecord): AuraRecord {
  const connections: { [k: string]: number } = {}
  const connectionTypes: { [k: string]: string } = { ...record.connection_types }

  for (const [id, weight] of Object.entries(record.connections)) {
    if (weight < 0.05) {
      delete connectionTypes[id]
      continue
    }
    connections[id] = weight * 0.99
  }

  return { ...record, connections, connection_types: connectionTypes }
}

/**
 * Rust facades return owned `Record` clones; copy mutable containers on the TS side.
 * Rust 的 facade 返回 owned `Record`；TS 侧复制可变容器，避免泄露内部 read model。
 */
function cloneAuraRecord(record: AuraRecord): AuraRecord {
  return {
    ...record,
    tags: [...record.tags],
    connections: { ...record.connections },
    connection_types: { ...record.connection_types },
    metadata: { ...record.metadata },
  }
}

/**
 * Normalize a contract Record into the mutable AuraRecord shape used by core facades.
 * 将 contract Record 归一化为 core facade 使用的 AuraRecord shape。
 *
 * AuraRecord (contract Record) does not have an index signature, so this casts
 * for dynamic field access during normalization.
 */
function toRecordLike(rec: AuraRecord, nowSecs: number): AuraRecord {
  const o = rec as unknown as { [k: string]: unknown };
  const id = rec.id;
  const content = typeof o.content === "string" ? o.content : "";
  const tags: ReadonlyArray<string> =
    Array.isArray(o.tags)
      ? o.tags.filter((t): t is string => typeof t === "string")
      : [];
  const connections: { readonly [k: string]: number } =
    o.connections && typeof o.connections === "object"
      ? { ...(o.connections as { [k: string]: number }) }
      : {};
  const connection_types: { readonly [k: string]: string } =
    o.connection_types && typeof o.connection_types === "object"
      ? { ...(o.connection_types as { [k: string]: string }) }
      : {};
  const metadata: { readonly [k: string]: string } =
    o.metadata && typeof o.metadata === "object"
      ? { ...(o.metadata as { [k: string]: string }) }
      : {};

  const level =
    typeof o.level === "string" &&
    (Object.values(Level) as ReadonlyArray<string>).includes(o.level)
      ? (o.level as Level)
      : Level.Working;

  const source_type = typeof o.source_type === "string" ? o.source_type : DEFAULT_SOURCE_TYPE
  return {
    id,
    content,
    level,
    strength: numberOr(o.strength, 1),
    activation_count:
      numberOr(o.activation_count, 0),
    created_at: numberOr(o.created_at, nowSecs),
    last_activated:
      numberOr(o.last_activated, nowSecs),
    tags,
    connections,
    connection_types,
    content_type: typeof o.content_type === "string" ? o.content_type : "text",
    source_type,
    namespace: typeof o.namespace === "string" ? o.namespace : DEFAULT_NAMESPACE,
    semantic_type:
      typeof o.semantic_type === "string" ? o.semantic_type : DEFAULT_SEMANTIC_TYPE,
    activation_velocity: numberOr(o.activation_velocity, 0),
    salience: numberOr(o.salience, 0),
    metadata,
    aura_id: typeof o.aura_id === "string" ? o.aura_id : null,
    caused_by_id: typeof o.caused_by_id === "string" ? o.caused_by_id : null,
    confidence: numberOr(o.confidence, defaultConfidenceForSource(source_type)),
    support_mass: numberOr(o.support_mass, 0),
    conflict_mass: numberOr(o.conflict_mass, 0),
    volatility: numberOr(o.volatility, 0),
  };
}

function sharedTagCount(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number {
  const rightTags = new Set(right)
  let count = 0
  for (const tag of left) {
    if (rightTags.has(tag)) count += 1
  }
  return count
}

function toMcpMaintenanceTrendSnapshot(snapshot: MaintenanceTrendSnapshot): McpMaintenanceTrendSnapshot {
  return {
    timestamp: snapshot.timestamp,
    total_records: snapshot.totalRecords,
    records_archived: snapshot.recordsArchived,
    insights_found: snapshot.insightsFound,
    volatile_records: snapshot.volatileRecords,
    belief_churn: snapshot.beliefChurn,
    causal_rejection_rate: snapshot.causalRejectionRate,
    policy_suppression_rate: snapshot.policySuppressionRate,
    feedback_beliefs_touched: snapshot.feedbackBeliefsTouched,
    feedback_net_confidence_delta: snapshot.feedbackNetConfidenceDelta,
    feedback_net_volatility_delta: snapshot.feedbackNetVolatilityDelta,
    correction_events: snapshot.correctionEvents,
    cumulative_corrections: snapshot.cumulativeCorrections,
    cycle_time_ms: snapshot.cycleTimeMs,
    dominant_phase: snapshot.dominantPhase,
  }
}

function recordValidationError(field: string, message: string, rustReference: string): RecordValidationError {
  return new RecordValidationError({
    field,
    message,
    rustReference,
  })
}

function fromMcpMaintenanceTrendSnapshot(snapshot: McpMaintenanceTrendSnapshot): MaintenanceTrendSnapshot {
  return {
    timestamp: snapshot.timestamp,
    totalRecords: snapshot.total_records,
    recordsArchived: snapshot.records_archived,
    insightsFound: snapshot.insights_found,
    volatileRecords: snapshot.volatile_records,
    beliefChurn: snapshot.belief_churn,
    causalRejectionRate: snapshot.causal_rejection_rate,
    policySuppressionRate: snapshot.policy_suppression_rate,
    feedbackBeliefsTouched: snapshot.feedback_beliefs_touched,
    feedbackNetConfidenceDelta: snapshot.feedback_net_confidence_delta,
    feedbackNetVolatilityDelta: snapshot.feedback_net_volatility_delta,
    correctionEvents: snapshot.correction_events,
    cumulativeCorrections: snapshot.cumulative_corrections,
    cycleTimeMs: snapshot.cycle_time_ms,
    dominantPhase: snapshot.dominant_phase,
  }
}

function toMcpReflectionSummary(summary: ReflectionSummary): McpReflectionSummary {
  return {
    timestamp: summary.timestamp,
    digest: summary.digest,
    dominant_phase: summary.dominantPhase,
    report: {
      jobs_run: summary.report.jobsRun,
      blocker_findings: summary.report.blockerFindings,
      contradiction_findings: summary.report.contradictionFindings,
      trend_findings: summary.report.trendFindings,
      total_findings: summary.report.totalFindings,
      capped: summary.report.capped,
    },
    findings: summary.findings.map((finding) => ({
      kind: finding.kind,
      namespace: finding.namespace,
      title: finding.title,
      detail: finding.detail,
      related_ids: finding.relatedIds,
      score: finding.score,
      severity: finding.severity,
    })),
  }
}

function fromMcpReflectionSummary(summary: McpReflectionSummary): ReflectionSummary {
  return {
    timestamp: summary.timestamp,
    digest: summary.digest,
    dominantPhase: summary.dominant_phase,
    report: {
      jobsRun: summary.report.jobs_run,
      blockerFindings: summary.report.blocker_findings,
      contradictionFindings: summary.report.contradiction_findings,
      trendFindings: summary.report.trend_findings,
      totalFindings: summary.report.total_findings,
      capped: summary.report.capped,
    },
    findings: summary.findings.map((finding) => ({
      kind: finding.kind,
      namespace: finding.namespace,
      title: finding.title,
      detail: finding.detail,
      relatedIds: finding.related_ids,
      score: finding.score,
      severity: normalizeReflectionSeverity(finding.severity),
    })),
  }
}

function normalizeReflectionSeverity(severity: string): "high" | "medium" | "low" {
  return severity === "high" || severity === "medium" || severity === "low" ? severity : "low"
}
