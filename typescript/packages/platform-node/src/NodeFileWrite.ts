import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileWrite, FileWriteError } from "@aura/contract"

export const NodeFileWriteLive = Layer.succeed(FileWrite, {
  mkdirp: (p) =>
    Effect.tryPromise(() => fs.mkdir(p, { recursive: true }).then(() => undefined)).pipe(
      Effect.mapError((cause) => new FileWriteError({ path: p, cause }))
    ),
  writeFile: (p, data) =>
    Effect.tryPromise(() => fs.writeFile(p, data).then(() => undefined)).pipe(
      Effect.mapError((cause) => new FileWriteError({ path: p, cause }))
    ),
  appendFile: (p, data) =>
    Effect.tryPromise(() => fs.appendFile(p, data).then(() => undefined)).pipe(
      Effect.mapError((cause) => new FileWriteError({ path: p, cause }))
    ),
  writeAt: (p, offset, data) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(p, "r+")
      try {
        await fd.write(data, 0, data.byteLength, offset)
      } finally {
        await fd.close()
      }
    }).pipe(Effect.mapError((cause) => new FileWriteError({ path: p, cause }))),
  fsync: (p) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(p, "r+")
      try {
        await fd.sync()
      } finally {
        await fd.close()
      }
    }).pipe(Effect.mapError((cause) => new FileWriteError({ path: p, cause }))),
  rename: (from, to) =>
    Effect.tryPromise(() => fs.rename(from, to).then(() => undefined)).pipe(
      Effect.mapError((cause) => new FileWriteError({ path: `${from} -> ${to}`, cause }))
    )
})
