import { it } from "vitest"
import { assert } from "@effect/vitest"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { Effect } from "effect"
import { Aura } from "./index"
import { NodeClockLive, NodeCryptoLive, NodeFileReadLive, NodeFileWriteLive } from "@aura/platform-node"
import { BrainAuraFile } from "@aura/storage"

it("Aura.open loads minimal fixture", async () => {
  const fixture = path.join(process.cwd(), "test/fixtures/minimal_brain")
  const brainPath = fs.mkdtempSync(path.join(os.tmpdir(), "aura-brain-fixture-"))
  fs.copyFileSync(path.join(fixture, "temporal.bin"), path.join(brainPath, "temporal.bin"))

  await Effect.runPromise(
    Effect.gen(function* () {
      const f = yield* BrainAuraFile.open(brainPath)
      yield* f.append({
        id: "ts_fixture_1",
        dna: "user_core",
        timestamp: 1,
        intensity: 0.1,
        stability: 0.2,
        decay_velocity: 0.3,
        entropy: 0.4,
        sdr_indices: [1, 10, 100, 2000],
        text: "Hello TS Fixture"
      })
      yield* f.flush()
    }).pipe(
      Effect.provide(NodeFileReadLive),
      Effect.provide(NodeFileWriteLive),
      Effect.provide(NodeClockLive),
      Effect.provide(NodeCryptoLive)
    )
  )

  const aura = await Effect.runPromise(
    Aura.open(brainPath).pipe(Effect.provide(NodeFileReadLive), Effect.provide(NodeFileWriteLive))
  )
  const all = aura.listRecords()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0]?.id, "ts_fixture_1")

  assert.ok(fs.existsSync(path.join(brainPath, "persistence_manifest.json")))
})
