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
  UnimplementedError,
  Clock,
} from "@aura/contract";
import {
  CognitiveStoreFile,
  loadCognitiveRecords,
  loadPersistenceManifestWithValidation,
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
  buildReflectionSummary,
  pushReflectionSummary,
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
} from "@aura/contract"

export class Aura {
  private constructor(
    private readonly brainDir: string,
    private readonly records: BrainAuraRecord[],
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
      return new Aura(brainPath, parsed.records);
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
    return Effect.gen(function* () {
      const store = yield* CognitiveStoreFile.open(dir);
      yield* store.appendDelete(record_id);
      yield* store.flush();
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
    // UNIMPLEMENTED: explainability surface is intentionally a defect for now.
    // Reason: TS does not yet have the Rust explainability bundle / trace DTOs.
    // Rust reference: Aura::explain_recall (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.explain_recall" }),
    );
  }

  explain_record(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: explainability surface is intentionally a defect for now.
    // Reason: TS does not yet have the Rust explainability bundle / trace DTOs.
    // Rust reference: Aura::explain_record (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.explain_record" }),
    );
  }

  runMaintenance(
    config?: MaintenanceConfig
  ) {
    const cfg = config ?? defaultMaintenanceConfig
    const dir = this.brainDir

    return Effect.gen(function* () {
      const trace = yield* Effect.service(EpistemicTrace)
      yield* trace.event("maintenance.start", { records: this.records.length })

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
      const records = yield* loadCognitiveRecords(dir)

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
        undefined as never, // taxonomy (stub — ignored by stub phases)
        undefined as never, // cognitiveStore (stub — ignored by stub phases)
        0, timings, hotspots
      )

      // ── Phase 2: SDR lookup ──
      const sdrLookup = yield* buildSdrLookup(
        undefined as never, // SDRInterpreter (stub)
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
        undefined as never, // ngramIndex (stub)
        new Map(), // tagIndex
        new Map(), // auraIndex
        undefined as never, // cognitiveStore (stub)
        undefined, // backgroundBrain
        cfg,
        undefined as never, // taxonomy (stub)
        timings, hotspots
      )

      // ── Phase 6: Finalize telemetry ──
      const telemetry = yield* finalizeTelemetry(
        timings, hotspots, Csm.Inspect, conceptEng, counters
      )

      // ── Phase 7: Trends ──
      const trendHistory: MaintenanceTrendSnapshot[] = []
      const snapshot = buildTrendSnapshot(
        timestamp, records.size, postDiscovery.recordsArchived,
        initial.insightsFound, initial.epistemic,
        discovery.belief, discovery.causal, discovery.policy,
        discovery.feedback, timings, hotspots, 0, 0
      )
      yield* pushTrendSnapshot(trendHistory, snapshot)
      const trendSummary = summarizeTrends(trendHistory)

      // ── Phase 8: Reflection ──
      const contradictionClusters: ContradictionCluster[] = []
      const reflection = yield* buildReflectionSummary(
        timestamp, records, cfg.taskTag,
        contradictionClusters, trendSummary, hotspots
      )

      // ── Total timing ──
      const timingsMut = timings as { totalMs: number }
      timingsMut.totalMs = Date.now() - t0

      yield* trace.event("maintenance.end", {
        totalMs: timings.totalMs,
        dominantPhase: hotspots.dominantPhase,
      })

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

  get_entity_digest(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: relation/entity graph APIs are intentionally left as defects for now.
    // Reason: TS does not have the relation graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::get_entity_digest (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.get_entity_digest" }),
    );
  }

  link_entities(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: relation/entity graph APIs are intentionally left as defects for now.
    // Reason: TS does not have the relation graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::link_entities (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.link_entities" }),
    );
  }

  get_project_graph(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: project graph APIs are intentionally left as defects for now.
    // Reason: TS does not have the project graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::get_project_graph (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.get_project_graph" }),
    );
  }

  get_family_graph(..._args: ReadonlyArray<unknown>) {
    // UNIMPLEMENTED: family graph APIs are intentionally left as defects for now.
    // Reason: TS does not have the family graph store/index yet; returning dummy values would hide missing capability.
    // Rust reference: Aura::get_family_graph (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.get_family_graph" }),
    );
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
