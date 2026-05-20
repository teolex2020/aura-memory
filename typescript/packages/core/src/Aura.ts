import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"
import { loadPersistenceManifestWithValidation, readBrainAuraFile, type BrainAuraRecord } from "@aura/storage"

export class Aura {
  private constructor(private readonly records: BrainAuraRecord[]) {}

  static open(brainPath: string): Effect.Effect<Aura, unknown, FileRead | FileWrite> {
    const brainAuraPath = `${brainPath}/brain.aura`
    return Effect.gen(function* () {
      const fs = yield* Effect.service(FileRead)
      yield* loadPersistenceManifestWithValidation(brainPath)
      const buf = yield* fs.readFile(brainAuraPath)
      const parsed = readBrainAuraFile(buf)
      return new Aura(parsed.records)
    })
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice()
  }
}
