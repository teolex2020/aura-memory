import { Aura, DefaultLayer } from "@aura/core"
import {
  NodeClockLive,
  NodeCryptoLive,
  NodeFileReadLive,
  NodeFileWriteLive,
} from "@aura/platform-node"
import { Effect, Layer } from "effect"

export type AuraMcpRuntime = {
  readonly brainPath: string
  readonly aura: Aura
  readonly runEffect: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
}

export type McpErrorCode =
  | "unsupported_surface"
  | "file_read_error"
  | "file_write_error"
  | "file_format_error"
  | "json_parse_error"
  | "index_format_error"
  | "sdr_interpreter_error"
  | "embedding_query_error"
  | "rerank_error"
  | "finalize_error"
  | "unknown_error"

export type McpErrorPayload = {
  readonly ok: false
  readonly error: {
    readonly code: McpErrorCode
    readonly message: string
    readonly tag?: string
    readonly surface?: string
    readonly rust_reference?: string
    readonly missing_prerequisites?: ReadonlyArray<string>
    readonly path?: string
  }
}

export function resolveBrainPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.AURA_BRAIN_PATH ?? "./aura_brain"
}

function nodeLayer(brainPath: string) {
  const platform = Layer.mergeAll(
    NodeFileReadLive,
    NodeFileWriteLive,
    NodeClockLive,
    NodeCryptoLive,
  )
  return Layer.mergeAll(
    DefaultLayer(brainPath).pipe(Layer.provide(platform)),
    platform,
  )
}

export async function openAuraRuntime(env: NodeJS.ProcessEnv = process.env): Promise<AuraMcpRuntime> {
  const brainPath = resolveBrainPath(env)
  const password = env.AURA_PASSWORD
  const layer = nodeLayer(brainPath)
  const open = password === undefined
    ? Aura.open(brainPath)
    : Aura.open_with_password(brainPath, password)
  const runEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      // The MCP process owns the complete Aura runtime layer for its bound brain.
      Effect.provide(effect, layer) as Effect.Effect<A, E, never>
    )
  const aura = await runEffect(open)
  return { brainPath, aura, runEffect }
}

export function toText(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? "null"
}

export function toMcpErrorPayload(error: unknown): McpErrorPayload {
  const tagged = toTaggedRecord(error)
  if (tagged !== null) {
    const tag = tagged._tag
    if (tag === "UnsupportedSurfaceError") {
      return {
        ok: false,
        error: {
          code: "unsupported_surface",
          tag,
          message: stringField(tagged, "reason", "Unsupported Aura MCP surface."),
          surface: stringField(tagged, "surface", "unknown"),
          rust_reference: stringField(tagged, "rustReference", "unknown"),
          missing_prerequisites: stringArrayField(tagged, "missingPrerequisites"),
        },
      }
    }
    return {
      ok: false,
      error: {
        code: codeForTag(tag),
        tag,
        message: stringField(tagged, "message", fallbackMessage(error)),
        path: optionalStringField(tagged, "path"),
      },
    }
  }
  return {
    ok: false,
    error: {
      code: "unknown_error",
      message: fallbackMessage(error),
    },
  }
}

export function toMcpErrorText(error: unknown): string {
  return JSON.stringify(toMcpErrorPayload(error))
}

function toTaggedRecord(error: unknown): (Readonly<Record<string, unknown>> & { readonly _tag: string }) | null {
  if (typeof error !== "object" || error === null) return null
  const record = error as Readonly<Record<string, unknown>>
  return typeof record._tag === "string" ? { ...record, _tag: record._tag } : null
}

function codeForTag(tag: string): McpErrorCode {
  switch (tag) {
    case "FileReadError":
      return "file_read_error"
    case "FileWriteError":
      return "file_write_error"
    case "FileFormatError":
      return "file_format_error"
    case "JsonParseError":
      return "json_parse_error"
    case "IndexFormatError":
      return "index_format_error"
    case "SdrInterpreterError":
      return "sdr_interpreter_error"
    case "EmbeddingQueryError":
      return "embedding_query_error"
    case "RerankError":
      return "rerank_error"
    case "FinalizeError":
      return "finalize_error"
    default:
      return "unknown_error"
  }
}

function stringField(record: Readonly<Record<string, unknown>>, field: string, fallback: string): string {
  const value = record[field]
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function optionalStringField(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = record[field]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stringArrayField(record: Readonly<Record<string, unknown>>, field: string): ReadonlyArray<string> {
  const value = record[field]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function fallbackMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
