import { Effect } from "effect"
import { FileFormatError, FileRead, FileReadError, FileWrite, FileWriteError } from "@aura/contract"
import { loadPersistenceManifestWithValidation, readBrainAuraFile, type BrainAuraRecord } from "@aura/storage"
import type { RecallPipelineOptions } from "@aura/recall"
import { recallRecords as recallRecordsEffect, recallScored as recallScoredEffect } from "./Recall"

export class Aura {
  private constructor(private readonly records: BrainAuraRecord[]) {}

  static open(
    brainPath: string
  ): Effect.Effect<Aura, FileReadError | FileWriteError | FileFormatError, FileRead | FileWrite> {
    const brainAuraPath = `${brainPath}/brain.aura`
    return Effect.gen(function* () {
      const fs = yield* Effect.service(FileRead)
      yield* loadPersistenceManifestWithValidation(brainPath)
      const buf = yield* fs.readFile(brainAuraPath)
      const parsed = yield* Effect.try({
        try: () => readBrainAuraFile(buf),
        catch: (cause) =>
          new FileFormatError({
            path: brainAuraPath,
            message: cause instanceof Error ? cause.message : String(cause)
          })
      })
      return new Aura(parsed.records)
    })
  }

  listRecords(): BrainAuraRecord[] {
    return this.records.slice()
  }

  static recallScored(brainDir: string, query: string, options?: Partial<RecallPipelineOptions>) {
    return recallScoredEffect(brainDir, query, options)
  }

  static recallRecords<TRecord = unknown>(
    brainDir: string,
    query: string,
    options?: Partial<RecallPipelineOptions>
  ) {
    return recallRecordsEffect<TRecord>(brainDir, query, options)
  }
}
