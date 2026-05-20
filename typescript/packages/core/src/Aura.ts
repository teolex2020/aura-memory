import { Effect } from "effect"
import { FileRead } from "@aura/contract"
import { readBrainAuraFile, type BrainAuraRecord } from "@aura/storage"

export class Aura {
  private constructor(private readonly records: BrainAuraRecord[]) {}

  static open(brainPath: string): Effect.Effect<Aura, unknown, FileRead> {
    const brainAuraPath = `${brainPath}/brain.aura`
    return Effect.gen(function* () {
      const fs = yield* Effect.service(FileRead)
      const buf = yield* fs.readFile(brainAuraPath)
      const parsed = readBrainAuraFile(buf)
      return new Aura(parsed.records)
    })
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice()
  }
}
