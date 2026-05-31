import { Effect } from "effect"
import {
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  startupValidationEvent,
  type StartupValidationEvent,
} from "@aura/contract"

export type PersistenceManifest = {
  schema_version: number
  surfaces: Record<string, number>
}

const te = new TextEncoder()
const td = new TextDecoder()

export const PERSISTENCE_MANIFEST_FILE = "persistence_manifest.json"

export function currentPersistenceManifest(): PersistenceManifest {
  return {
    schema_version: 1,
    surfaces: {
      belief: 1,
      concept: 1,
      causal: 1,
      policy: 1,
      maintenance_trends: 1,
      reflection_summaries: 1
    }
  }
}

export function savePersistenceManifest(
  rootDir: string,
  manifest: PersistenceManifest
): Effect.Effect<void, FileWriteError, FileWrite> {
  const path = `${rootDir}/${PERSISTENCE_MANIFEST_FILE}`
  return Effect.gen(function* () {
    const fw = yield* Effect.service(FileWrite)
    const json = JSON.stringify(manifest, null, 2)
    yield* fw.writeFile(path, te.encode(json))
    yield* fw.fsync(path)
  })
}

export type PersistenceManifestValidation = {
  readonly manifest: PersistenceManifest
  readonly events: ReadonlyArray<StartupValidationEvent>
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isPersistenceManifest(value: unknown): value is PersistenceManifest {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { readonly schema_version?: unknown; readonly surfaces?: unknown }
  return (
    typeof candidate.schema_version === "number" &&
    typeof candidate.surfaces === "object" &&
    candidate.surfaces !== null
  )
}

export function loadPersistenceManifestWithStartupValidation(
  rootDir: string
): Effect.Effect<PersistenceManifestValidation, FileWriteError, FileRead | FileWrite> {
  const path = `${rootDir}/${PERSISTENCE_MANIFEST_FILE}`
  return Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)

    const current = currentPersistenceManifest()
    let manifest: PersistenceManifest = current
    const events: StartupValidationEvent[] = []

    let existsError: unknown = null
    const exists = yield* fr.exists(path).pipe(
      Effect.catchTag("FileReadError", (cause) => {
        existsError = cause
        return Effect.succeed(false)
      })
    )

    if (existsError !== null) {
      events.push(startupValidationEvent(
        "persistence_manifest",
        path,
        "load_error_fallback",
        formatCause(existsError),
        true,
      ))
    } else if (!exists) {
      events.push(startupValidationEvent(
        "persistence_manifest",
        path,
        "missing_fallback",
        "persistence manifest missing; created current manifest",
        true,
      ))
    } else {
      let readError: unknown = null
      const bytes = yield* fr.readFile(path).pipe(
        Effect.catchTag("FileReadError", (cause) => {
          readError = cause
          return Effect.succeed(new Uint8Array())
        })
      )
      const s = td.decode(bytes).trim()
      if (readError !== null) {
        events.push(startupValidationEvent(
          "persistence_manifest",
          path,
          "load_error_fallback",
          formatCause(readError),
          true,
        ))
      } else if (s.length === 0) {
        events.push(startupValidationEvent(
          "persistence_manifest",
          path,
          "empty_fallback",
          "persistence manifest was empty; created current manifest",
          true,
        ))
      } else {
        try {
          const parsed = JSON.parse(s) as unknown
          if (isPersistenceManifest(parsed)) {
            manifest = parsed
          } else {
            events.push(startupValidationEvent(
              "persistence_manifest",
              path,
              "load_error_fallback",
              "invalid persistence manifest shape",
              true,
            ))
          }
        } catch (cause) {
          events.push(startupValidationEvent(
            "persistence_manifest",
            path,
            "load_error_fallback",
            formatCause(cause),
            true,
          ))
        }
      }
    }

    const normalized: PersistenceManifest = {
      schema_version: manifest.schema_version,
      surfaces: { ...manifest.surfaces }
    }

    const mismatchDetails: string[] = []
    if (normalized.schema_version !== current.schema_version) {
      mismatchDetails.push(`schema_version ${normalized.schema_version} -> ${current.schema_version}`)
      normalized.schema_version = current.schema_version
    }
    for (const [k, v] of Object.entries(current.surfaces)) {
      const actual = normalized.surfaces[k] ?? 0
      if (actual !== v) {
        mismatchDetails.push(`${k} ${actual} -> ${v}`)
      }
      normalized.surfaces[k] = v
    }

    if (mismatchDetails.length === 0) {
      events.push(startupValidationEvent(
        "persistence_manifest",
        path,
        "loaded",
        "loaded current persistence manifest",
        false,
      ))
    } else {
      events.push(startupValidationEvent(
        "persistence_manifest",
        path,
        "version_mismatch",
        `normalized manifest to current versions: ${mismatchDetails.join(", ")}`,
        true,
      ))
    }

    yield* savePersistenceManifest(rootDir, normalized)
    return { manifest: normalized, events }
  })
}

export function loadPersistenceManifestWithValidation(
  rootDir: string
): Effect.Effect<PersistenceManifest, FileReadError | FileWriteError, FileRead | FileWrite> {
  return loadPersistenceManifestWithStartupValidation(rootDir).pipe(
    Effect.map((result) => result.manifest)
  )
}
