import { Effect } from "effect"
import { FileRead, FileReadError, FileWrite, FileWriteError, JsonParseError } from "@aura/contract"
import { CogJsonSnapshotFile } from "./CogJsonSnapshotFile"

export class PolicyStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): PolicyStoreFile {
    return new PolicyStoreFile(dir)
  }

  static empty_engine(): unknown {
    return {}
  }

  load(): Effect.Effect<unknown, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/policies.cog`
    return CogJsonSnapshotFile.load(filePath, PolicyStoreFile.empty_engine)
  }

  save(_engine: unknown): Effect.Effect<void, FileWriteError, FileWrite> {
    const engine = _engine
    const filePath = `${this.dir}/policies.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      yield* CogJsonSnapshotFile.save(filePath, engine)
    })
  }
}
