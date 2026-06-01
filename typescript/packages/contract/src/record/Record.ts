import { Level } from "../levels/Level"
import { RecordValidationError } from "../Errors"

export type RecordId = string

export const DEFAULT_NAMESPACE = "default"
export const DEFAULT_SOURCE_TYPE = "recorded"
export const DEFAULT_SEMANTIC_TYPE = "fact"
export const VALID_SOURCE_TYPES = ["recorded", "retrieved", "inferred", "generated"] as const
export const VALID_SEMANTIC_TYPES = [
  "fact",
  "decision",
  "trend",
  "serendipity",
  "preference",
  "contradiction",
] as const
export const MAX_CONTENT_SIZE_BYTES = 100 * 1024
export const MAX_TAGS = 50

export type SourceType = typeof VALID_SOURCE_TYPES[number]
export type SemanticType = typeof VALID_SEMANTIC_TYPES[number]
export type RecordPromotionResult = {
  readonly record: Record
  readonly promoted: boolean
}
export type RecordMakeOptions = {
  readonly id?: RecordId
  readonly nowSeconds?: number
}

export interface Record {
  id: RecordId
  content: string
  level: Level
  strength: number
  activation_count: number
  created_at: number
  last_activated: number
  tags: ReadonlyArray<string>
  connections: { readonly [recordId: string]: number }
  /** Typed connections — maps record_id to relationship kind (e.g. "causal", "reflective").
   *  Matches Rust `record.rs` connection_types: HashMap<String, String>. */
  connection_types: { readonly [recordId: string]: string }
  content_type: string
  source_type: string
  namespace: string
  semantic_type: string
  /** Activation velocity EMA. Rust `activation_velocity`, default 0.0. */
  activation_velocity: number
  /** Durable bounded importance hint. Rust `salience`, default 0.0. */
  salience: number
  metadata: { readonly [k: string]: string }
  aura_id?: string | null
  caused_by_id?: string | null
  confidence: number
  support_mass: number
  conflict_mass: number
  /** Truth-instability EMA. Rust `volatility`, default 0.0. */
  volatility: number
}

export type StoreOptions = {
  level?: Level
  tags?: ReadonlyArray<string>
  pin?: boolean
  content_type?: string
  source_type?: string
  metadata?: { readonly [k: string]: string }
  deduplicate?: boolean
  caused_by_id?: string
  namespace?: string
  semantic_type?: string
}

