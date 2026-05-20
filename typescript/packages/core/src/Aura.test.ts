import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { Effect } from "effect"
import { Aura } from "./index"
import { NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"

it("Aura.open loads minimal fixture", async () => {
  const fixture = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-brain-fixture-"))
  fs.copyFileSync(path.join(fixture, "brain.aura"), path.join(brainPath, "brain.aura"))
  fs.copyFileSync(path.join(fixture, "temporal.bin"), path.join(brainPath, "temporal.bin"))

  const aura = await Effect.runPromise(
    Aura.open(brainPath).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0]?.id, "ts_fixture_1")

  assert.ok(fs.existsSync(path.join(brainPath, "persistence_manifest.json")))
})
