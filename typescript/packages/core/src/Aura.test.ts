import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as path from "node:path"
import { Aura } from "./index"

it("Aura.open loads minimal fixture", async () => {
  const brainPath = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const aura = await Aura.open(brainPath)
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0]?.id, "ts_fixture_1")
})