export type UpdateOptions = {
  tags?: ReadonlyArray<string>
  metadata?: { readonly [k: string]: string }
  content?: string
  level?: Level
  strength?: number
  source_type?: string
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function clampConnectionWeight(weight: number): number {
  return Math.min(1, Math.max(0, weight))
}

function currentUnixSeconds(): number {
  return Date.now() / 1000
}

export namespace Record {
  /**
   * Create a new record with defaults.
   *
   * @zh 创建带 Rust 默认字段的 record。TS 侧命名为 `make`，因为 `new` 是 TypeScript 关键字；
   * 对应 Rust `Record::new`。
   *
   * Rust reference: `Record::new` (`../src/record.rs`).
  */
  export function make(content: string, level: Level, options: RecordMakeOptions = {}): Record {
    const nowSeconds = options.nowSeconds ?? currentUnixSeconds()
    return {
      id: options.id ?? generateId(),
      content,
      level,
      strength: 1,
      activation_count: 0,
      created_at: nowSeconds,
      last_activated: nowSeconds,
      tags: [],
      connections: {},
      connection_types: {},
      content_type: "text",
      metadata: {},
      aura_id: null,
      caused_by_id: null,
      namespace: DEFAULT_NAMESPACE,
      source_type: DEFAULT_SOURCE_TYPE,
      semantic_type: DEFAULT_SEMANTIC_TYPE,
      activation_velocity: 0,
      salience: 0,
      confidence: defaultConfidenceForSource(DEFAULT_SOURCE_TYPE),
      support_mass: 0,
      conflict_mass: 0,
      volatility: 0,
    }
  }

  /**
   * Generate a 12-char hex ID.
   *
   * @zh 生成 12 字符十六进制 ID；TS 侧命名为 `generateId`，对应 Rust `Record::generate_id`。
   *
   * Rust reference: `Record::generate_id` (`../src/record.rs`).
   */
  export function generateId(): RecordId {
    const crypto = globalThis.crypto
    if (typeof crypto?.randomUUID === "function") {
      return crypto.randomUUID().replaceAll("-", "").slice(0, 12)
    }

    const bytes = new Uint8Array(6)
    if (typeof crypto?.getRandomValues === "function") {
      crypto.getRandomValues(bytes)
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256)
      }
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  }

  /**
   * Composite importance score (0.0-1.0+).
   *
   * Formula: strength(40%) + level(25%) + connections(20%) + activations(15%) + bounded salience hint (10%).
   * @zh 组合重要性分数；与 Rust `Record::importance` 公式对齐。
   *
   * Rust reference: `Record::importance` (`../src/record.rs`).
   */
  export function importance(record: Record): number {
    const levelScore = Level.value(record.level) / 4
    const connScore = Math.min(Object.keys(record.connections).length / 50, 1)
    const actScore = Math.min(record.activation_count / 20, 1)
    const salience = clamp01(record.salience ?? 0)
    return 0.40 * record.strength + 0.25 * levelScore + 0.20 * connScore + 0.15 * actScore + 0.10 * salience
  }

  /**
   * Activate this record (boost strength, update timestamp, update velocity).
   *
   * @zh 激活 record 并更新 strength、activation_count、last_activated 与 velocity；
   * 对齐 Rust `Record::activate`。
   *
   * Rust reference: `Record::activate` (`../src/record.rs`).
  */
  export function activate(record: Record, nowSeconds = currentUnixSeconds()): Record {
    const gapDays = Math.max((nowSeconds - record.last_activated) / 86_400, 0.001)
    const instantRate = Math.min(1 / gapDays, 100)
    const alpha = 0.3
    return {
      ...record,
      strength: Math.min(record.strength + 0.2, 1),
      activation_count: record.activation_count + 1,
      last_activated: nowSeconds,
      activation_velocity: alpha * instantRate + (1 - alpha) * record.activation_velocity,
    }
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
   * @zh 基于 level 与 activation frequency 应用自适应衰减；semantic_type 不参与衰减。
   *
   * Rust reference: `Record::apply_decay` (`../src/record.rs`).
   */
  export function applyDecay(record: Record): Record {
    const baseRate = Level.decayRate(record.level)
    const ceilingFactor = Math.min(record.activation_count / 10, 1)
    const activationRate = Math.min(baseRate + (0.999 - baseRate) * ceilingFactor, 0.999)
    const salienceBias = 0.03 * clamp01(record.salience ?? 0)
    const effectiveRate = Math.min(activationRate + salienceBias, 0.999)
    return { ...record, strength: record.strength * effectiveRate }
  }

  /**
   * Whether this record is still alive (not archived).
   *
   * @zh 判断 record 是否仍存活（未归档）；对齐 Rust `Record::is_alive`。
   *
   * Rust reference: `Record::is_alive` (`../src/record.rs`).
   */
  export function isAlive(record: Record): boolean {
    return record.strength >= 0.05
  }

  /**
   * Whether this record is eligible for promotion.
   *
   * @zh 判断 record 是否符合晋升条件；对齐 Rust `Record::can_promote`。
   *
   * Rust reference: `Record::can_promote` (`../src/record.rs`).
   */
  export function canPromote(record: Record): boolean {
    return record.activation_count >= 5 && record.strength >= 0.7 && Level.value(record.level) < Level.value(Level.Identity)
  }

  /**
   * Promote to the next level, if any.
   *
   * @zh 将 record 提升到下一层级。Rust 原方法会原地修改并返回 boolean；
   * TS 侧返回 `{ record, promoted }` 以保持不可变数据更新。
   *
   * Rust reference: `Record::promote` (`../src/record.rs`).
   */
  export function promote(record: Record): RecordPromotionResult {
    const nextLevel = Level.promote(record.level)
    if (nextLevel === null) {
      return { record, promoted: false }
    }
    return { record: { ...record, level: nextLevel }, promoted: true }
  }

  /**
   * Add a bidirectional connection to another record.
   *
   * @zh 添加连接权重。Rust 原方法会原地修改；TS 侧返回更新后的 record。
   *
   * Rust reference: `Record::add_connection` (`../src/record.rs`).
   */
  export function addConnection(record: Record, otherId: string, weight: number): Record {
    return {
      ...record,
      connections: {
        ...record.connections,
        [otherId]: clampConnectionWeight(weight),
      },
    }
  }

  /**
   * Add a typed bidirectional connection to another record.
   *
   * @zh 添加带关系类型的连接。Rust 原方法会原地修改；TS 侧返回更新后的 record。
   *
   * Rust reference: `Record::add_typed_connection` (`../src/record.rs`).
   */
  export function addTypedConnection(record: Record, otherId: string, weight: number, relationship: string): Record {
    const connected = addConnection(record, otherId, weight)
    return {
      ...connected,
      connection_types: {
        ...connected.connection_types,
        [otherId]: relationship,
      },
    }
  }

  /**
   * Get the relationship type for a connection (None if untyped).
   *
   * @zh 获取连接关系类型；对齐 Rust `Record::connection_type`。
   *
   * Rust reference: `Record::connection_type` (`../src/record.rs`).
   */
  export function connectionType(record: Record, otherId: string): string | undefined {
    return record.connection_types[otherId]
  }

  /**
   * Days since creation.
   *
   * @zh 距离创建时间的天数；对齐 Rust `Record::age_days`。
   *
   * Rust reference: `Record::age_days` (`../src/record.rs`).
  */
  export function ageDays(record: Record, nowSeconds = currentUnixSeconds()): number {
    return (nowSeconds - record.created_at) / 86_400
  }

  /**
   * Validate a namespace string.
   *
   * Rules: non-empty, max 64 chars, ASCII alphanumeric + hyphens + underscores.
   * @zh 校验 namespace 字符串；对齐 Rust `Record::validate_namespace`。
   *
   * Rust reference: `Record::validate_namespace` (`../src/record.rs`).
   */
  export function validateNamespace(namespace: string): RecordValidationError | undefined {
    if (namespace.length === 0) {
      return recordValidationError("namespace", "Namespace cannot be empty")
    }
    if (namespace.length > 64) {
      return recordValidationError("namespace", "Namespace cannot exceed 64 characters")
    }
    for (const char of namespace) {
      if (!/^[A-Za-z0-9_-]$/.test(char)) {
        return recordValidationError(
          "namespace",
          "Namespace must contain only ASCII alphanumeric, hyphens, or underscores"
        )
      }
    }
    return undefined
  }

  /**
   * Validate a source_type string.
   *
   * Must be one of: "recorded", "retrieved", "inferred", "generated".
   * @zh 校验 source_type；对齐 Rust `Record::validate_source_type`。
   *
   * Rust reference: `Record::validate_source_type` (`../src/record.rs`).
   */
  export function validateSourceType(sourceType: string): RecordValidationError | undefined {
    if ((VALID_SOURCE_TYPES as ReadonlyArray<string>).includes(sourceType)) return undefined
    return recordValidationError(
      "source_type",
      `Invalid source_type '${sourceType}'. Must be one of: ${VALID_SOURCE_TYPES.join(", ")}`
    )
  }

  /**
   * Validate a semantic_type string.
   *
   * Must be one of: "fact", "decision", "trend", "serendipity", "preference", "contradiction".
   * @zh 校验 semantic_type；对齐 Rust `Record::validate_semantic_type`。
   *
   * Rust reference: `Record::validate_semantic_type` (`../src/record.rs`).
   */
  export function validateSemanticType(semanticType: string): RecordValidationError | undefined {
    if ((VALID_SEMANTIC_TYPES as ReadonlyArray<string>).includes(semanticType)) return undefined
    return recordValidationError(
      "semantic_type",
      `Invalid semantic_type '${semanticType}'. Must be one of: ${VALID_SEMANTIC_TYPES.join(", ")}`
    )
  }

  /**
   * Base confidence from source type.
   *
   * @zh 根据 source_type 计算默认 confidence；对齐 Rust `Record::default_confidence_for_source`。
   *
   * Rust reference: `Record::default_confidence_for_source` (`../src/record.rs`).
   */
  export function defaultConfidenceForSource(sourceType: string): number {
    switch (sourceType) {
      case "recorded":
        return 0.9
      case "retrieved":
        return 0.75
      case "inferred":
        return 0.6
      case "generated":
        return 0.5
      default:
        return 0.5
    }
  }

  /**
   * Update epistemic signals after a maintenance cycle.
   *
   * @zh 维护周期后更新 support/conflict/volatility。Rust 原方法会原地修改；
   * TS 侧返回更新后的 record。
   *
   * Rust reference: `Record::update_epistemic_signals` (`../src/record.rs`).
   */
  export function updateEpistemicSignals(record: Record, confirming: number, conflicting: number): Record {
    const prevConfidence = record.confidence
    const prevSupport = record.support_mass
    const prevConflict = record.conflict_mass

    const supportDen = Math.max(prevSupport, confirming, 1)
    const conflictDen = Math.max(prevConflict, conflicting, 1)
    const confidenceDelta = Math.abs(record.confidence - prevConfidence)
    const supportDelta = (Math.abs(confirming - prevSupport) / supportDen) * 0.2
    const conflictDelta = (Math.abs(conflicting - prevConflict) / conflictDen) * 0.8
    const instantVolatility = Math.min(confidenceDelta + supportDelta + conflictDelta, 1)
    const volatility = 0.3 * instantVolatility + 0.7 * record.volatility

    return {
      ...record,
      support_mass: confirming,
      conflict_mass: conflicting,
      volatility,
    }
  }

  /**
   * Epistemic health score — combines confidence with support/conflict ratio.
   *
   * @zh 认知健康度分数；对齐 Rust `Record::epistemic_health`。
   *
   * Rust reference: `Record::epistemic_health` (`../src/record.rs`).
   */
  export function epistemicHealth(record: Record): number {
    const supportLn = Math.log(1 + record.support_mass)
    const conflictLn = Math.log(1 + record.conflict_mass)
    const ratio = supportLn + conflictLn > 0 ? supportLn / (supportLn + conflictLn) : 0.5
    return record.confidence * ratio * (1 - record.volatility * 0.5)
  }

  /**
   * Days since last activation.
   *
   * @zh 距离上次激活的天数；对齐 Rust `Record::days_since_activation`。
   *
   * Rust reference: `Record::days_since_activation` (`../src/record.rs`).
  */
  export function daysSinceActivation(record: Record, nowSeconds = currentUnixSeconds()): number {
    return (nowSeconds - record.last_activated) / 86_400
  }
}

export function defaultConfidenceForSource(sourceType: string): number {
  return Record.defaultConfidenceForSource(sourceType)
}

export function validateRecordNamespace(namespace: string): RecordValidationError | undefined {
  return Record.validateNamespace(namespace)
}

export function validateRecordSourceType(sourceType: string): RecordValidationError | undefined {
  return Record.validateSourceType(sourceType)
}

export function validateRecordSemanticType(semanticType: string): RecordValidationError | undefined {
  return Record.validateSemanticType(semanticType)
}

export function validateRecordStoreInput(input: {
  readonly content: string
  readonly tags: ReadonlyArray<string>
  readonly source_type: string
  readonly semantic_type: string
  readonly namespace: string
}): RecordValidationError | undefined {
  if (input.content.length === 0) {
    return recordValidationError("content", "Content cannot be empty")
  }
  if (new TextEncoder().encode(input.content).byteLength > MAX_CONTENT_SIZE_BYTES) {
    return recordValidationError("content", "Content exceeds maximum size of 100KB")
  }
  if (input.tags.length > MAX_TAGS) {
    return recordValidationError("tags", `Maximum ${MAX_TAGS} tags allowed`)
  }
  return Record.validateSourceType(input.source_type)
    ?? Record.validateSemanticType(input.semantic_type)
    ?? Record.validateNamespace(input.namespace)
}

function recordValidationError(field: string, message: string): RecordValidationError {
  return new RecordValidationError({
    field,
    message,
    rustReference: "Record validation helpers (record.rs) / Aura::store_with_channel, Aura::update (aura.rs)",
  })
}
