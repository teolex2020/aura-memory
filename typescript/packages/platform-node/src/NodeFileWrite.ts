import * as fs from "node:fs/promises"
import { Effect, Layer } from "effect"
import { FileWrite } from "@aura/contract"

export const NodeFileWriteLive = Layer.succeed(FileWrite, {
  mkdirp: (p) => Effect.tryPromise(() => fs.mkdir(p, { recursive: true }).then(() => undefined)),
  writeFile: (p, data) => Effect.tryPromise(() => fs.writeFile(p, data).then(() => undefined)),
  appendFile: (p, data) => Effect.tryPromise(() => fs.appendFile(p, data).then(() => undefined)),
  writeAt: (p, offset, data) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(p, "r+")
      try {
        await fd.write(data, 0, data.byteLength, offset)
      } finally {
        await fd.close()
      }
    }),
  fsync: (p) =>
    Effect.tryPromise(async () => {
      const fd = await fs.open(p, "r+")
      try {
        await fd.sync()
      } finally {
        await fd.close()
      }
    }),
  rename: (from, to) => Effect.tryPromise(() => fs.rename(from, to).then(() => undefined))
})
