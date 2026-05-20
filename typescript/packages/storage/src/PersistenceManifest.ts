import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"

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
): Effect.Effect<void, unknown, FileWrite> {
  const path = `${rootDir}/${PERSISTENCE_MANIFEST_FILE}`
  return Effect.gen(function* () {
    const fw = yield* Effect.service(FileWrite)
    const json = JSON.stringify(manifest, null, 2)
    yield* fw.writeFile(path, te.encode(json))
    yield* fw.fsync(path)
  })
}

export function loadPersistenceManifestWithValidation(
  rootDir: string
): Effect.Effect<PersistenceManifest, unknown, FileRead | FileWrite> {
  const path = `${rootDir}/${PERSISTENCE_MANIFEST_FILE}`
  return Effect.gen(function* () {
    const fr = yield* Effect.service(FileRead)

    const current = currentPersistenceManifest()
    let manifest: PersistenceManifest | null = null

    const exists = yield* fr.exists(path)
    if (exists) {
      const bytes = yield* fr.readFile(path)
      const s = td.decode(bytes).trim()
      if (s.length > 0) {
        try {
          manifest = JSON.parse(s) as PersistenceManifest
        } catch {
          manifest = null
        }
      }
    }

    const normalized: PersistenceManifest = {
      schema_version: current.schema_version,
      surfaces: { ...current.surfaces }
    }

    if (manifest && typeof manifest.schema_version === "number" && manifest.surfaces) {
      if (manifest.schema_version === current.schema_version) {
        normalized.schema_version = manifest.schema_version
      }
      for (const [k, v] of Object.entries(current.surfaces)) {
        const actual = (manifest.surfaces as any)[k]
        if (typeof actual === "number") {
          normalized.surfaces[k] = v
        } else {
          normalized.surfaces[k] = v
        }
      }
    }

    yield* savePersistenceManifest(rootDir, normalized)
    return normalized
  })
}

