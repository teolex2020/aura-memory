import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as path from "node:path"
import { Effect } from "effect"
import { Aura } from "./index"
import { NodeFileReadLive } from "@aura/platform-node"

it("Aura.open loads minimal fixture", async () => {
  const brainPath = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const aura = await Effect.runPromise(Aura.open(brainPath).pipe(Effect.provide(NodeFileReadLive)))
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0]?.id, "ts_fixture_1")
})
