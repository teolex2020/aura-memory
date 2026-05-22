import { Effect } from "effect"
import { FileRead, FileWrite } from "@aura/contract"

const te = new TextEncoder()
const td = new TextDecoder()

export class BeliefStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): BeliefStoreFile {
    return new BeliefStoreFile(dir)
  }

  static empty_engine(): unknown {
    return {}
  }

  load(): Effect.Effect<unknown, unknown, FileRead> {
    const filePath = `${this.dir}/beliefs.cog`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const exists = yield* fr.exists(filePath)
      if (!exists) return BeliefStoreFile.empty_engine()
      const bytes = yield* fr.readFile(filePath)
      if (bytes.byteLength === 0) return BeliefStoreFile.empty_engine()
      return JSON.parse(td.decode(bytes)) as unknown
    })
  }

  save(_engine: unknown): Effect.Effect<void, unknown, FileWrite> {
    const engine = _engine
    const filePath = `${this.dir}/beliefs.cog`
    const dir = this.dir
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      yield* fw.mkdirp(dir)
      const bytes = te.encode(JSON.stringify(engine))
      yield* fw.writeFile(filePath, bytes)
      yield* fw.fsync(filePath)
    })
  }
}
