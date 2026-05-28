import { Effect } from "effect";
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
  type CognitiveRecord,
  type BrainAuraRecord,
} from "@aura/storage";
import type { RecallPipelineOptions } from "@aura/recall";
import {
  recallRecords as recallRecordsEffect,
  recallScored as recallScoredEffect,
} from "./Recall";
import { id12 } from "@aura/utils";

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

  runMaintenance(..._args: ReadonlyArray<unknown>) {
    // STUB: Maintenance pipeline entry point — wired by MaintenanceService.
    // Plan 06 created MaintenanceService; this stub allows Aura facade to
    // compile before full integration.
    // Rust reference: Aura::run_maintenance (aura.rs)
    return Effect.die(
      new UnimplementedError({ feature: "Aura.runMaintenance" }),
    );
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

function toRecordLike(rec: CognitiveRecord, nowSecs: number): AuraRecord | undefined {
  const o = rec as unknown as { [k: string]: unknown };
  if (typeof o.id !== "string") return undefined;
  const id = o.id;
  const content = typeof o.content === "string" ? o.content : "";
  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t): t is string => typeof t === "string")
    : [];
  const connections: { [k: string]: number } =
    o.connections && typeof o.connections === "object"
      ? { ...(o.connections as { [k: string]: number }) }
      : {};
  const metadata: { [k: string]: string } =
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
