import { Effect } from "effect"
import { Tag } from "./Context"

export type FileStat = {
  size: number
}

export class FileRead extends Tag("aura.contract.FileRead")<
  FileRead,
  {
    readFile: (path: string) => Effect.Effect<Uint8Array>
    exists: (path: string) => Effect.Effect<boolean>
    stat: (path: string) => Effect.Effect<FileStat>
  }
>() {}
