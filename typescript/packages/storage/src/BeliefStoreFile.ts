import { Effect } from "effect"
import {
  FileRead,
  FileReadError,
  FileWrite,
  FileWriteError,
  type BeliefEngineState,
  JsonParseError
} from "@aura/contract"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

export class BeliefStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): BeliefStoreFile {
    return new BeliefStoreFile(dir)
  }

  static empty_engine(): BeliefEngineState {
    return { version: 1, beliefs: {}, hypotheses: {}, record_to_belief: {}, key_index: {}, record_index: {} } satisfies BeliefEngineState
  }

  load(): Effect.Effect<BeliefEngineState, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/beliefs.cog`
    return CogJsonSnapshotFile.load(filePath, BeliefStoreFile.empty_engine)
  }

  save(_engine: BeliefEngineState): Effect.Effect<void, FileWriteError, FileWrite> {
    const engine = _engine
    const filePath = `${this.dir}/beliefs.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, engine)
    })
  }
}
