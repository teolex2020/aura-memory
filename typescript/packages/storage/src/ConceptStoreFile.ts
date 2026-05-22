import { Effect } from "effect"
import { FileRead, FileReadError, FileWrite, FileWriteError, JsonParseError } from "@aura/contract"

const te = new TextEncoder()
const td = new TextDecoder()

export class ConceptStoreFile {
  private constructor(private readonly dir: string) {}

  static new(dir: string): ConceptStoreFile {
    return new ConceptStoreFile(dir)
  }

  static empty_engine(): unknown {
    return {}
  }

  load(): Effect.Effect<unknown, FileReadError | JsonParseError, FileRead> {
    const filePath = `${this.dir}/concepts.cog`
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const exists = yield* fr.exists(filePath)
      if (!exists) return ConceptStoreFile.empty_engine()
      const bytes = yield* fr.readFile(filePath)
      if (bytes.byteLength === 0) return ConceptStoreFile.empty_engine()
      return yield* Effect.try({
        try: () => JSON.parse(td.decode(bytes)) as unknown,
        catch: (cause) => new JsonParseError({ path: filePath, cause })
      })
    })
  }

  save(_engine: unknown): Effect.Effect<void, FileWriteError, FileWrite> {
    const engine = _engine
    const filePath = `${this.dir}/concepts.cog`
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
