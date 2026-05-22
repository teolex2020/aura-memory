import { Effect } from "effect"
import { Tag } from "./Context"
import { FileWriteError } from "./Errors"

export class FileWrite extends Tag("aura.contract.FileWrite")<
  FileWrite,
  {
    mkdirp: (path: string) => Effect.Effect<void, FileWriteError>
    writeFile: (path: string, data: Uint8Array) => Effect.Effect<void, FileWriteError>
    appendFile: (path: string, data: Uint8Array) => Effect.Effect<void, FileWriteError>
    writeAt: (path: string, offset: number, data: Uint8Array) => Effect.Effect<void, FileWriteError>
    fsync: (path: string) => Effect.Effect<void, FileWriteError>
    rename: (from: string, to: string) => Effect.Effect<void, FileWriteError>
  }
>() {}
