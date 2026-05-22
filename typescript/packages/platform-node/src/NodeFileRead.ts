import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileRead, FileReadError } from "@aura/contract"

export const NodeFileReadLive = Layer.succeed(FileRead, {
  readFile: (p) =>
    Effect.tryPromise(() => fs.readFile(p).then((b) => new Uint8Array(b))).pipe(
      Effect.mapError((cause) => new FileReadError({ path: p, cause }))
    ),
  exists: (p) =>
    Effect.tryPromise(() => fs.stat(p).then(() => true).catch(() => false)).pipe(
      Effect.mapError((cause) => new FileReadError({ path: p, cause }))
    ),
  stat: (p) =>
    Effect.tryPromise(() => fs.stat(p).then((s) => ({ size: s.size }))).pipe(
      Effect.mapError((cause) => new FileReadError({ path: p, cause }))
    )
})
