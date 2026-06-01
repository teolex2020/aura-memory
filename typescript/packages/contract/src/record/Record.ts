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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
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

export namespace Record {
  /**
   * Composite importance score (0.0-1.0+).
   *
   * Formula: strength(40%) + level(25%) + connections(20%) + activations(15%) + bounded salience hint (10%).
   * @zh 组合重要性分数；与 Rust `Record::importance` 公式对齐。
   *
   * Rust reference: `Record::importance` (`../src/record.rs`).
   */
  export function importance(record: Record): number {
    const levelScore = levelValue(record.level) / 4
    const connScore = Math.min(Object.keys(record.connections).length / 50, 1)
    const actScore = Math.min(record.activation_count / 20, 1)
    const salience = clamp01(record.salience ?? 0)
    return 0.40 * record.strength + 0.25 * levelScore + 0.20 * connScore + 0.15 * actScore + 0.10 * salience
  }
}

export function validateRecordNamespace(namespace: string): RecordValidationError | undefined {
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

export function validateRecordSourceType(sourceType: string): RecordValidationError | undefined {
  if ((VALID_SOURCE_TYPES as ReadonlyArray<string>).includes(sourceType)) return undefined
  return recordValidationError(
    "source_type",
    `Invalid source_type '${sourceType}'. Must be one of: ${VALID_SOURCE_TYPES.join(", ")}`
  )
}

export function validateRecordSemanticType(semanticType: string): RecordValidationError | undefined {
  if ((VALID_SEMANTIC_TYPES as ReadonlyArray<string>).includes(semanticType)) return undefined
  return recordValidationError(
    "semantic_type",
    `Invalid semantic_type '${semanticType}'. Must be one of: ${VALID_SEMANTIC_TYPES.join(", ")}`
  )
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
  return validateRecordSourceType(input.source_type)
    ?? validateRecordSemanticType(input.semantic_type)
    ?? validateRecordNamespace(input.namespace)
}

function recordValidationError(field: string, message: string): RecordValidationError {
  return new RecordValidationError({
    field,
    message,
    rustReference: "Record validation helpers (record.rs) / Aura::store_with_channel, Aura::update (aura.rs)",
  })
}
