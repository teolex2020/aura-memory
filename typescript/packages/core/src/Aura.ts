import { Effect, Ref } from "effect";
import {
  FileFormatError,
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  Level,
  type Record as AuraRecord,
  type StoreOptions,
  type UpdateOptions,
  Clock,
  EpistemicRuntime,
  UnsupportedSurfaceError,
  applyCrossNamespaceDimensionFlags,
  defaultCrossNamespaceDigestOptions,
} from "@aura/contract";
import {
  CognitiveStoreFile,
  loadCognitiveRecords,
  loadPersistenceManifestWithValidation,
  MaintenanceTrendsFile,
  ReflectionSummariesFile,
  readBrainAuraFile,
  type BrainAuraRecord,
} from "@aura/storage";
import type { RecallPipelineOptions } from "@aura/recall";
import {
  recallRecords as recallRecordsEffect,
  recallScored as recallScoredEffect,
} from "./Recall";
import { id12 } from "@aura/utils";

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
  DisabledBackgroundBrain,
  makeMaintenanceSdrInterpreter,
} from "./MaintenanceService"

// ── Contract types for MaintenanceService ──
import {
  BeliefEngine, ConceptEngine, CausalEngine, PolicyEngine,
  BeliefStore, ConceptStore, CausalStore, PolicyStore,
  EpistemicTrace,
  type MaintenanceReport, type MaintenanceConfig,
  defaultMaintenanceConfig,
  type PhaseTimings, type MaintenanceHotspots,
  type MaintenanceTrendSnapshot, type ReflectionSummary,
  type ConceptSurfaceCounters, type ConceptSurfaceMode,
  ConceptSurfaceMode as Csm,
  type ContradictionCluster,
  type McpMaintenanceTrendSnapshot,
  type McpReflectionSummary,
  type Belief,
  type BeliefInstabilitySummary,
  type PolicyLifecycleSummary,
  type PolicyPressureArea,
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
    private readonly maintenanceTrendHistory: MaintenanceTrendSnapshot[] = [],
    private readonly reflectionSummaries: ReflectionSummary[] = [],
  ) {}

  static open(
    brainPath: string,
  ): Effect.Effect<
    Aura,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    // Create a new Aura instance at the given path.
    // 在给定路径创建 Aura 实例。
    const brainAuraPath = `${brainPath}/brain.aura`;
    return Effect.gen(function* () {
      const fs = yield* Effect.service(FileRead);
      yield* loadPersistenceManifestWithValidation(brainPath);
      const buf = yield* fs.readFile(brainAuraPath);
      const parsed = yield* Effect.try({
        try: () => readBrainAuraFile(buf),
        catch: (cause) =>
          new FileFormatError({
            path: brainAuraPath,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });
      const trendFile = MaintenanceTrendsFile.new(brainPath)
      const reflectionFile = ReflectionSummariesFile.new(brainPath)
      const trends = yield* trendFile.load().pipe(
        Effect.map((history) => history.map(fromMcpMaintenanceTrendSnapshot)),
        Effect.catch(() => Effect.succeed([] as MaintenanceTrendSnapshot[]))
      )
      const reflections = yield* reflectionFile.load().pipe(
        Effect.map((history) => history.map(fromMcpReflectionSummary)),
        Effect.catch(() => Effect.succeed([] as ReflectionSummary[]))
      )
      const cognitiveRecords = yield* loadCognitiveRecords(brainPath)
      return new Aura(brainPath, parsed.records, cognitiveRecords, trends, reflections);
    });
  }

  static open_with_password(
    brainPath: string,
    _password?: string,
  ): Effect.Effect<
    Aura,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    // Create a new Aura instance with optional encryption.
    // 创建 Aura 实例（可选加密）。
    // NON-PARITY IMPLEMENTATION: password/encryption is not wired yet.
    // 差异说明：TS core 目前只使用 FileRead/FileWrite 抽象，尚未接入 Rust AuraStorage 的加密管线。
    // Rust reference: Aura::open_with_password (aura.rs)
    return Aura.open(brainPath);
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice();
  }

  listCognitiveRecords(): AuraRecord[] {
    return [...this.searchRecords.values()]
  }

  store(
    content: string,
    options?: StoreOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError,
    FileRead | FileWrite
  > {
    return this.store_with_channel(content, options);
  }

  store_code(
    options: StoreCodeOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError,
    FileRead | FileWrite
  > {
    // Store a code snippet at DOMAIN level with language metadata.
    // 将代码片段以 DOMAIN level 存储，并写入语言/文件名元数据。
    // Rust reference: AuraMcpServer::store_code (mcp.rs)
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
      metadata: {
        language: options.language,
        ...(options.filename !== undefined ? { filename: options.filename } : {}),
      },
    })
  }

  store_decision(
    options: StoreDecisionOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError,
    FileRead | FileWrite
  > {
    // Store a decision with reasoning and rejected alternatives.
    // 存储决策、理由与被拒绝的备选方案。
    // Rust reference: AuraMcpServer::store_decision (mcp.rs)
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

  store_with_channel(
    content: string,
    options?: StoreOptions & {
      readonly channel?: string;
      readonly auto_promote?: boolean;
    },
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError,
    FileRead | FileWrite
  > {
    // Store with explicit channel for provenance stamping.
    // `auto_promote`: if Some(false), disables surprise-based level promotion.
    // 带显式 channel 的存储，用于 provenance 标记；auto_promote 为 false 时关闭基于“surprise”的 level 晋升。
    // SIMPLE IMPLEMENTATION: only appends to brain.cog (CognitiveStoreFile) and fsyncs.
    // 简化实现：仅追加写入 brain.cog 并 fsync；不维护 brain.aura 与 index/。
    // Rust reference: Aura::store / Aura::store_with_channel (aura.rs)
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

      const record: AuraRecord = {
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
        source_type: options?.source_type ?? "recorded",
        namespace: options?.namespace ?? "default",
        semantic_type: options?.semantic_type ?? "memory",
        metadata: { ...(options?.metadata ?? {}), timestamp: nowIso },
        caused_by_id: options?.caused_by_id ?? null,
      };

      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendStore(record);
      yield* store.flush();
      self.replaceSearchRecord(record)
      return record;
    });
  }

  update(
    record_id: string,
    patch?: UpdateOptions,
  ): Effect.Effect<
    AuraRecord,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    // Update a record.
    // 更新一条 record。
    // SIMPLE IMPLEMENTATION: load current in-memory view (from brain.cog/brain.snap) and append an Update record.
    // 简化实现：从 brain.cog/brain.snap 回放得到当前视图，再追加写入一条 Update 记录。
    // Rust reference: Aura::update (aura.rs)
    const dir = this.brainDir;
    const self = this;
    return Effect.gen(function* () {
      const clock = yield* Clock
      const nowSec = clock.nowSeconds();
      const records = yield* loadCognitiveRecords(dir);
      const existing = records.get(record_id);
      const base = existing ? toRecordLike(existing, nowSec) : undefined;
      const nowIso = new Date().toISOString();

      const next: AuraRecord = {
        id: record_id,
        content: patch?.content ?? base?.content ?? "",
        level: base?.level ?? Level.Working,
        strength: patch?.strength ?? base?.strength ?? 1,
        activation_count: base?.activation_count ?? 0,
        created_at: base?.created_at ?? nowSec,
        last_activated: nowSec,
        tags: patch?.tags ?? base?.tags ?? [],
        connections: base?.connections ?? {},
        connection_types: base?.connection_types ?? {},
        content_type: base?.content_type ?? "text",
        source_type: base?.source_type ?? "recorded",
        namespace: base?.namespace ?? "default",
        semantic_type: base?.semantic_type ?? "memory",
        metadata: {
          ...(base?.metadata ?? {}),
          ...(patch?.metadata ?? {}),
          timestamp: nowIso,
        },
        aura_id: base?.aura_id ?? null,
        caused_by_id: base?.caused_by_id ?? null,
      };

      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendUpdate(next);
      yield* store.flush();
      self.replaceSearchRecord(next)
      return next;
    });
  }

  delete(
    record_id: string,
  ): Effect.Effect<
    boolean,
    FileReadError | FileWriteError,
    FileRead | FileWrite
  > {
    // Delete a record.
    // 删除一条 record。
    // SIMPLE IMPLEMENTATION: append delete op to brain.cog and return true.
    // 简化实现：追加写入 delete 操作并返回 true（后续 parity 可返回 existed?）。
    // Rust reference: Aura::delete (aura.rs)
    const dir = this.brainDir;
    const self = this;
    return Effect.gen(function* () {
      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendDelete(record_id);
      yield* store.flush();
      self.removeSearchRecord(record_id)
      return true;
    });
  }

  connect(
    from_id: string,
    to_id: string,
    weight?: number,
  ): Effect.Effect<
    void,
    FileReadError | FileWriteError | FileFormatError,
    FileRead | FileWrite
  > {
    // Connect two records with optional relationship type.
    //
    // Relationship types (inspired by molecular reasoning bonds):
    // - `"causal"` — A caused/led to B
    // - `"reflective"` — B validates/corrects A
    // - `"associative"` — A and B are thematically related
    // - `"coactivation"` — A and B were recalled together in a session
    // - Any custom string
    // 连接两条 records（Rust 支持 relationship 类型；TS 当前仅支持权重）。
    // SIMPLE IMPLEMENTATION: load record, mutate connections, appendUpdate full record.
    // 简化实现：加载记录、更新 connections、追加写入完整 record。
    // Rust reference: Aura::connect (aura.rs)
    const dir = this.brainDir;
    const self = this;
    const w =
      typeof weight === "number" && Number.isFinite(weight) ? weight : 1;
    return Effect.gen(function* () {
      const clock = yield* Clock
      const nowSec = clock.nowSeconds();
      const records = yield* loadCognitiveRecords(dir);
      const existing = records.get(from_id);
      const base = existing ? toRecordLike(existing, nowSec) : undefined;
      const nowIso = new Date().toISOString();

      const connections: { [k: string]: number } = {
        ...(base?.connections ?? {}),
      };
      connections[to_id] = w;

      const next: AuraRecord = {
        id: from_id,
        content: base?.content ?? "",
        level: base?.level ?? Level.Working,
        strength: base?.strength ?? 1,
        activation_count: base?.activation_count ?? 0,
        created_at: base?.created_at ?? nowSec,
        last_activated: nowSec,
        tags: base?.tags ?? [],
        connections,
        connection_types: base?.connection_types ?? {},
        content_type: base?.content_type ?? "text",
        source_type: base?.source_type ?? "recorded",
        namespace: base?.namespace ?? "default",
        semantic_type: base?.semantic_type ?? "memory",
        metadata: { ...(base?.metadata ?? {}), timestamp: nowIso },
        aura_id: base?.aura_id ?? null,
        caused_by_id: base?.caused_by_id ?? null,
      };

      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendUpdate(next);
      yield* store.flush();
      self.replaceSearchRecord(next)
    });
  }

  recall(query: string, options?: Partial<RecallPipelineOptions>) {
    // NON-PARITY IMPLEMENTATION: returns RecallScored rather than Rust's richer RecallItem.
    // 差异说明：TS recall pipeline 目前返回 scored IDs；structured/explainability 尚未实现。
    // Rust reference: Aura::recall (aura.rs)
    return recallScoredEffect(this.brainDir, query, options);
  }

  recall_structured(query: string, options?: Partial<RecallPipelineOptions>) {
    // NON-PARITY IMPLEMENTATION: approximates structured recall via recallRecords.
    // Reason: TS does not yet model RecallExplanation/trace bundle.
    // Rust reference: Aura::recall_structured (aura.rs)
    return recallRecordsEffect<AuraRecord>(this.brainDir, query, options);
  }

  recall_full(query: string, options?: Partial<RecallPipelineOptions>) {
    // NON-PARITY IMPLEMENTATION: same as recall_structured for now.
    // Reason: TS does not yet model the full explainability DTO surface from Rust.
    // Rust reference: Aura::recall_full (aura.rs)
    return this.recall_structured(query, options);
  }

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
    // Search with filters.
    // 按过滤条件搜索 records。
    // Rust reference: Aura::search (aura.rs)
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
    return results.slice(0, max)
  }

  stats(): AuraStats {
    // Get statistics.
    // 获取基础统计。
    // Rust reference: Aura::stats (aura.rs)
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

  insights(): AuraStats {
    // MCP insights intentionally mirrors Rust MCP's stats() call path.
    // MCP insights 在 Rust server 中实际调用 stats()，TS 侧保持同一契约。
    // Rust reference: AuraMcpServer::insights (mcp.rs)
    return this.stats()
  }

  maintain(config?: MaintenanceConfig) {
    // Public MCP-facing facade over the maintenance orchestration.
    // 面向 MCP 的公开维护入口，委托到 runMaintenance。
    // Rust reference: Aura::run_maintenance / AuraMcpServer maintain path.
    return this.runMaintenance(config)
  }

  consolidate(): Effect.Effect<never, UnsupportedSurfaceError> {
    // UNIMPLEMENTED: consolidation is recoverably unsupported until TS has a real merge algorithm.
    // 未实现：TS 具备真实 merge 算法前，consolidate 以可恢复 typed error 暴露。
    // Rust reference: Aura::consolidate (aura.rs)
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

  get_belief_instability_summary(): Effect.Effect<McpBeliefInstabilitySummary, never, EpistemicRuntime | BeliefEngine> {
    // Reuse the EpistemicRuntime read model instead of recomposing belief logic in the MCP layer.
    // 复用 EpistemicRuntime 读模型，避免 MCP 传输层重复组合业务逻辑。
    // Rust reference: Aura::get_belief_instability_summary (aura.rs)
    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const summary = yield* runtime.getBeliefInstabilitySummary()
      return toMcpBeliefInstabilitySummary(summary)
    })
  }

  belief_instability(): Effect.Effect<McpBeliefInstabilitySummary, never, EpistemicRuntime | BeliefEngine> {
    return this.get_belief_instability_summary()
  }

  get_policy_lifecycle_summary(
    actionLimit?: number,
    domainLimit?: number,
  ): Effect.Effect<McpPolicyLifecycleSummary, never, EpistemicRuntime | PolicyEngine> {
    // Reuse the EpistemicRuntime policy lifecycle aggregation.
    // 复用 EpistemicRuntime 的 policy lifecycle 聚合。
    // Rust reference: Aura::get_policy_lifecycle_summary (aura.rs)
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

  cross_namespace_digest_with_options(
    namespaces?: ReadonlyArray<string>,
    inputOptions?: AuraCrossNamespaceDigestOptions,
  ): Effect.Effect<CrossNamespaceDigest, never, ConceptEngine | CausalEngine | BeliefEngine> {
    // Build a read-only bounded analytics digest across namespaces.
    // 构建跨 namespace 的只读有界分析摘要。
    // Rust reference: Aura::cross_namespace_digest_with_options (aura.rs)
    const started = Date.now()
    const records = [...this.searchRecords.values()]
    const recordsById = new Map(records.map((record) => [record.id, record]))
    const options = normalizeCrossNamespaceOptions(inputOptions)
    const allowed = namespaces !== undefined ? new Set(namespaces) : null

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
        const correctionCount = options.include_corrections ? 0 : null
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

  get_memory_health_digest(limit?: number): Effect.Effect<MemoryHealthDigest, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    // Return an operator-facing digest from runtime read models plus persisted maintenance history.
    // 从 runtime 读模型和已持久化维护历史生成面向 operator 的健康摘要。
    // Rust reference: Aura::get_memory_health_digest (aura.rs)
    const max = Math.min(20, Math.max(1, limit ?? 8))
    const records = this.searchRecords
    const reflection = summarizeReflections(this.reflectionSummaries)
    const trendSummary = summarizeTrends(this.maintenanceTrendHistory)
    const trendDirection = deriveMaintenanceTrendDirection(trendSummary)

    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const instability = yield* runtime.getBeliefInstabilitySummary()
      const lifecycle = yield* runtime.getPolicyLifecycleSummary(max, max)
      const pressure = yield* runtime.getPolicyPressureReport(undefined, max)
      const highVolatility = yield* runtime.getHighVolatilityBeliefs(0.20, max)
      const contradictionClusters = yield* runtime.getContradictionClusters(records, undefined, max)

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

      return {
        total_records: records.size,
        startup_has_recovery_warnings: false,
        high_salience_record_count: 0,
        avg_salience: 0,
        max_salience: 0,
        reflection_summary_count: reflection.summaryCount,
        reflection_high_severity_findings: reflection.highSeverityFindings,
        contradiction_cluster_count: contradictionClusters.length,
        high_volatility_belief_count: instability.highVolatilityCount,
        low_stability_belief_count: instability.lowStabilityCount,
        recent_correction_count: 0,
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

  get_namespace_governance_status_filtered(
    namespaces?: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<NamespaceGovernanceStatus>, never, EpistemicRuntime | BeliefEngine | PolicyEngine> {
    // Return read-only governance status grouped per namespace.
    // 返回按 namespace 聚合的只读治理状态。
    // Rust reference: Aura::get_namespace_governance_status_filtered (aura.rs)
    const allowed = namespaces !== undefined ? new Set(namespaces) : null
    const namespaceList = [...new Set([...this.searchRecords.values()].map((record) => record.namespace))]
      .filter((namespace) => allowed === null || allowed.has(namespace))
      .sort()
    const lastCycle = this.maintenanceTrendHistory[this.maintenanceTrendHistory.length - 1]
    const lastMaintenanceCycle = lastCycle?.timestamp ?? null
    const latestDominantPhase = lastCycle?.dominantPhase ?? "none"
    const records = this.searchRecords

    return Effect.gen(function* () {
      const runtime = yield* Effect.service(EpistemicRuntime)
      const beliefs = yield* runtime.getBeliefs()
      const statuses: NamespaceGovernanceStatus[] = []
      for (const namespace of namespaceList) {
        const recordCount = [...records.values()].filter((record) => record.namespace === namespace).length
        const namespaceBeliefs = beliefs.filter((belief) => belief.key.startsWith(`${namespace}:`))
        const highVolatilityBeliefCount = namespaceBeliefs.filter((belief) => belief.volatility >= 0.20).length
        const lowStabilityBeliefCount = namespaceBeliefs.filter((belief) => belief.stability <= 1.0).length
        const correctionCount = 0
        const correctionDensity = recordCount === 0 ? 0 : correctionCount / recordCount
        const policyPressureAreaCount = (yield* runtime.getPolicyPressureReport(namespace, 64)).length
        const suggestedCorrectionCount = 0
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

  explain_recall(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: explainability surface is recoverably unsupported for MCP callers.
    // Reason: TS does not yet have the Rust explainability bundle / trace DTOs.
    // Rust reference: Aura::explain_recall (aura.rs)
    return unsupportedSurface("Aura.explain_recall", "Aura::explain_recall (aura.rs)", [
      "Recall trace DTO construction",
      "Explainability bundle assembly",
    ])
  }

  explain_record(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: explainability surface is recoverably unsupported for MCP callers.
    // Reason: TS does not yet have the Rust explainability bundle / trace DTOs.
    // Rust reference: Aura::explain_record (aura.rs)
    return unsupportedSurface("Aura.explain_record", "Aura::explain_record (aura.rs)", [
      "Record-level provenance chain",
      "Correction log read model",
    ])
  }

  runMaintenance(
    config?: MaintenanceConfig
  ) {
    const cfg = config ?? defaultMaintenanceConfig
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
        DisabledBackgroundBrain,
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
      const snapshot = buildTrendSnapshot(
        timestamp, records.size, postDiscovery.recordsArchived,
        initial.insightsFound, initial.epistemic,
        discovery.belief, discovery.causal, discovery.policy,
        discovery.feedback, timings, hotspots, previousCumulativeCorrections, previousCumulativeCorrections
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

  private removeSearchRecord(recordId: string): void {
    const next = new Map(this.searchRecords)
    next.delete(recordId)
    this.searchRecords = next
  }

  get_entity_digest(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: relation/entity graph APIs are recoverably unsupported for now.
    // Reason: TS does not have the relation graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::get_entity_digest (aura.rs)
    return unsupportedSurface("Aura.get_entity_digest", "Aura::get_entity_digest (aura.rs)", [
      "Relation graph store",
      "Entity digest read model",
    ])
  }

  link_entities(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: relation/entity graph APIs are recoverably unsupported for now.
    // Reason: TS does not have the relation graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::link_entities (aura.rs)
    return unsupportedSurface("Aura.link_entities", "Aura::link_entities (aura.rs)", [
      "Relation graph store",
      "Entity link mutation path",
    ])
  }

  get_project_graph(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: project graph APIs are recoverably unsupported for now.
    // Reason: TS does not have the project graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::get_project_graph (aura.rs)
    return unsupportedSurface("Aura.get_project_graph", "Aura::get_project_graph (aura.rs)", [
      "Project graph store",
      "Project graph read model",
    ])
  }

  get_family_graph(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: family graph APIs are recoverably unsupported for now.
    // Reason: TS does not have the family graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::get_family_graph (aura.rs)
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

function recordImportance(record: AuraRecord): number {
  // Composite importance score (0.0-1.0+).
  // Formula: strength(40%) + level(25%) + connections(20%) + activations(15%) + bounded salience hint (10%).
  // 组合重要性分数；与 Rust Record::importance 公式对齐。
  // Rust reference: Record::importance (record.rs)
  const levelScore = levelValue(record.level) / 4
  const connScore = Math.min(Object.keys(record.connections).length / 50, 1)
  const actScore = Math.min(record.activation_count / 20, 1)
  // NON-PARITY IMPLEMENTATION: contract Record does not expose Rust salience yet, so search uses 0.
  // 差异说明：等 contract Record 加入 salience 后再接入最后 10% 权重。
  const salience = 0
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

function toRecordLike(rec: AuraRecord, nowSecs: number): AuraRecord {
  // AuraRecord (contract Record) does not have an index signature,
  // so we cast for dynamic field access during normalization.
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

  return {
    id,
    content,
    level,
    strength: typeof o.strength === "number" ? o.strength : 1,
    activation_count:
      typeof o.activation_count === "number" ? o.activation_count : 0,
    created_at: typeof o.created_at === "number" ? o.created_at : nowSecs,
    last_activated:
      typeof o.last_activated === "number" ? o.last_activated : nowSecs,
    tags,
    connections,
    connection_types,
    content_type: typeof o.content_type === "string" ? o.content_type : "text",
    source_type: typeof o.source_type === "string" ? o.source_type : "recorded",
    namespace: typeof o.namespace === "string" ? o.namespace : "default",
    semantic_type:
      typeof o.semantic_type === "string" ? o.semantic_type : "memory",
    metadata,
    aura_id: typeof o.aura_id === "string" ? o.aura_id : null,
    caused_by_id: typeof o.caused_by_id === "string" ? o.caused_by_id : null,
  };
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
