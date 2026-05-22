import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect } from "effect"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BeliefStoreFile } from "./BeliefStoreFile"

it("BeliefStoreFile load/save roundtrip", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-belief-store-"))
  const file = BeliefStoreFile.new(dir)

  const empty = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(empty, BeliefStoreFile.empty_engine())

  const engine = { ...BeliefStoreFile.empty_engine(), record_to_belief: { r1: "b1" } }
  await Effect.runPromise(file.save(engine).pipe(Effect.provide(NodeFileWriteLive)))

  const loaded = await Effect.runPromise(
    file.load().pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  assert.deepStrictEqual(loaded, engine)
})
