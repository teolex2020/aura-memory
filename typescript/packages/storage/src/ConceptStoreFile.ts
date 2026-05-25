import { Effect } from "effect"
import {
  ConceptPartitionMode,
  ConceptSeedMode,
  ConceptSimilarityMode,
  ConceptUnionMode,
  type ConceptEngineState,
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  JsonParseError
} from "@aura/contract"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

export class ConceptStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): ConceptStoreFile {
    return new ConceptStoreFile(dir)
  }

  static empty_engine(): ConceptEngineState {
    return {
      version: 1,
      concepts: {},
      key_index: {},
      seed_mode: ConceptSeedMode.Standard,
      similarity_mode: ConceptSimilarityMode.SdrTanimoto,
      partition_mode: ConceptPartitionMode.Standard,
      union_mode: ConceptUnionMode.Standard
    }
  }

  load(): Effect.Effect<ConceptEngineState, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/concepts.cog`
    return CogJsonSnapshotFile.load(filePath, ConceptStoreFile.empty_engine)
  }

  save(_engine: ConceptEngineState): Effect.Effect<void, FileWriteError, FileWrite> {
    const engine = _engine
    const filePath = `${this.dir}/concepts.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, engine)
    })
  }
}
