import { Effect } from "effect"
import { FileRead, FileReadError, FileWrite, FileWriteError, JsonParseError } from "@aura/contract"
import type { PolicyEngineState } from "@aura/contract"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

export class PolicyStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): PolicyStoreFile {
    return new PolicyStoreFile(dir)
  }

  static empty_engine(): PolicyEngineState {
    return { version: 1 as const, hints: {}, metadata: {}, key_index: {} }
  }

  load(): Effect.Effect<PolicyEngineState, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/policies.cog`
    return CogJsonSnapshotFile.load(filePath, PolicyStoreFile.empty_engine)
  }

  save(engine: PolicyEngineState): Effect.Effect<void, FileWriteError, FileWrite> {
    const filePath = `${this.dir}/policies.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, engine)
    })
  }
}
