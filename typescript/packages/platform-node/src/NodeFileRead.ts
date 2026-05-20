import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileRead } from "@aura/contract"

export const NodeFileReadLive = Layer.succeed(FileRead, {
  readFile: (p) => Effect.tryPromise(() => fs.readFile(p).then((b) => new Uint8Array(b))),
  exists: (p) => Effect.tryPromise(() => fs.stat(p).then(() => true).catch(() => false)),
  stat: (p) => Effect.tryPromise(() => fs.stat(p).then((s) => ({ size: s.size })))
})

