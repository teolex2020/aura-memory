import { Effect } from "effect"
import { Tag } from "./Context"
import { FileReadError } from "./Errors"

export type FileStat = {
  size: number
}

export class FileRead extends Tag("aura.contract.FileRead")<
  FileRead,
  {
    readFile: (path: string) => Effect.Effect<Uint8Array, FileReadError>
    exists: (path: string) => Effect.Effect<boolean, FileReadError>
    stat: (path: string) => Effect.Effect<FileStat, FileReadError>
  }
>() {}
