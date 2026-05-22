import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { PolicyStoreFile } from "./PolicyStoreFile"

it("PolicyStoreFile load/save roundtrip", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-policy-store-"))
  const file = PolicyStoreFile.new(dir)

  const empty = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(empty, PolicyStoreFile.empty_engine())

  const engine = { _tag: "PolicyEngine", hints: {} }
  await Effect.runPromise(file.save(engine).pipe(Effect.provide(NodeFileWriteLive)))

  const loaded = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(loaded, engine)
})

