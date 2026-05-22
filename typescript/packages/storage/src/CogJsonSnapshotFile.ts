import { Effect } from "effect"
import { FileRead, FileReadError, FileWrite, FileWriteError, JsonParseError } from "@aura/contract"

const te = new TextEncoder()
const td = new TextDecoder()

export class CogJsonSnapshotFile {
  static load<T>(
    filePath: string,
    empty: () => T
  ): Effect.Effect<T, FileReadError | JsonParseError, FileRead> {
    return Effect.gen(function* () {
      const fr = yield* Effect.service(FileRead)
      const exists = yield* fr.exists(filePath)
      if (!exists) return empty()
      const bytes = yield* fr.readFile(filePath)
      if (bytes.byteLength === 0) return empty()
      return yield* Effect.try({
        try: () => JSON.parse(td.decode(bytes)) as T,
        catch: (cause) => new JsonParseError({ path: filePath, cause })
      })
    })
  }

  static save<T>(filePath: string, value: T): Effect.Effect<void, FileWriteError, FileWrite> {
    return Effect.gen(function* () {
      const fw = yield* Effect.service(FileWrite)
      const bytes = te.encode(JSON.stringify(value))
      yield* fw.writeFile(filePath, bytes)
      yield* fw.fsync(filePath)
    })
  }
}

