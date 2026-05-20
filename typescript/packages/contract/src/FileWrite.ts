import { Effect } from "effect"
import { Tag } from "./Context"

export class FileWrite extends Tag("aura.contract.FileWrite")<
  FileWrite,
  {
    mkdirp: (path: string) => Effect.Effect<void>
    writeFile: (path: string, data: Uint8Array) => Effect.Effect<void>
    appendFile: (path: string, data: Uint8Array) => Effect.Effect<void>
    writeAt: (path: string, offset: number, data: Uint8Array) => Effect.Effect<void>
    fsync: (path: string) => Effect.Effect<void>
    rename: (from: string, to: string) => Effect.Effect<void>
  }
>() {}
